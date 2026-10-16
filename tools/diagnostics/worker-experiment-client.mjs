// Test-only latest-request lane. Cancelling a busy worker terminates execution;
// sending a cancel message alone cannot interrupt synchronous RegExp.exec.
// Snapshot fields are labels, not a substitute for production Editor/doc checks.
const snapshotKeys = ["owner", "file", "documentVersion", "queryVersion", "lifecycle"];
const sameSnapshot = (a, b) => a && b && snapshotKeys.every((key) => a[key] === b[key]);

export function decodeResult(result) {
	if (!result.packedOffsets) return result;
	const offsets = new Float64Array(result.packedOffsets);
	return {
		matches: Array.from({ length: offsets.length / 2 }, (_, index) => ({
			from: offsets[index * 2],
			to: offsets[index * 2 + 1],
			index,
		})),
	};
}

export class WorkerExperimentClient {
	constructor(factory, isCurrent = () => true) {
		this.factory = factory;
		this.isCurrent = isCurrent;
		this.connection = null;
		this.pending = null;
		this.sequence = 0;
		this.disposed = false;
		this.terminations = [];
	}
	start() {
		const connection = this.factory();
		this.connection = connection;
		connection.ready = false;
		connection.offMessage = connection.onMessage((message) => {
			if (this.connection !== connection) return;
			if (message.type === "ready") {
				connection.ready = true;
				if (this.pending) connection.postMessage(this.pending.request);
				return;
			}
			const job = this.pending;
			if (!job || message.id !== job.request.id) return;
			if (message.type === "started") {
				job.onStarted?.();
				return;
			}
			if (message.type !== "result" && message.type !== "failed") return;
			if (
				!sameSnapshot(message.snapshot, job.request.snapshot) ||
				!this.isCurrent(job.request.snapshot)
			) {
				this.finish({ status: "cancelled", reason: "stale-snapshot" });
				return;
			}
			if (message.type === "failed") {
				this.finish({ status: "failed", error: message.error });
				return;
			}
			this.finish({
				status: "completed",
				result: message.result,
				computeMs: message.computeMs,
			});
		});
		connection.offError = connection.onError((error) => {
			if (this.connection !== connection) return;
			this.finish({ status: "failed", error: String(error) });
			this.stop();
		});
	}
	finish(result) {
		const job = this.pending;
		this.pending = null;
		if (job) {
			clearTimeout(job.timer);
			job.resolve(result);
		}
	}
	stop() {
		const connection = this.connection;
		this.connection = null;
		if (connection) {
			connection.offMessage?.();
			connection.offError?.();
			this.terminations.push(Promise.resolve(connection.terminate()));
		}
	}
	cancel(reason = "cancelled") {
		this.finish({ status: "cancelled", reason });
		this.stop();
	}
	submit(request, { timeoutMs = 5000, onStarted } = {}) {
		if (this.disposed) return Promise.resolve({ status: "cancelled", reason: "disposed" });
		if (this.pending) this.cancel("superseded");
		return new Promise((resolve) => {
			const cloned = structuredClone({ ...request, id: ++this.sequence });
			this.pending = {
				request: cloned,
				resolve,
				onStarted,
				timer: setTimeout(() => {
					this.finish({ status: "timeout" });
					this.stop();
				}, timeoutMs),
			};
			try {
				if (!this.connection) this.start();
				if (this.connection.ready) this.connection.postMessage(cloned);
			} catch (error) {
				this.finish({ status: "failed", error: String(error) });
				this.stop();
			}
		});
	}
	async dispose() {
		this.disposed = true;
		this.cancel("disposed");
		await Promise.all(this.terminations);
	}
}
