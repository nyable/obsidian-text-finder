// OPT-IN only: a deliberately pathological regex runs exclusively in a worker.
// The parent watchdog terminates the worker; never run this input synchronously.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { nodeExperiment } from "./worker-experiment-node.mjs";
import { snapshot } from "./worker-experiment-cases.mjs";

if (!process.argv.includes("--dangerous"))
	throw new Error(
		"Explicit opt-in required: node tools/diagnostics/worker-experiment-cancel.mjs --dangerous",
	);
const round = (value) => Math.round(value * 100) / 100;
const client = nodeExperiment();
let heartbeat = 0;
const interval = setInterval(() => heartbeat++, 10);
try {
	const request = {
		operation: "match",
		source: "a".repeat(10000) + "!",
		query: "(a+)+$",
		regexMode: true,
		caseSensitive: true,
		snapshot: snapshot(),
	};
	const warmup = await client.submit({ ...request, source: "cat", query: "cat" });
	assert.equal(warmup.status, "completed");
	let started;
	const starting = new Promise((resolve) => {
		started = resolve;
	});
	let settled = false;
	const result = client.submit(request, { timeoutMs: 2000, onStarted: started }).then((value) => {
		settled = true;
		return value;
	});
	await Promise.race([
		starting,
		result.then(() => {
			throw new Error("Request ended before execution started");
		}),
	]);
	const start = performance.now(),
		beats = heartbeat;
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(settled, false, "This workload must still be executing when cancelled");
	const responsiveBeats = heartbeat - beats;
	const cancelStart = performance.now();
	client.cancel("explicit-experiment-cancel");
	assert.deepEqual(await result, { status: "cancelled", reason: "explicit-experiment-cancel" });
	await Promise.all(client.terminations);
	const terminationMs = performance.now() - cancelStart;
	const restarted = await client.submit({ ...request, source: "cat cat", query: "cat" });
	assert.equal(restarted.status, "completed");
	assert.equal(restarted.result.matches.length, 2);
	const watchdog = await client.submit(request, { timeoutMs: 100 });
	assert.deepEqual(watchdog, { status: "timeout" });
	let busyStarted;
	const busyReady = new Promise((resolve) => {
		busyStarted = resolve;
	});
	const busy = client.submit(request, { timeoutMs: 2000, onStarted: busyStarted });
	await Promise.race([
		busyReady,
		busy.then(() => {
			throw new Error("Busy request ended before start");
		}),
	]);
	const latest = client.submit({
		...request,
		source: "cat",
		query: "cat",
		snapshot: { ...snapshot(), queryVersion: 2 },
	});
	assert.deepEqual(await busy, { status: "cancelled", reason: "superseded" });
	assert.equal((await latest).status, "completed");
	console.log(
		JSON.stringify(
			{
				node: process.version,
				observedBusyMs: round(cancelStart - start),
				responsiveBeats,
				terminationMs: round(terminationMs),
				restartSuccessful: true,
				watchdogStatus: watchdog.status,
				busySupersedeSuccessful: true,
				boundary:
					"Node native RegExp worker termination only. Experimental watchdog values are not product limits.",
			},
			null,
			2,
		),
	);
} finally {
	clearInterval(interval);
	await client.dispose();
}
