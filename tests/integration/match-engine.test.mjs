import assert from "node:assert/strict";
import { test, vi, onTestFinished } from "vitest";
import { installWorkerHost } from "../match-worker-host.mjs";
import { workerCases } from "../../tools/diagnostics/worker-experiment-cases.mjs";
import { MatchEngine } from "../../src/platform/browser/match-engine";
import * as helper from "../../src/core/search/text-matching";
const options = { regexMode: true, caseSensitive: false };

test("selection ranges share exact Worker and fallback semantics for find and replacement", async () => {
	const host = installWorkerHost({ URL: {} }),
		worker = new MatchEngine(() => host.win),
		fallback = new MatchEngine(() => ({}));
	onTestFinished(async () => {
		worker.destroy();
		fallback.destroy();
		await host.dispose();
	});
	for (const [source, query, ranges] of [
		["cat A cat\ncat B cat", "cat", [{ from: 6, to: 13 }]],
		["aaa", "aa", [{ from: 1, to: 3 }]],
		["foobar", "(?<=foo)bar", [{ from: 3, to: 6 }]],
		["foobar", "^bar", [{ from: 3, to: 6 }]],
		[
			"cat cat cat",
			"cat",
			[
				{ from: 0, to: 3 },
				{ from: 8, to: 11 },
			],
		],
		["cat", "cat", []],
	])
		for (const wholeWord of [false, true]) {
			const opts = { ...options, wholeWord },
				prepared = helper.prepareReplacements(
					source,
					query,
					"$&:$`:$'",
					true,
					false,
					wholeWord,
					ranges,
				);
			for (const engine of [worker, fallback]) {
				assert.deepEqual(
					(await engine.match(source, query, opts, ranges)).matches,
					prepared.matches,
				);
				for (const all of [false, true]) {
					const result = await engine.replace(
						source,
						query,
						"$&:$`:$'",
						opts,
						0,
						all,
						ranges,
					);
					assert.deepEqual(result.matches, prepared.matches);
					assert.deepEqual(
						result.changes,
						all ? prepared.all() : prepared.one(0) ? [prepared.one(0)] : [],
					);
				}
			}
		}
});

test("Worker protocol refuses coordinates outside the captured range", async () => {
	const h = fakeWindow(),
		engine = new MatchEngine(() => h.win);
	const pending = engine.match("cat cat", "cat", options, [{ from: 4, to: 7 }]),
		worker = h.workers[0];
	worker.emit("message", { data: { type: "ready" } });
	worker.emit("message", {
		data: {
			type: "result",
			id: worker.requests[0].id,
			offsets: new Float64Array([0, 3]).buffer,
		},
	});
	assert.equal((await pending).status, "failed");
	engine.destroy();
});

test("nested dollar templates agree with native replacement in Worker and startup fallback", async () => {
	const host = installWorkerHost({ URL: {} });
	const worker = new MatchEngine(() => host.win),
		fallback = new MatchEngine(() => ({}));
	onTestFinished(async () => {
		worker.destroy();
		fallback.destroy();
		await host.dispose();
	});
	for (const query of ["a", "(a)", "(?<value>a)"])
		for (const replacement of ["$<$&>", "$<$1>", "$<x$$>"])
			for (const engine of [worker, fallback])
				for (const all of [false, true]) {
					const result = await engine.replace(
						"ab ab",
						query,
						replacement,
						{ regexMode: true, caseSensitive: true, wholeWord: false },
						0,
						all,
					);
					assert.equal(result.status, "completed");
					let actual = "ab ab";
					for (const change of [...result.changes].reverse())
						actual =
							actual.slice(0, change.from) + change.insert + actual.slice(change.to);
					assert.equal(
						actual,
						"ab ab".replace(new RegExp(query, all ? "gm" : "m"), replacement),
					);
				}
});

