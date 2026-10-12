import { Worker as NodeWorker } from "node:worker_threads";

// Node-backed browser API for real production Worker source. Does not prove CSP.
export function installWorkerHost(win) {
	const blobs = new Map(), workers = [], revoked = [];
	let sequence = 0;
	win.Blob = class { constructor(parts) { this.source = parts.join(""); } };
	win.URL.createObjectURL = (blob) => { const url = `blob:production-${++sequence}`; blobs.set(url, blob.source); return url; };
	win.URL.revokeObjectURL = (url) => { revoked.push(url); blobs.delete(url); };
	win.Worker = class {
		constructor(url) {
			this.listeners = new Map(); this.requests = [];
			this.worker = new NodeWorker(`const {parentPort} = require('node:worker_threads');
				globalThis.postMessage = (reply, transfer) => parentPort.postMessage(reply, transfer);
				parentPort.on('message', data => globalThis.onmessage({data}));\n${blobs.get(url)}`,
			{ eval: true, stdout: true, stderr: true });
			this.worker.stdout.resume(); this.worker.stderr.resume();
			this.worker.on("message", (data) => this.emit("message", { data }));
			this.worker.on("error", (error) => this.emit("error", { message: error.message, preventDefault() {} }));
			workers.push(this);
		}
		emit(type, event) { this.listeners.get(type)?.forEach((fn) => fn(event)); }
		addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
		removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
		postMessage(request) { this.requests.push(request); this.worker.postMessage(request); }
		terminate() { this.terminated = true; this.termination = this.worker.terminate(); }
	};
	return { win, workers, blobs, revoked, async dispose() { await Promise.all(workers.map((worker) => worker.termination ?? worker.worker.terminate())); } };
}
