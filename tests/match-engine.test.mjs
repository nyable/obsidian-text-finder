import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { matchWorkerPlugin } from "../tools/match-worker-build.mjs";
import { installWorkerHost } from "./match-worker-host.mjs";
import { workerCases } from "./worker-experiment-cases.mjs";
import { loadSource } from "./source-loader.mjs";

const bundle = await build({ entryPoints: ["src/match-engine.ts"], bundle: true, write: false,
	format: "cjs", platform: "browser", plugins: [matchWorkerPlugin()] });
const module = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(module, module.exports);
const { MatchEngine } = module.exports;
const helper = loadSource("../src/util/text-helper.ts");
const options = { regexMode: true, caseSensitive: false };

test("production bundle reuses exact helper semantics across 92 Worker comparisons", async (t) => {
	t.mock.method(console, "log", () => {});
	const host = installWorkerHost({ URL: {} });
	const engine = new MatchEngine(() => host.win);
	t.after(async () => { engine.destroy(); await host.dispose(); });
	for (const entry of workerCases) for (const regexMode of [true, false]) for (const caseSensitive of [true, false]) {
		const result = await engine.match(entry.source, entry.query, { regexMode, caseSensitive });
		assert.equal(result.status, "completed"); assert.equal(result.synchronous, false);
		assert.deepEqual(result.matches, helper.findTextOffsets(entry.source, entry.query, regexMode, caseSensitive));
	}
	assert.equal(host.workers.length, 1, "idle Worker reused");
	engine.destroy(); assert.equal(host.blobs.size, 0);
	assert.ok(host.workers.every((worker) => [...worker.listeners.values()].every((listeners) => !listeners.size)));
});

test("superseding during startup resolves old request and isolates another owner lane", async (t) => {
	const host = installWorkerHost({ URL: {} });
	const a = new MatchEngine(() => host.win), b = new MatchEngine(() => host.win);
	t.after(async () => { a.destroy(); b.destroy(); await host.dispose(); });
	const old = a.match("cat cat", "cat", options), independent = b.match("dog dog", "dog", options);
	const latest = a.match("tail cat", "cat", options);
	assert.deepEqual(await old, { status: "cancelled" });
	assert.equal((await independent).matches.length, 2); assert.equal((await latest).matches[0].from, 5);
	assert.equal(host.workers[0].terminated, true);
});

function fakeWindow() {
	const workers = [], revoked = [];
	const win = { URL: { createObjectURL: () => "blob:fake", revokeObjectURL: (url) => revoked.push(url) }, Blob: class {},
		Worker: class {
			constructor() { this.listeners = new Map(); this.requests = []; workers.push(this); }
			addEventListener(type, fn) { this.listeners.set(type, fn); }
			removeEventListener(type) { this.listeners.delete(type); }
			postMessage(request) { this.requests.push(request); }
			terminate() { this.terminated = true; }
			emit(type, event) { this.listeners.get(type)?.(event); }
		} };
	return { win, workers, revoked };
}

for (const scenario of ["missing-api", "constructor", "initialization-error", "startup-timeout"]) {
	test(`pre-query ${scenario} selects sync compatibility once without limiting regex`, async () => {
		const h = fakeWindow(); let notices = 0;
		if (scenario === "missing-api") h.win.Worker = undefined;
		if (scenario === "constructor") h.win.Worker = class { constructor() { throw new Error("CSP denied"); } };
		const engine = new MatchEngine(() => h.win, () => notices++, 15);
		const result = engine.match("foobar", "(?<=foo)bar", options);
		if (scenario === "initialization-error") h.workers[0].emit("error", { message: "startup denied", preventDefault() {} });
		const completed = await result; assert.equal(completed.status, "completed"); assert.equal(completed.synchronous, true);
		assert.deepEqual(completed.matches, [{ from: 3, to: 6, index: 0 }]);
		assert.equal((await engine.match("cat cat", "cat", options)).matches.length, 2);
		assert.equal(notices, 1); engine.destroy(); assert.ok(h.workers.every((worker) => worker.terminated));
	});
}