test("whole word shares match and replacement semantics across Worker and startup fallback", async () => {
	vi.spyOn(console, "debug").mockImplementation(() => {});
	const host = installWorkerHost({ URL: {} }),
		fallbackWindow = {},
		worker = new MatchEngine(() => host.win),
		fallback = new MatchEngine(() => fallbackWindow);
	onTestFinished(async () => {
		worker.destroy();
		fallback.destroy();
		await host.dispose();
	});
	await fallback.match("cat", "cat", options);
	const cases = [
		...workerCases,
		{ source: "xcat cat Cat cat_name cat2", query: "cat", replacement: "dog" },
		{
			source: "xcat cat Cat cat_name cat2",
			query: "(?<c>c)(at)",
			replacement: "$<c>:$2:$&:$`:$'",
		},
		{ source: "中文 中文内容 中文，内容", query: "中文", replacement: "词" },
		{ source: "C++ C++17 XC++", query: "C++", replacement: "C#" },
		{ source: "😀 e\u0301 xcafé café", query: "café", replacement: "tea" },
		{ source: "x\ncat \ncat", query: "\ncat", replacement: "dog" },
		{ source: "cat\nx cat\n ", query: "cat\n", replacement: "dog" },
	];
	for (const entry of cases)
		for (const regexMode of [false, true])
			for (const caseSensitive of [false, true])
				for (const wholeWord of [false, true]) {
					const options = { regexMode, caseSensitive, wholeWord };
					const prepared = helper.prepareReplacements(
						entry.source,
						entry.query,
						entry.replacement,
						regexMode,
						caseSensitive,
						wholeWord,
					);
					for (const [engine, synchronous] of [
						[worker, false],
						[fallback, true],
					]) {
						const matched = await engine.match(entry.source, entry.query, options);
						assert.equal(matched.status, "completed");
						assert.equal(matched.synchronous, synchronous);
						assert.deepEqual(matched.matches, prepared.matches);
						for (const all of [false, true]) {
							const index = Math.max(0, prepared.matches.length - 1),
								one = prepared.one(index);
							const replaced = await engine.replace(
								entry.source,
								entry.query,
								entry.replacement,
								options,
								index,
								all,
							);
							assert.equal(replaced.status, "completed");
							assert.equal(replaced.synchronous, synchronous);
							assert.deepEqual(replaced.matches, prepared.matches);
							assert.deepEqual(
								replaced.changes,
								all ? prepared.all() : one ? [one] : [],
							);
						}
					}
				}
});

test("production Worker reuses exact helper semantics across 92 comparisons", async () => {
	vi.spyOn(console, "debug").mockImplementation(() => {});
	const host = installWorkerHost({ URL: {} });
	const engine = new MatchEngine(() => host.win);
	onTestFinished(async () => {
		engine.destroy();
		await host.dispose();
	});
	for (const entry of workerCases)
		for (const regexMode of [true, false])
			for (const caseSensitive of [true, false]) {
				const result = await engine.match(entry.source, entry.query, {
					regexMode,
					caseSensitive,
				});
				assert.equal(result.status, "completed");
				assert.equal(result.synchronous, false);
				assert.deepEqual(
					result.matches,
					helper.findTextOffsets(entry.source, entry.query, regexMode, caseSensitive),
				);
			}
	assert.equal(host.workers.length, 1, "idle Worker reused");
	engine.destroy();
	assert.equal(host.blobs.size, 0);
	assert.ok(
		host.workers.every((worker) =>
			[...worker.listeners.values()].every((listeners) => !listeners.size),
		),
	);
});

test("superseding during startup resolves old request and isolates another owner lane", async () => {
	const host = installWorkerHost({ URL: {} });
	const a = new MatchEngine(() => host.win),
		b = new MatchEngine(() => host.win);
	onTestFinished(async () => {
		a.destroy();
		b.destroy();
		await host.dispose();
	});
	const old = a.match("cat cat", "cat", options),
		independent = b.match("dog dog", "dog", options);
	const latest = a.match("tail cat", "cat", options);
	assert.deepEqual(await old, { status: "cancelled" });
	assert.equal((await independent).matches.length, 2);
	assert.equal((await latest).matches[0].from, 5);
	assert.equal(host.workers[0].terminated, true);
});

