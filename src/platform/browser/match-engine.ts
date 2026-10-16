import workerSource from "text-finder:match-worker";
import { findTextOffsets, prepareReplacements } from "../../core/search/text-matching";
import type {
	MatchExecutor,
	MatchReply,
	MatchRequest,
	MatchResult,
} from "../../core/search/match-protocol";
import type { MatchOffset, SearchOptions, SearchRange } from "../../core/search/types";

interface WorkerWindow {
	Worker: typeof Worker;
	Blob: typeof Blob;
	URL: typeof URL;
	closed?: boolean;
	addEventListener?: Window["addEventListener"];
	removeEventListener?: Window["removeEventListener"];
}
interface Connection {
	win: WorkerWindow;
	worker: Worker;
	url: string;
	ready: boolean;
	timer: ReturnType<typeof setTimeout> | null;
	message: (event: MessageEvent<MatchReply>) => void;
	error: (event: Event) => void;
	close: () => void;
}
interface Pending {
	request: MatchRequest;
	sent: boolean;
	resolve: (result: MatchResult) => void;
}

/** One independent execution lane per owner/mode. No query execution timeout.
 * Only pre-query startup failures select the existing synchronous algorithm. */
export class MatchEngine implements MatchExecutor {
	private connection: Connection | null = null;
	private pending: Pending | null = null;
	private unavailableWindow: WorkerWindow | null = null;
	private sequence = 0;
	private disposed = false;

	constructor(
		private getWindow: () => Window | null,
		private compatibility: (error: unknown) => void = () => {},
		private startupTimeoutMs = 3000,
	) {}

	match(
		source: string,
		query: string,
		options: SearchOptions,
		ranges?: readonly SearchRange[],
	): MatchResult | Promise<MatchResult> {
		return this.execute({
			id: ++this.sequence,
			source,
			query,
			options: { ...options },
			ranges: ranges?.map((range) => ({ ...range })),
		});
	}
	replace(
		source: string,
		query: string,
		replacement: string,
		options: SearchOptions,
		index: number,
		all: boolean,
		ranges?: readonly SearchRange[],
	): MatchResult | Promise<MatchResult> {
		return this.execute({
			id: ++this.sequence,
			source,
			query,
			options: { ...options },
			replacement,
			index,
			ranges: ranges?.map((range) => ({ ...range })),
			operation: all ? "replaceAll" : "replaceOne",
		});
	}
	private execute(request: MatchRequest): MatchResult | Promise<MatchResult> {
		if (this.disposed) return { status: "cancelled" };
		const win = this.getWindow() as unknown as WorkerWindow | null;
		if (!win || win.closed) {
			this.cancel();
			return { status: "cancelled" };
		}
		if (this.pending) this.cancel();
		if (this.connection && this.connection.win !== win) this.release();
		if (this.unavailableWindow === win) return this.synchronous(request);
		if (!request.source || !request.query)
			return {
				status: "completed",
				matches: [],
				synchronous: false,
				...(request.operation ? { changes: [] } : {}),
			};
		if (!this.connection) {
			try {
				this.start(win);
			} catch (error) {
				return this.fallback(win, request, error);
			}
		}
		return new Promise((resolve) => {
			this.pending = { request, resolve, sent: false };
			if (this.connection?.ready) this.send();
		});
	}

