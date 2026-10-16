// Standalone diagnostic plugin. No saveData, Vault I/O, editor dispatch,
// selection, scrolling or production Finder imports.
import { Plugin, ItemView, MarkdownView, Notice, apiVersion } from "obsidian";
import { WorkerExperimentClient, decodeResult } from "./worker-experiment-client.mjs";
import { browserConnection } from "./worker-probe-connection.mjs";
import { captureOwner, ownerInvalidation } from "./worker-probe-owner.mjs";
import { workerCases, snapshot } from "./worker-experiment-cases.mjs";
import { findTextOffsets, prepareReplacements } from "../../src/core/search/text-matching.ts";

const VIEW = "text-finder-worker-probe";
const equal = (a, b) => {
	if (JSON.stringify(a) !== JSON.stringify(b))
		throw new Error("Direct and Worker results differ");
};
const completed = (value) => {
	if (value.status !== "completed")
		throw new Error(`Worker ${value.status}: ${value.error ?? value.reason ?? ""}`);
	return value;
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = (value) => Math.round(value * 100) / 100;

class ProbeView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.owner = null;
		this.closed = false;
		this.epoch = 0;
		this.queryVersion = 0;
		this.active = null;
		this.lastReport = null;
		this.sequence = 0;
		this.resources = { workers: 0, urls: 0, listeners: 0, intervals: 0, timers: 0 };
	}
	getViewType() {
		return VIEW;
	}
	getDisplayText() {
		return "Worker probe (read-only)";
	}
	getIcon() {
		return "flask-conical";
	}
	async onOpen() {
		this.closed = false;
		this.plugin.views.add(this);
		const root = this.contentEl;
		root.replaceChildren();
		const doc = root.ownerDocument;
		const add = (tag, text) => {
			const node = doc.createElement(tag);
			node.textContent = text;
			root.append(node);
			return node;
		};
		add("h3", "Text Finder — Worker probe");
		add(
			"p",
			"独立探针，不写正文、不滚动或高亮、不保存、不扫描 Vault。请使用临时测试库。结果含宿主版本及绑定文件路径，不含笔记正文。",
		);
		this.ownerLabel = add(
			"p",
			"Owner: 未绑定；先激活编辑模式 Markdown，再执行 Bind active editor 命令。",
		);
		const label = add("label", "只读快照查询（仅字面量，不允许把危险正则输入这里）：");
		this.query = doc.createElement("input");
		this.query.type = "text";
		this.query.value = "cat";
		label.append(this.query);
		this.query.addEventListener("input", () => {
			this.queryVersion++;
			if (this.active?.captured) this.cancel("query-changed");
		});
		this.buttons = [];
		const button = (text, action, always = false) => {
			const node = add("button", text);
			node.style.margin = "4px";
			node.addEventListener("click", action);
			if (!always) this.buttons.push(node);
			return node;
		};
		button("1. 安全语义验证（368 次）", () =>
			this.run("safe-semantics", (client) => this.safe(client)),
		);
		button("2. 只读 owner 快照（延迟 3 秒）", () => this.runSnapshot());
		button("3. 主动取消当前任务", () => this.cancel("user-cancel"), true);
		button("4. 性能样本（无危险正则）", () =>
			this.run("performance", (client) => this.benchmark(client)),
		);
		const optIn = add("label", " ");
		this.dangerous = doc.createElement("input");
		this.dangerous.type = "checkbox";
		optIn.append(this.dangerous);
		optIn.append(doc.createTextNode("我明确同意：仅在隔离 Worker 中运行危险正则取消实验。"));
		button("5. 隔离危险正则取消／重启", () => {
			if (!this.dangerous.checked) {
				new Notice("请先勾选危险实验 opt-in；不会在主线程执行该输入。");
				return;
			}
			this.run("dangerous-cancel", (client, session) => this.danger(client, session));
		});
		button(
			"选择 JSON 结果（Ctrl/Cmd+C）",
			() => {
				this.output.focus();
				this.output.select();
			},
			true,
		);
		this.output = add("textarea", "");
		this.output.readOnly = true;
		this.output.rows = 22;
		this.output.style.width = "100%";
		this.output.style.fontFamily = "var(--font-monospace)";
		this.output.value = "尚未执行；环境信息将在实际运行时记录。";
	}
	bind(owner) {
		this.cancel("owner-rebound");
		this.owner = owner;
		if (this.ownerLabel)
			this.ownerLabel.textContent = `Owner: ${owner?.file?.path ?? "未绑定"}（绑定对象不会跟随活动视图变化）`;
	}
	environment() {
		const win = this.contentEl.ownerDocument.defaultView;
		return {
			probeBuild: __probeBuild,
			obsidianApiVersion: apiVersion,
			userAgent: win.navigator.userAgent,
			windowUrl: win.location.href,
			ownerPath: this.owner?.file?.path ?? null,
			boundary:
				"Obsidian diagnostic only; no production Finder, CodeMirror changes, reading-text extraction or mobile support claim",
		};
	}
	report(kind, result) {
		this.lastReport = {
			...this.environment(),
			kind,
			...result,
			resources: { ...this.resources },
		};
		if (!this.closed && !this.plugin.disposed)
			this.output.value = JSON.stringify(this.lastReport, null, 2);
	}
	stopSession(session) {
		if (session.stopped) return;
		session.stopped = true;
		for (const cleanup of session.cleanups.splice(0)) cleanup();
		void session.client.dispose();
	}
	cancel(reason) {
		this.epoch++;
		const session = this.active;
		this.active = null;
		if (session) {
			session.client.cancel(reason);
			this.stopSession(session);
		}
		this.buttons?.forEach((button) => {
			button.disabled = false;
		});
		if (session && !this.closed && !this.plugin.disposed)
			this.report(session.kind, { status: "cancelled", reason, published: false });
	}
	async run(kind, action, captured = null) {
		this.cancel("superseded");
		const epoch = ++this.epoch;
		const win = captured?.window ?? this.contentEl.ownerDocument.defaultView;
		const session = { kind, epoch, captured, stopped: false, cleanups: [] };
		session.client = new WorkerExperimentClient(
			() => browserConnection(win, __workerSource, this.resources),
			() =>
				!this.closed &&
				!this.plugin.disposed &&
				epoch === this.epoch &&
				(!captured ||
					!ownerInvalidation(this.app.workspace, captured, this.plugin.lifecycle)),
		);
		this.active = session;
		this.buttons.forEach((button) => {
			button.disabled = true;
		});
		const guard = () => {
			if (this.closed || this.plugin.disposed || this.active !== session) return;
			const invalid =
				win.closed || this.contentEl.ownerDocument.defaultView !== session.panelWindow
					? "window-changed"
					: captured &&
						ownerInvalidation(this.app.workspace, captured, this.plugin.lifecycle);
			if (invalid) this.cancel(invalid);
		};
		session.panelWindow = this.contentEl.ownerDocument.defaultView;
		const interval = win.setInterval(guard, 100);
		this.resources.intervals++;
		session.cleanups.push(() => {
			win.clearInterval(interval);
			this.resources.intervals--;
		});
		for (const targetWindow of new Set([win, session.panelWindow]))
			for (const event of ["pagehide", "beforeunload"]) {
				const listener = () => this.cancel("window-closed");
				targetWindow.addEventListener(event, listener);
				this.resources.listeners++;
				session.cleanups.push(() => {
					targetWindow.removeEventListener(event, listener);
					this.resources.listeners--;
				});
			}
		this.report(kind, { status: "running", experimentOnlyWatchdog: true });
		try {
			const result = await action(session.client, session);
			if (
				this.active !== session ||
				epoch !== this.epoch ||
				this.closed ||
				this.plugin.disposed
			)
				return;
			if (win.closed || this.contentEl.ownerDocument.defaultView !== session.panelWindow) {
				this.cancel("window-changed");
				return;
			}
			const invalid =
				captured && ownerInvalidation(this.app.workspace, captured, this.plugin.lifecycle);
			if (invalid) {
				this.cancel(invalid);
				return;
			}
			this.stopSession(session);
			this.report(kind, result);
		} catch (error) {
			if (
				this.active === session &&
				epoch === this.epoch &&
				!this.closed &&
				!this.plugin.disposed
			) {
				this.stopSession(session);
				this.report(kind, { status: "failed", error: String(error.stack ?? error) });
			}
		} finally {
			this.stopSession(session);
			if (this.active === session) {
				this.active = null;
				this.buttons.forEach((button) => {
					button.disabled = false;
				});
			}
		}
	}
	async safe(client) {
		let comparisons = 0;
		for (const entry of workerCases)
			for (const regexMode of [true, false])
				for (const caseSensitive of [true, false]) {
					const request = { ...entry, regexMode, caseSensitive, snapshot: snapshot() };
					const prepared = prepareReplacements(
						entry.source,
						entry.query,
						entry.replacement,
						regexMode,
						caseSensitive,
					);
					for (const operation of ["match", "replaceOne", "replaceAll"]) {
						const result = completed(
							await client.submit({ ...request, operation, index: 0 }),
						);
						const one = prepared.one(0);
						equal(
							result.result,
							operation === "match"
								? {
										matches: findTextOffsets(
											entry.source,
											entry.query,
											regexMode,
											caseSensitive,
										),
									}
								: {
										matches: prepared.matches,
										changes:
											operation === "replaceAll"
												? prepared.all()
												: one
													? [one]
													: [],
									},
						);
						comparisons++;
					}
					const packed = completed(
						await client.submit({
							...request,
							operation: "match",
							transport: "packed",
						}),
					);
					equal(decodeResult(packed.result), { matches: prepared.matches });
					comparisons++;
				}
		return {
			status: "completed",
			passed: true,
			comparisons,
			expectedDiagnostics:
				"Invalid '[' regex is intentionally included and caught; console diagnostics are expected.",
		};
	}
	runSnapshot() {
		let captured;
		try {
			captured = captureOwner(
				this.app.workspace,
				this.owner,
				this.plugin.lifecycle,
				++this.queryVersion,
			);
		} catch (error) {
			this.report("owner-snapshot", { status: "unavailable", error: String(error) });
			return;
		}
		const query = this.query.value;
		void this.run(
			"owner-snapshot",
			async (client) => {
				const result = await client.submit(
					{
						operation: "match",
						transport: "packed",
						source: captured.source,
						query,
						regexMode: false,
						caseSensitive: false,
						delayMs: 3000,
						snapshot: {
							owner: String(++this.sequence),
							file: captured.path ?? "",
							documentVersion: this.sequence,
							queryVersion: captured.queryVersion,
							lifecycle: captured.lifecycle,
						},
					},
					{ timeoutMs: 10000 },
				);
				if (result.status !== "completed")
					return { status: result.status, reason: result.reason, published: false };
				const matches = decodeResult(result.result).matches;
				return {
					status: "completed",
					published: true,
					sourceChars: captured.source.length,
					matches: matches.length,
					computeMs: result.computeMs,
					note: "Counts only; no text, coordinates, selection or changes published to the editor.",
				};
			},
			captured,
		);
	}
	delay(session, ms) {
		const win = session.panelWindow;
		return new Promise((resolve) => {
			let settled = false;
			this.resources.timers++;
			const finish = () => {
				if (!settled) {
					settled = true;
					win.clearTimeout(timer);
					this.resources.timers--;
					resolve();
				}
			};
			const timer = win.setTimeout(finish, ms);
			session.cleanups.push(finish);
		});
	}
	async danger(client, session) {
		const request = {
			operation: "match",
			source: "a".repeat(10000) + "!",
			query: "(a+)+$",
			regexMode: true,
			caseSensitive: true,
			snapshot: snapshot(),
		};
		completed(await client.submit({ ...request, source: "cat", query: "cat" }));
		let started;
		const ready = new Promise((resolve) => {
			started = resolve;
		});
		let settled = false;
		const pending = client
			.submit(request, { timeoutMs: 2000, onStarted: started })
			.then((value) => {
				settled = true;
				return value;
			});
		await Promise.race([
			ready,
			pending.then(() => {
				throw new Error("Request ended before execution started");
			}),
		]);
		let beats = 0;
		const win = session.panelWindow;
		const timer = win.setInterval(() => beats++, 10);
		this.resources.intervals++;
		let cleared = false;
		const clear = () => {
			if (!cleared) {
				cleared = true;
				win.clearInterval(timer);
				this.resources.intervals--;
			}
		};
		session.cleanups.push(clear);
		await this.delay(session, 100);
		if (session.stopped) return { status: "cancelled" };
		if (settled)
			throw new Error("Workload completed before cancellation; experiment inconclusive");
		client.cancel("probe-dangerous-cancel");
		equal(await pending, { status: "cancelled", reason: "probe-dangerous-cancel" });
		clear();
		const restart = completed(
			await client.submit({ ...request, source: "cat cat", query: "cat" }),
		);
		if (restart.result.matches.length !== 2) throw new Error("Restart result mismatch");
		return {
			status: "completed",
			cancelled: true,
			restartSuccessful: true,
			responsiveBeats: beats,
			warning:
				"Dangerous input ran only in Worker; watchdog is experimental, not a product limit.",
		};
	}
	async benchmark(client) {
		const win = this.contentEl.ownerDocument.defaultView,
			rows = [];
		const cold = [];
		for (let i = 0; i < 3; i++) {
			client.cancel("cold-start-sample");
			const start = win.performance.now();
			completed(
				await client.submit({ operation: "echo", source: "cat", snapshot: snapshot() }),
			);
			cold.push(win.performance.now() - start);
		}
		for (const count of [20, 2000, 20000, 100000])
			for (const [name, operation, transport, query, replacement] of [
				["no-match", "match", "packed", "absent", ""],
				["match-objects", "match", "objects", "cat", ""],
				["match-packed", "match", "packed", "cat", ""],
				["single-suffix", "replaceOne", "objects", "cat", "$'"],
				["all-linear", "replaceAll", "objects", "cat", "$&!"],
			]) {
				const request = {
					operation,
					transport,
					source: "cat ".repeat(count),
					query,
					replacement,
					index: Math.floor(count / 2),
					regexMode: true,
					caseSensitive: false,
					snapshot: snapshot(),
				};
				const sync = [],
					remote = [],
					compute = [],
					decode = [],
					usable = [];
				for (let i = 0; i < 4; i++) {
					const directStart = win.performance.now();
					let expected;
					if (operation === "match")
						expected = { matches: findTextOffsets(request.source, query, true, false) };
					else {
						const prepared = prepareReplacements(
							request.source,
							query,
							replacement,
							true,
							false,
						);
						expected = {
							matches: prepared.matches,
							changes:
								operation === "replaceAll"
									? prepared.all()
									: [prepared.one(request.index)],
						};
					}
					const directMs = win.performance.now() - directStart;
					const start = win.performance.now();
					const result = completed(await client.submit(request, { timeoutMs: 10000 }));
					const roundTrip = win.performance.now() - start,
						decodeStart = win.performance.now();
					const actual = decodeResult(result.result);
					const decodeMs = win.performance.now() - decodeStart;
					equal(actual, expected);
					if (i) {
						sync.push(directMs);
						remote.push(roundTrip);
						compute.push(result.computeMs);
						decode.push(decodeMs);
						usable.push(roundTrip + decodeMs);
					}
				}
				rows.push({
					scenario: name,
					chars: request.source.length,
					candidateMatches: query === "absent" ? 0 : count,
					transport,
					samples: 3,
					syncMedianMs: round(median(sync)),
					roundTripMedianMs: round(median(remote)),
					computeMedianMs: round(median(compute)),
					decodeMedianMs: round(median(decode)),
					usableMedianMs: round(median(usable)),
				});
			}
		return {
			status: "completed",
			coldStartMs: cold.map(round),
			coldStartMedianMs: round(median(cold)),
			rows,
			boundary:
				"Synthetic benign matching/template expansion only; no DOM indexing, CodeMirror dispatch, peak memory, actual replacement or mobile conclusions.",
		};
	}
	async onClose() {
		this.closed = true;
		this.cancel("probe-closed");
		this.plugin.views.delete(this);
		console.info("Text Finder Worker probe cleanup", {
			reason: "view-close",
			resources: { ...this.resources },
			probeBuild: __probeBuild,
		});
		this.contentEl.replaceChildren();
	}
}