function fakeWindow() {
	const workers = [],
		revoked = [];
	const win = {
		setTimeout: (...args) => globalThis.setTimeout(...args),
		clearTimeout: (timer) => globalThis.clearTimeout(timer),
		URL: { createObjectURL: () => "blob:fake", revokeObjectURL: (url) => revoked.push(url) },
		Blob: class {},
		Worker: class {
			constructor() {
				this.listeners = new Map();
				this.requests = [];
				workers.push(this);
			}
			addEventListener(type, fn) {
				this.listeners.set(type, fn);
			}
			removeEventListener(type) {
				this.listeners.delete(type);
			}
			postMessage(request) {
				this.requests.push(request);
			}
			terminate() {
				this.terminated = true;
			}
			emit(type, event) {
				this.listeners.get(type)?.(event);
			}
		},
	};
	return { win, workers, revoked };
}

test("startup timers are created and cleared by their captured owner, even after migration", async () => {
	const first = fakeWindow(),
		second = fakeWindow();
	const timers = (host) => {
		const scheduled = new Map(),
			cleared = [];
		host.win.setTimeout = function (callback, delay) {
			assert.equal(this, host.win);
			assert.equal(delay, 3000);
			scheduled.set(17, callback);
			return 17;
		};
		host.win.clearTimeout = function (id) {
			assert.equal(this, host.win);
			assert.equal(id, 17);
			scheduled.delete(id);
			cleared.push(id);
		};
		return { scheduled, cleared };
	};
	const a = timers(first),
		b = timers(second);
	let owner = first.win;
	const engine = new MatchEngine(() => owner);
	onTestFinished(() => engine.destroy());
	const old = engine.match("cat", "cat", options);
	assert.equal(a.scheduled.size, 1);
	owner = second.win;
	const latest = engine.match("cat", "cat", options);
	assert.deepEqual(await old, { status: "cancelled" });
	assert.deepEqual(a.cleared, [17]);
	assert.equal(b.scheduled.size, 1);
	second.workers[0].emit("message", { data: { type: "ready" } });
	assert.deepEqual(b.cleared, [17]);
	engine.destroy();
	assert.deepEqual(await latest, { status: "cancelled" });
	assert.equal(b.cleared.length, 1, "ready timer is not cleared twice");
});

for (const scenario of ["missing-api", "constructor", "initialization-error", "startup-timeout"]) {
	test(`pre-query ${scenario} selects sync compatibility once without limiting regex`, async () => {
		const h = fakeWindow();
		let notices = 0;
		if (scenario === "missing-api") h.win.Worker = undefined;
		if (scenario === "constructor")
			h.win.Worker = class {
				constructor() {
					throw new Error("CSP denied");
				}
			};
		const engine = new MatchEngine(
			() => h.win,
			() => notices++,
			15,
		);
		const result = engine.match("foobar", "(?<=foo)bar", options);
		if (scenario === "initialization-error")
			h.workers[0].emit("error", { message: "startup denied", preventDefault() {} });
		const completed = await result;
		assert.equal(completed.status, "completed");
		assert.equal(completed.synchronous, true);
		assert.deepEqual(completed.matches, [{ from: 3, to: 6, index: 0 }]);
		assert.equal((await engine.match("cat cat", "cat", options)).matches.length, 2);
		assert.equal(notices, 1);
		engine.destroy();
		assert.ok(h.workers.every((worker) => worker.terminated));
	});
}

