import assert from "node:assert/strict";
import test from "node:test";
import { nodeExperiment } from "./worker-experiment-node.mjs";
import { WorkerExperimentClient, decodeResult } from "./worker-experiment-client.mjs";
import { workerCases, snapshot } from "./worker-experiment-cases.mjs";
import { loadSource } from "./source-loader.mjs";

const helper = loadSource("../src/util/text-helper.ts");
test("Node Worker matches current full-source search and replacement semantics", async (t) => {
	t.mock.method(console, "log", () => {});
	const client = nodeExperiment(); t.after(() => client.dispose());
	for (const entry of workerCases) for (const regexMode of [true, false]) for (const caseSensitive of [true, false]) {
		const request = { ...entry, regexMode, caseSensitive, snapshot: snapshot() };
		const matches = helper.findTextOffsets(entry.source, entry.query, regexMode, caseSensitive);
		const result = await client.submit({ ...request, operation: "match" });
		assert.equal(result.status, "completed"); assert.deepEqual(result.result.matches, matches);
		const packed = await client.submit({ ...request, operation: "match", transport: "packed" });
		assert.equal(packed.status, "completed"); assert.deepEqual(decodeResult(packed.result).matches, matches);
		const prepared = helper.prepareReplacements(entry.source, entry.query, entry.replacement, regexMode, caseSensitive);
		for (const index of [-1, 0, matches.length - 1, matches.length]) {
			const result = await client.submit({ ...request, operation: "replaceOne", index });
			const one = prepared.one(index);
			assert.equal(result.status, "completed"); assert.deepEqual(result.result, { matches, changes: one ? [one] : [] });
		}
		const all = await client.submit({ ...request, operation: "replaceAll" });
		assert.equal(all.status, "completed"); assert.deepEqual(all.result, { matches, changes: prepared.all() });
	}
});

// A fake connection deliberately delivers late messages, including after stop.
function fakeEnvironment(isCurrent) {
	const connections = [];
	const client = new WorkerExperimentClient(() => {
		const connection = { requests: [], terminated: false,
			postMessage(request) { this.requests.push(request); },
			onMessage(callback) { this.message = callback; return () => {}; },
			onError(callback) { this.error = callback; return () => {}; },
			terminate() { this.terminated = true; },
		};
		connections.push(connection); return connection;
	}, isCurrent);
	const respond = (connection, extra = {}) => {
		const request = connection.requests.at(-1);
		connection.message({ type: "result", id: request.id, snapshot: request.snapshot, result: { matches: [] }, ...extra });
	};
	return { client, connections, respond };
}
const request = () => ({ snapshot: snapshot(), operation: "match", source: "cat", query: "cat", regexMode: false, caseSensitive: false });

test("superseding busy requests terminates the old worker and rejects its late result", async (t) => {
	const h = fakeEnvironment(); t.after(() => h.client.dispose());
	const oldResult = h.client.submit(request()); const old = h.connections[0]; old.message({ type: "ready" });
	const latestResult = h.client.submit(request()); const latest = h.connections[1]; latest.message({ type: "ready" });
	assert.equal(old.terminated, true); assert.deepEqual(await oldResult, { status: "cancelled", reason: "superseded" });
	h.respond(old); h.respond(latest); assert.equal((await latestResult).status, "completed");
});

for (const key of ["owner", "file", "documentVersion", "queryVersion", "lifecycle"]) {
	test(`changed ${key} invalidates a returned Worker snapshot`, async (t) => {
		const current = snapshot(); const h = fakeEnvironment((value) => value[key] === current[key]);
		t.after(() => h.client.dispose());
		const result = h.client.submit(request()); const connection = h.connections[0]; connection.message({ type: "ready" });
		current[key] = "changed"; h.respond(connection);
		assert.deepEqual(await result, { status: "cancelled", reason: "stale-snapshot" });
	});
}

test("transport snapshots are independent and reply identity mismatches are not published", async (t) => {
	const h = fakeEnvironment(); t.after(() => h.client.dispose());
	const input = request(); const result = h.client.submit(input); input.snapshot.file = "other.md";
	const connection = h.connections[0]; connection.message({ type: "ready" });
	assert.equal(connection.requests[0].snapshot.file, "note.md");
	h.respond(connection, { snapshot: { ...snapshot(), owner: "wrong-owner" } });
	assert.equal((await result).reason, "stale-snapshot");
});

test("dispose terminates resources and refuses new work without treating cancellation as no matches", async () => {
	const h = fakeEnvironment(); const pending = h.client.submit(request());
	await h.client.dispose(); assert.equal(h.connections[0].terminated, true);
	assert.deepEqual(await pending, { status: "cancelled", reason: "disposed" });
	assert.deepEqual(await h.client.submit(request()), { status: "cancelled", reason: "disposed" });
});

test("worker failure and experimental watchdog resolve explicitly and release the lane", async (t) => {
	const h = fakeEnvironment(); t.after(() => h.client.dispose());
	const failure = h.client.submit(request()); h.connections[0].error(new Error("worker failed"));
	assert.equal((await failure).status, "failed"); assert.equal(h.connections[0].terminated, true);
	const timeout = h.client.submit(request(), { timeoutMs: 20 });
	assert.deepEqual(await timeout, { status: "timeout" }); assert.equal(h.connections[1].terminated, true);
});

test("packed transport retains UTF-16 coordinate precision beyond 32 bits", () => {
	const buffer = Float64Array.from([2 ** 32 + 1, 2 ** 32 + 3]).buffer;
	assert.deepEqual(decodeResult({ packedOffsets: buffer }), { matches: [{ from: 4294967297, to: 4294967299, index: 0 }] });
});

test("replacement worker failure is explicit rather than masquerading as an empty successful edit", async (t) => {
	const client = nodeExperiment(); t.after(() => client.dispose());
	const result = await client.submit({ ...request(), operation: "replaceAll", regexMode: true, replacement: {} });
	assert.equal(result.status, "failed");
	assert.equal((await client.submit(request())).status, "completed");
});

test("real Worker startup can be superseded and replaced without leaving accepted requests pending", async (t) => {
	const client = nodeExperiment(); t.after(() => client.dispose());
	const old = client.submit(request());
	const latest = client.submit({ ...request(), source: "cat cat", snapshot: { ...snapshot(), queryVersion: 2 } });
	assert.deepEqual(await old, { status: "cancelled", reason: "superseded" });
	const result = await latest; assert.equal(result.status, "completed"); assert.equal(result.result.matches.length, 2);
	await Promise.all(client.terminations);
});

test("incorrect reply request IDs cannot settle the currently accepted operation", async (t) => {
	const h = fakeEnvironment(); t.after(() => h.client.dispose());
	let settled = false;
	const result = h.client.submit(request()).then((value) => { settled = true; return value; });
	const connection = h.connections[0]; connection.message({ type: "ready" });
	h.respond(connection, { id: -1 }); await Promise.resolve(); assert.equal(settled, false);
	h.respond(connection); assert.equal((await result).status, "completed");
});
