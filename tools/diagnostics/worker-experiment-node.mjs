import { Worker } from "node:worker_threads";
import { WorkerExperimentClient } from "./worker-experiment-client.mjs";
import { workerSource } from "./worker-experiment-source.mjs";

// Compile once in the parent; worker startup never loads TypeScript or the repo.
export function nodeExperiment(isCurrent) {
	const source = workerSource("node");
	return new WorkerExperimentClient(() => {
		// Parent CLI flags (--input-type, --expose-gc, eval) are not Worker
		// execution requirements and some are rejected by worker_threads.
		const worker = new Worker(source, { eval: true, stdout: true, stderr: true, execArgv: [] });
		// Invalid regex diagnostics are intentionally not part of the protocol.
		worker.stdout.resume();
		worker.stderr.resume();
		return {
			postMessage: (message) => worker.postMessage(message),
			onMessage: (callback) => {
				worker.on("message", callback);
				return () => worker.off("message", callback);
			},
			onError: (callback) => {
				const exit = (code) => callback(new Error(`Worker unexpectedly exited (${code})`));
				worker.on("error", callback);
				worker.on("exit", exit);
				return () => {
					worker.off("error", callback);
					worker.off("exit", exit);
				};
			},
			terminate: () => worker.terminate(),
		};
	}, isCurrent);
}