test("post-submission Worker failure is explicit and never replays helper synchronously", async () => {
	const h = fakeWindow();
	let notices = 0;
	const engine = new MatchEngine(
		() => h.win,
		() => notices++,
	);
	const pending = engine.match("cat", "cat", options),
		worker = h.workers[0];
	worker.emit("message", { data: { type: "ready" } });
	assert.equal(worker.requests.length, 1);
	worker.emit("error", { message: "execution failed", preventDefault() {} });
	assert.equal((await pending).status, "failed");
	assert.equal(notices, 0);
	assert.equal(worker.terminated, true);
	const retry = engine.match("cat", "cat", options);
	const fresh = h.workers[1];
	fresh.emit("message", { data: { type: "ready" } });
	fresh.emit("message", {
		data: {
			type: "result",
			id: fresh.requests[0].id,
			offsets: new Float64Array([0, 3]).buffer,
		},
	});
	assert.equal((await retry).synchronous, false);
	engine.destroy();
});

test("wrong request IDs and malformed result coordinates cannot publish matches", async () => {
	const h = fakeWindow(),
		engine = new MatchEngine(() => h.win);
	const pending = engine.match("cat", "cat", options),
		worker = h.workers[0];
	worker.emit("message", { data: { type: "ready" } });
	worker.emit("message", {
		data: { type: "result", id: -1, offsets: new Float64Array([0, 3]).buffer },
	});
	assert.ok(engine.pending);
	worker.emit("message", {
		data: {
			type: "result",
			id: worker.requests[0].id,
			offsets: new Float64Array([0, 4]).buffer,
		},
	});
	assert.equal((await pending).status, "failed");
	engine.destroy();
});

test("cancel is inert to late callbacks, frees every resource and destroy refuses new queries", async () => {
	const h = fakeWindow(),
		engine = new MatchEngine(() => h.win);
	const pending = engine.match("cat", "cat", options),
		worker = h.workers[0];
	const lateMessage = worker.listeners.get("message");
	engine.cancel();
	assert.deepEqual(await pending, { status: "cancelled" });
	lateMessage({ data: { type: "ready" } });
	assert.equal(worker.requests.length, 0);
	assert.equal(worker.listeners.size, 0);
	assert.equal(h.revoked.length, 1);
	engine.destroy();
	assert.deepEqual(engine.match("cat", "cat", options), { status: "cancelled" });
});

test("window migration replaces connection and does not carry old fallback policy", async () => {
	const first = fakeWindow(),
		second = fakeWindow();
	let win = first.win;
	first.win.Worker = undefined;
	const engine = new MatchEngine(() => win);
	assert.equal((await engine.match("cat", "cat", options)).synchronous, true);
	win = second.win;
	const pending = engine.match("cat", "cat", options),
		worker = second.workers[0];
	worker.emit("message", { data: { type: "ready" } });
	worker.emit("message", {
		data: {
			type: "result",
			id: worker.requests[0].id,
			offsets: new Float64Array([0, 3]).buffer,
		},
	});
	assert.equal((await pending).synchronous, false);
	engine.destroy();
});

test("slow running computation is not replayed or terminated by the initialization deadline", async () => {
	const h = fakeWindow(),
		engine = new MatchEngine(
			() => h.win,
			() => {
				throw new Error("unexpected fallback");
			},
			10,
		);
	const pending = engine.match("cat", "cat", options),
		worker = h.workers[0];
	worker.emit("message", { data: { type: "ready" } });
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.ok(engine.pending);
	assert.notEqual(worker.terminated, true);
	engine.cancel();
	assert.deepEqual(await pending, { status: "cancelled" });
});

test("owner window closing cancels even an idle connection and unregisters listeners", async () => {
	const h = fakeWindow(),
		events = new Map();
	h.win.addEventListener = (name, fn) => events.set(name, fn);
	h.win.removeEventListener = (name) => events.delete(name);
	const engine = new MatchEngine(() => h.win),
		pending = engine.match("cat", "cat", options);
	events.get("pagehide")();
	assert.deepEqual(await pending, { status: "cancelled" });
	assert.equal(events.size, 0);
	assert.equal(h.workers[0].terminated, true);
	engine.destroy();
});