	private synchronous(request: MatchRequest): MatchResult {
		try {
			if (request.operation) {
				const prepared = prepareReplacements(
					request.source,
					request.query,
					request.replacement ?? "",
					request.options.regexMode,
					request.options.caseSensitive,
					request.options.wholeWord,
					request.ranges,
				);
				const index = this.replacementIndex(request, prepared.matches.length);
				const selected =
					request.operation === "replaceOne" ? prepared.one(index) : undefined;
				return {
					status: "completed",
					synchronous: true,
					matches: prepared.matches,
					changes:
						request.operation === "replaceAll"
							? prepared.all()
							: selected
								? [selected]
								: [],
				};
			}
			return {
				status: "completed",
				synchronous: true,
				matches: findTextOffsets(
					request.source,
					request.query,
					request.options.regexMode,
					request.options.caseSensitive,
					request.options.wholeWord,
					request.ranges,
				),
			};
		} catch (error) {
			return { status: "failed", error };
		}
	}
	private replacementIndex(request: MatchRequest, length: number) {
		return typeof request.index === "number" &&
			Number.isInteger(request.index) &&
			request.index >= 0 &&
			request.index < length
			? request.index
			: 0;
	}
	private fallback(win: WorkerWindow, request: MatchRequest, error: unknown): MatchResult {
		this.release();
		this.unavailableWindow = win;
		try {
			this.compatibility(error);
		} catch (noticeError) {
			console.warn("Text Finder compatibility notice failed", noticeError);
		}
		return this.synchronous(request);
	}
	private start(win: WorkerWindow) {
		if (
			typeof win.Worker !== "function" ||
			!win.URL?.createObjectURL ||
			typeof win.Blob !== "function"
		) {
			throw new Error("Worker API unavailable");
		}
		const url = win.URL.createObjectURL(
			new win.Blob([workerSource], { type: "text/javascript" }),
		);
		let worker: Worker;
		try {
			worker = new win.Worker(url);
		} catch (error) {
			win.URL.revokeObjectURL(url);
			throw error;
		}
		const connection: Connection = {
			win,
			worker,
			url,
			ready: false,
			timer: null,
			close: () => {
				if (this.connection === connection) this.cancel();
			},
			message: (event) => this.receive(connection, event.data),
			error: (event) => {
				event.preventDefault();
				this.failure(
					connection,
					new Error(
						(event as ErrorEvent).message || "Worker message/initialization failure",
					),
				);
			},
		};
		this.connection = connection;
		worker.addEventListener("message", connection.message);
		worker.addEventListener("error", connection.error);
		worker.addEventListener("messageerror", connection.error);
		win.addEventListener?.("pagehide", connection.close);
		win.addEventListener?.("beforeunload", connection.close);
		connection.timer = setTimeout(
			() =>
				this.failure(
					connection,
					new Error("Worker initialization timed out before query submission"),
				),
			this.startupTimeoutMs,
		);
	}
	private receive(connection: Connection, reply: MatchReply) {
		if (this.connection !== connection || this.disposed) return;
		if (reply.type === "ready") {
			if (connection.ready) return;
			connection.ready = true;
			if (connection.timer !== null) clearTimeout(connection.timer);
			connection.timer = null;
			this.send();
			return;
		}
		const pending = this.pending;
		if (!pending?.sent || reply.id !== pending.request.id) return;
		if (reply.type === "failed") {
			this.failure(connection, new Error(reply.error));
			return;
		}
		try {
			const offsets = new Float64Array(reply.offsets);
			if (offsets.length % 2) throw new Error("Malformed Worker offsets");
			const matches: MatchOffset[] = [];
			let end = 0;
			for (let index = 0; index < offsets.length / 2; index++) {
				const from = offsets[index * 2],
					to = offsets[index * 2 + 1];
				if (
					from === undefined ||
					to === undefined ||
					!Number.isSafeInteger(from) ||
					!Number.isSafeInteger(to) ||
					from < end ||
					to <= from ||
					to > pending.request.source.length
				) {
					throw new Error("Invalid Worker match coordinates");
				}
				if (
					pending.request.ranges &&
					!pending.request.ranges.some((range) => from >= range.from && to <= range.to)
				) {
					throw new Error("Worker match outside search scope");
				}
				matches.push({ from, to, index });
				end = to;
			}
			if (pending.request.operation) {
				const expected =
					pending.request.operation === "replaceAll"
						? matches
						: matches.length
							? [matches[this.replacementIndex(pending.request, matches.length)]]
							: [];
				if (
					!Array.isArray(reply.changes) ||
					reply.changes.length !== expected.length ||
					reply.changes.some(
						(change, index) =>
							!change ||
							!expected[index] ||
							change.from !== expected[index]?.from ||
							change.to !== expected[index]?.to ||
							typeof change.insert !== "string",
					)
				) {
					throw new Error("Invalid Worker replacement candidates");
				}
			}
			this.pending = null;
			pending.resolve({
				status: "completed",
				matches,
				synchronous: false,
				...(pending.request.operation && reply.changes ? { changes: reply.changes } : {}),
			});
		} catch (error) {
			this.failure(connection, error);
		}
	}
	private send() {
		const pending = this.pending,
			connection = this.connection;
		if (!pending || pending.sent || !connection?.ready) return;
		// Mark before postMessage: even a dispatch failure must not silently replay
		// an accepted query on the UI thread.
		pending.sent = true;
		try {
			connection.worker.postMessage(pending.request);
		} catch (error) {
			this.failure(connection, error);
		}
	}
	private failure(connection: Connection, error: unknown) {
		if (this.connection !== connection) return;
		const pending = this.pending;
		this.pending = null;
		this.release();
		if (pending)
			pending.resolve(
				pending.sent
					? { status: "failed", error }
					: this.fallback(connection.win, pending.request, error),
			);
	}
	private release() {
		const connection = this.connection;
		this.connection = null;
		if (!connection) return;
		if (connection.timer !== null) clearTimeout(connection.timer);
		connection.worker.removeEventListener("message", connection.message);
		connection.worker.removeEventListener("error", connection.error);
		connection.worker.removeEventListener("messageerror", connection.error);
		connection.win.removeEventListener?.("pagehide", connection.close);
		connection.win.removeEventListener?.("beforeunload", connection.close);
		try {
			connection.worker.terminate();
		} catch (error) {
			console.warn("Text Finder Worker termination failed", error);
		}
		try {
			connection.win.URL.revokeObjectURL(connection.url);
		} catch (error) {
			console.warn("Text Finder Worker URL cleanup failed", error);
		}
	}
	cancel() {
		const pending = this.pending;
		this.pending = null;
		this.release();
		pending?.resolve({ status: "cancelled" });
	}
	destroy() {
		this.disposed = true;
		this.cancel();
		this.unavailableWindow = null;
	}
}