export default class WorkerProbePlugin extends Plugin {
	onload() {
		this.disposed = false;
		this.lifecycle = 1;
		this.views = new Set();
		this.registerView(VIEW, (leaf) => new ProbeView(leaf, this));
		this.addCommand({
			id: "open",
			name: "Open read-only Worker probe",
			callback: async () => {
				const owner = this.app.workspace.getActiveViewOfType(MarkdownView);
				const leaf = this.app.workspace.getLeaf("split");
				try {
					await leaf.setViewState({ type: VIEW, active: true });
					if (this.disposed) {
						leaf.detach();
						return;
					}
					leaf.view.bind(owner);
				} catch (error) {
					leaf.detach();
					if (!this.disposed) new Notice(`Probe could not open: ${String(error)}`);
				}
			},
		});
		this.addCommand({
			id: "bind",
			name: "Bind active editor to Worker probe",
			callback: () => {
				const owner = this.app.workspace.getActiveViewOfType(MarkdownView);
				const latest = [...this.views].at(-1);
				if (!owner || !latest) {
					new Notice("先打开探针，再激活编辑模式 Markdown 执行绑定命令。");
					return;
				}
				latest.bind(owner);
			},
		});
		const check = () => {
			for (const view of this.views) {
				const captured = view.active?.captured;
				if (captured) {
					const reason = ownerInvalidation(this.app.workspace, captured, this.lifecycle);
					if (reason) view.cancel(reason);
				}
			}
		};
		for (const event of ["editor-change", "file-open", "layout-change", "active-leaf-change"])
			this.registerEvent(this.app.workspace.on(event, check));
	}
	onunload() {
		this.disposed = true;
		this.lifecycle++;
		for (const view of this.views) {
			view.cancel("plugin-unloaded");
			console.info("Text Finder Worker probe cleanup", {
				reason: "plugin-unload",
				resources: { ...view.resources },
				probeBuild: __probeBuild,
			});
		}
		this.app.workspace.detachLeavesOfType(VIEW);
		this.views.clear();
	}
}