test("production replacement Worker preserves full-source templates for single/all across 552 comparisons", async () => {
	vi.spyOn(console, "debug").mockImplementation(() => {});
	const host = installWorkerHost({ URL: {} }),
		engine = new MatchEngine(() => host.win);
	onTestFinished(async () => {
		engine.destroy();
		await host.dispose();
	});
	for (const entry of workerCases)
		for (const regexMode of [true, false])
			for (const caseSensitive of [true, false]) {
				const prepared = helper.prepareReplacements(
					entry.source,
					entry.query,
					entry.replacement,
					regexMode,
					caseSensitive,
				);
				for (const index of [0, Math.max(0, prepared.matches.length - 1), -1])
					for (const all of [false, true]) {
						const selected = prepared.one(index < 0 ? 0 : index);
						const result = await engine.replace(
							entry.source,
							entry.query,
							entry.replacement,
							{ regexMode, caseSensitive },
							index,
							all,
						);
						assert.equal(result.status, "completed");
						assert.deepEqual(result.matches, prepared.matches);
						assert.deepEqual(
							result.changes,
							all ? prepared.all() : selected ? [selected] : [],
						);
					}
			}
});

test("replacement startup fallback retains full-source lookbehind and templates", async () => {
	const engine = new MatchEngine(() => ({}));
	const result = await engine.replace("foobar!", "(?<=foo)bar", "$`-$&-$'", options, 999, false);
	assert.equal(result.synchronous, true);
	assert.deepEqual(result.changes, [{ from: 3, to: 6, insert: "foo-bar-!" }]);
	engine.destroy();
});

test("single replacement only transports selected suffix template, all replacement expands all", async () => {
	const host = installWorkerHost({ URL: {} }),
		engine = new MatchEngine(() => host.win);
	onTestFinished(async () => {
		engine.destroy();
		await host.dispose();
	});
	const source = "cat ".repeat(2000);
	const one = await engine.replace(source, "cat", "$'", options, 1500, false);
	assert.equal(one.changes.length, 1);
	assert.equal(one.changes[0].insert, source.slice(6003));
	assert.equal(one.matches.length, 2000);
	const all = await engine.replace("abc abc", "(a)(b)c", "$2$1:$`:$'", options, 0, true);
	assert.deepEqual(
		all.changes,
		helper.prepareReplacements("abc abc", "(a)(b)c", "$2$1:$`:$'", true, false).all(),
	);
});

test("replacement execution crash never sync replays the candidate request", async () => {
	const h = fakeWindow();
	let fallback = 0;
	const engine = new MatchEngine(
		() => h.win,
		() => fallback++,
	);
	const pending = engine.replace("cat", "cat", "dog", options, 0, true),
		worker = h.workers[0];
	worker.emit("message", { data: { type: "ready" } });
	worker.emit("error", { message: "crash", preventDefault() {} });
	assert.equal((await pending).status, "failed");
	assert.equal(fallback, 0);
	engine.destroy();
});

for (const [name, candidates] of [
	["missing", undefined],
	["out of bounds", [{ from: 0, to: 4, insert: "x" }]],
	["nonstring", [{ from: 0, to: 3, insert: 42 }]],
	[
		"extra",
		[
			{ from: 0, to: 3, insert: "x" },
			{ from: 0, to: 3, insert: "x" },
		],
	],
]) {
	test(`replacement protocol rejects ${name} candidates instead of returning a successful edit`, async () => {
		const h = fakeWindow(),
			engine = new MatchEngine(() => h.win);
		const pending = engine.replace("cat", "cat", "x", options, 0, false),
			worker = h.workers[0];
		worker.emit("message", { data: { type: "ready" } });
		worker.emit("message", {
			data: {
				type: "result",
				id: worker.requests[0].id,
				offsets: new Float64Array([0, 3]).buffer,
				changes: candidates,
			},
		});
		assert.equal((await pending).status, "failed");
		assert.equal(worker.terminated, true);
		engine.destroy();
	});
}
