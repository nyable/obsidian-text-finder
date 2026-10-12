// Bundled into an optional standalone harness, never into the plugin.
import { WorkerExperimentClient, decodeResult } from "./worker-experiment-client.mjs";
import { workerCases, snapshot } from "./worker-experiment-cases.mjs";
import { findTextOffsets, prepareReplacements } from "../src/util/text-helper.ts";

function browserExperiment() {
	return new WorkerExperimentClient(() => {
		const url = URL.createObjectURL(new Blob([__workerSource], { type: "text/javascript" }));
		let worker;
		try { worker = new Worker(url); }
		catch (error) { URL.revokeObjectURL(url); throw error; }
		return {
			postMessage: (value) => worker.postMessage(value),
			onMessage(callback) { const listen = (event) => callback(event.data); worker.addEventListener("message", listen); return () => worker.removeEventListener("message", listen); },
			onError(callback) {
				const listen = (event) => { event.preventDefault(); callback(new Error(event.message ?? "Worker message error")); };
				worker.addEventListener("error", listen); worker.addEventListener("messageerror", listen);
				return () => { worker.removeEventListener("error", listen); worker.removeEventListener("messageerror", listen); };
			},
			terminate() { worker.terminate(); URL.revokeObjectURL(url); },
		};
	});
}
function assertEqual(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Worker and direct result differ");
}
const output = document.querySelector("pre");
let active;
async function run(action) {
	document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
	const client = browserExperiment(); active = client;
	try {
		output.textContent = "Running…";
		const result = await action(client);
		output.textContent = JSON.stringify({ userAgent: navigator.userAgent,
			boundary: "Standalone browser harness, not Obsidian CSP/mobile/owner/CodeMirror integration", ...result }, null, 2);
	} catch (error) { output.textContent = String(error.stack ?? error); }
	finally { await client.dispose(); active = null; document.querySelectorAll("button").forEach((button) => { button.disabled = false; }); }
}
document.querySelector("#safe").addEventListener("click", () => run(async (client) => {
	let comparisons = 0;
	for (const entry of workerCases) for (const regexMode of [true, false]) for (const caseSensitive of [true, false]) {
		const request = { ...entry, regexMode, caseSensitive, snapshot: snapshot() };
		const prepared = prepareReplacements(entry.source, entry.query, entry.replacement, regexMode, caseSensitive);
		for (const operation of ["match", "replaceOne", "replaceAll"]) {
			const result = await client.submit({ ...request, operation, index: 0 });
			if (result.status !== "completed") throw new Error(`Worker ${result.status}`);
			const one = prepared.one(0);
			assertEqual(result.result, operation === "match"
				? { matches: findTextOffsets(entry.source, entry.query, regexMode, caseSensitive) }
				: { matches: prepared.matches, changes: operation === "replaceAll" ? prepared.all() : one ? [one] : [] });
			comparisons++;
		}
		const packed = await client.submit({ ...request, operation: "match", transport: "packed" });
		if (packed.status !== "completed") throw new Error(`Worker ${packed.status}`);
		assertEqual(decodeResult(packed.result), { matches: prepared.matches }); comparisons++;
	}
	return { comparisons, passed: true };
}));
document.querySelector("#cancel").addEventListener("click", () => run(async (client) => {
	const request = { operation: "match", source: "a".repeat(10000) + "!", query: "(a+)+$", regexMode: true, caseSensitive: true, snapshot: snapshot() };
	let started; const ready = new Promise((resolve) => { started = resolve; });
	let settled = false;
	const pending = client.submit(request, { timeoutMs: 2000, onStarted: started }).then((value) => { settled = true; return value; });
	await Promise.race([ready, pending.then(() => { throw new Error("Request ended before execution started"); })]);
	let beats = 0; const timer = setInterval(() => beats++, 10);
	try {
		await new Promise((resolve) => setTimeout(resolve, 100));
		if (settled) throw new Error("Workload completed before cancellation; experiment inconclusive");
		client.cancel("browser-experiment-cancel"); assertEqual(await pending, { status: "cancelled", reason: "browser-experiment-cancel" });
		const restart = await client.submit({ ...request, source: "cat cat", query: "cat" });
		if (restart.status !== "completed" || restart.result.matches.length !== 2) throw new Error("Restart failed");
		return { cancelled: true, restartSuccessful: true, responsiveBeats: beats,
			warning: "Deliberately dangerous regex ran only in a Worker, never in direct comparison" };
	} finally { clearInterval(timer); }
}));
window.addEventListener("pagehide", () => { void active?.dispose(); });
