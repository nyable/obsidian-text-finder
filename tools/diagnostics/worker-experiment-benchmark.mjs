// Opt-in, benign requests only. Includes startup/clone/scheduling costs rather
// than pretending round-trip minus compute is pure transfer time.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { nodeExperiment } from "./worker-experiment-node.mjs";
import { decodeResult } from "./worker-experiment-client.mjs";
import { snapshot } from "./worker-experiment-cases.mjs";
import * as helper from "../../src/core/search/text-matching.ts";
const round = (value) => Math.round(value * 100) / 100;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function synchronous(request) {
	if (request.operation === "echo") return { source: request.source };
	if (request.operation === "match")
		return { matches: helper.findTextOffsets(request.source, request.query, true, false) };
	const prepared = helper.prepareReplacements(
		request.source,
		request.query,
		request.replacement,
		true,
		false,
	);
	const one = request.operation === "replaceOne" ? prepared.one(request.index) : undefined;
	return {
		matches: prepared.matches,
		changes: request.operation === "replaceAll" ? prepared.all() : one ? [one] : [],
	};
}
async function measured(client, request) {
	const start = performance.now();
	const response = await client.submit(request, { timeoutMs: 10000 });
	const roundTripMs = performance.now() - start;
	assert.equal(
		response.status,
		"completed",
		response.error?.stack ?? String(response.error ?? ""),
	);
	return { roundTripMs, computeMs: response.computeMs, response };
}

console.log(
	JSON.stringify({
		node: process.version,
		arch: process.arch,
		platform: process.platform,
		boundary:
			"Node worker_threads, not Obsidian browser Worker. Object-array clone versus Float64 buffer transfer, no result cap. Timings exclude parent TS compilation. Memory is process heap delta, not peak/worker heap.",
	}),
);
const cold = [];
for (let i = 0; i < 5; i++) {
	const client = nodeExperiment();
	try {
		cold.push(
			(await measured(client, { operation: "echo", source: "cat", snapshot: snapshot() }))
				.roundTripMs,
		);
	} finally {
		await client.dispose();
	}
}
console.log(
	JSON.stringify({
		scenario: "cold-start-and-tiny-echo",
		samples: cold.map(round),
		medianMs: round(median(cold)),
	}),
);

const client = nodeExperiment();
try {
	await measured(client, { operation: "echo", source: "warmup", snapshot: snapshot() });
	for (const repeats of [20, 2000, 20000, 100000]) {
		for (const [name, operation, query, replacement, transport] of [
			["echo", "echo", "", ""],
			["no-match", "match", "absent", ""],
			["dense-match", "match", "(cat)", ""],
			["single-suffix", "replaceOne", "(cat)", "$'"],
			["dense-packed", "match", "(cat)", "", "packed"],
			["all-linear", "replaceAll", "(cat)", "$1!"],
		]) {
			const request = {
				snapshot: snapshot(),
				source: "cat ".repeat(repeats),
				operation,
				query,
				replacement,
				regexMode: true,
				caseSensitive: false,
				transport,
				index: Math.floor(repeats / 2),
			};
			globalThis.gc?.();
			const heapBefore = process.memoryUsage().heapUsed;
			const expected = synchronous(request);
			await measured(client, request);
			const local = [],
				remote = [],
				compute = [],
				overhead = [],
				decode = [],
				usable = [];
			let result;
			for (let sample = 0; sample < 7; sample++) {
				const sync = () => {
					const start = performance.now();
					synchronous(request);
					local.push(performance.now() - start);
				};
				if (sample % 2 === 0) sync();
				const value = await measured(client, request);
				const decodeStart = performance.now();
				result = decodeResult(value.response.result);
				const decodeMs = performance.now() - decodeStart;
				decode.push(decodeMs);
				usable.push(value.roundTripMs + decodeMs);
				remote.push(value.roundTripMs);
				compute.push(value.computeMs);
				overhead.push(value.roundTripMs - value.computeMs);
				if (sample % 2) sync();
			}
			assert.deepEqual(result, expected);
			console.log(
				JSON.stringify({
					scenario: name,
					sourceChars: request.source.length,
					matches: result.matches?.length ?? null,
					changes: result.changes?.length ?? null,
					samples: 7,
					syncMedianMs: round(median(local)),
					workerRoundTripMedianMs: round(median(remote)),
					workerComputeMedianMs: round(median(compute)),
					decodeMedianMs: round(median(decode)),
					usableMedianMs: round(median(usable)),
					nonComputeMedianMs: round(median(overhead)),
					parentHeapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
				}),
			);
		}
	}
} finally {
	await client.dispose();
}