test("post-submission Worker failure is explicit and never replays helper synchronously", async () => {
	const h = fakeWindow(); let notices = 0;
	const engine = new MatchEngine(() => h.win, () => notices++);
	const pending = engine.match("cat", "cat", options), worker = h.workers[0];
	worker.emit("message", { data: { type: "ready" } }); assert.equal(worker.requests.length, 1);
	worker.emit("error", { message: "execution failed", preventDefault() {} });
	assert.equal((await pending).status, "failed"); assert.equal(notices, 0); assert.equal(worker.terminated, true);
	const retry = engine.match("cat", "cat", options); const fresh = h.workers[1]; fresh.emit("message", { data: { type: "ready" } });
	fresh.emit("message", { data: { type: "result", id: fresh.requests[0].id, offsets: new Float64Array([0, 3]).buffer } });
	assert.equal((await retry).synchronous, false); engine.destroy();
});

test("wrong request IDs and malformed result coordinates cannot publish matches", async () => {
	const h = fakeWindow(), engine = new MatchEngine(() => h.win);
	const pending = engine.match("cat", "cat", options), worker = h.workers[0]; worker.emit("message", { data: { type: "ready" } });
	worker.emit("message", { data: { type: "result", id: -1, offsets: new Float64Array([0, 3]).buffer } });
	assert.ok(engine.pending);
	worker.emit("message", { data: { type: "result", id: worker.requests[0].id, offsets: new Float64Array([0, 4]).buffer } });
	assert.equal((await pending).status, "failed"); engine.destroy();
});

test("cancel is inert to late callbacks, frees every resource and destroy refuses new queries", async () => {
	const h = fakeWindow(), engine = new MatchEngine(() => h.win);
	const pending = engine.match("cat", "cat", options), worker = h.workers[0];
	const lateMessage = worker.listeners.get("message"); engine.cancel();
	assert.deepEqual(await pending, { status: "cancelled" });
	lateMessage({ data: { type: "ready" } }); assert.equal(worker.requests.length, 0);
	assert.equal(worker.listeners.size, 0); assert.equal(h.revoked.length, 1);
	engine.destroy(); assert.deepEqual(engine.match("cat", "cat", options), { status: "cancelled" });
});

test("window migration replaces connection and does not carry old fallback policy", async () => {
	const first = fakeWindow(), second = fakeWindow(); let win = first.win;
	first.win.Worker = undefined;
	const engine = new MatchEngine(() => win);
	assert.equal((await engine.match("cat", "cat", options)).synchronous, true);
	win = second.win;
	const pending = engine.match("cat", "cat", options), worker = second.workers[0]; worker.emit("message", { data: { type: "ready" } });
	worker.emit("message", { data: { type: "result", id: worker.requests[0].id, offsets: new Float64Array([0, 3]).buffer } });
	assert.equal((await pending).synchronous, false); engine.destroy();
});

test("slow running computation is not replayed or terminated by the initialization deadline", async () => {
	const h = fakeWindow(), engine = new MatchEngine(() => h.win, () => { throw new Error("unexpected fallback"); }, 10);
	const pending = engine.match("cat", "cat", options), worker = h.workers[0];
	worker.emit("message", { data: { type: "ready" } });
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.ok(engine.pending); assert.notEqual(worker.terminated, true);
	engine.cancel(); assert.deepEqual(await pending, { status: "cancelled" });
});

test("owner window closing cancels even an idle connection and unregisters listeners", async () => {
	const h = fakeWindow(), events = new Map();
	h.win.addEventListener = (name, fn) => events.set(name, fn);
	h.win.removeEventListener = (name) => events.delete(name);
	const engine = new MatchEngine(() => h.win), pending = engine.match("cat", "cat", options);
	events.get("pagehide")(); assert.deepEqual(await pending, { status: "cancelled" });
	assert.equal(events.size, 0); assert.equal(h.workers[0].terminated, true); engine.destroy();
});
