// Opt-in diagnostic. Timings are jsdom/Node logic, not Chromium layout/paint.
// Method wrappers exist only in this process; production code is uninstrumented.
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import * as helper from "../../src/core/search/text-matching.ts";
import { ReadingSearch } from "../../src/features/reading/dom/reading-search.ts";

let phases = {},
	stack = [];
function timed(name, fn) {
	return function (...args) {
		const frame = { start: performance.now(), children: 0 };
		stack.push(frame);
		try {
			return fn.apply(this, args);
		} finally {
			const elapsed = performance.now() - frame.start;
			stack.pop();
			const entry = (phases[name] ??= { ms: 0, calls: 0 });
			entry.ms += elapsed - frame.children;
			entry.calls++;
			if (stack.length) stack.at(-1).children += elapsed;
		}
	};
}
for (const [method, name] of [
	["watch", "observerSetup"],
	["paint", "highlightTraversal"],
	["updateRegistry", "highlightRegistry"],
	["scroll", "mountAndPosition"],
]) {
	ReadingSearch.prototype[method] = timed(name, ReadingSearch.prototype[method]);
}
const round = (value) => Math.round(value * 100) / 100;
function measure(action) {
	phases = {};
	const start = performance.now();
	action();
	const totalMs = performance.now() - start;
	const measured = Object.values(phases).reduce((sum, entry) => sum + entry.ms, 0);
	return {
		totalMs: round(totalMs),
		phases: Object.fromEntries(
			Object.entries(phases).map(([name, entry]) => [
				name,
				{ ms: round(entry.ms), calls: entry.calls },
			]),
		),
		otherMs: round(Math.max(0, totalMs - measured)),
	};
}

console.log(
	JSON.stringify({
		environment: { node: process.version, platform: process.platform, arch: process.arch },
		notes: "Exclusive public controller phase timings; indexing, endpoint mapping and regexp time remain in otherMs. Heap deltas are not peak memory. No dangerous regexes.",
	}),
);
const queries = [
	{ name: "no-match", query: "not-present", regexMode: false },
	{ name: "low-density", query: "world", regexMode: false },
	{ name: "high-density", query: "cat", regexMode: false },
	{ name: "context-regex", query: "(?<=hello )world", regexMode: true },
];
for (const count of [100, 1000, 5000]) {
	for (const scenario of queries) {
		const dom = new JSDOM("<!doctype html><body></body>");
		dom.window.CSS = { highlights: new Map() };
		dom.window.Highlight = class extends Set {
			priority = 0;
		};
		const root = dom.window.document.createElement("div");
		dom.window.document.body.append(root);
		const sections = Array.from({ length: count }, () => {
			const el = dom.window.document.createElement("div");
			el.innerHTML =
				"<p>hello <strong>world</strong> cat cat cat cat cat cat cat cat cat cat</p>";
			return { el, rendered: true };
		});
		sections.slice(0, 10).forEach(({ el }) => root.append(el));
		const renderer = {
			sections,
			text: "md",
			lastText: "md",
			parsing: false,
			rendered: null,
			previewEl: root,
			showSection() {},
			applyScrollSection(section) {
				this.target = section;
				return true;
			},
			updateVirtualDisplay() {
				if (this.target && !root.contains(this.target.el)) root.append(this.target.el);
			},
			onRendered() {},
		};
		const view = {
			file: { path: "benchmark.md" },
			getMode: () => "preview",
			previewMode: { renderer },
		};
		const search = new ReadingSearch(
			view,
			() => true,
			() => {},
		);
		const options = { regexMode: scenario.regexMode, caseSensitive: false };
		let result;
		const run = (query = scenario.query, index = 0, scroll = false, direction = 0) => {
			search.search(
				query,
				options,
				index,
				scroll,
				(value) => {
					result = value;
				},
				direction,
			);
			if (result.error || result.pending || result.unsupported)
				throw new Error("Incomplete benchmark result");
		};
		globalThis.gc?.();
		const heapStart = process.memoryUsage().heapUsed;
		const first = measure(() => run());
		const matches = result.matches.length;
		const navigation = Array.from({ length: 15 }, () =>
			measure(() => run(scenario.query, result.index, true, 1)),
		);
		const reusedQuery = measure(() => run());
		const changedQuery = measure(() => run(scenario.query + "x"));
		sections[0].el.querySelector("p").append(" cat world");
		const documentChange = measure(() => run());
		console.log(
			JSON.stringify({
				mode: "reading",
				sections: count,
				scenario: scenario.name,
				matches,
				first,
				navigationMedianMs: navigation
					.map((entry) => entry.totalMs)
					.sort((a, b) => a - b)[7],
				navigationSample: navigation[7],
				reusedQuery,
				changedQuery,
				documentChange,
				heapDeltaBytes: process.memoryUsage().heapUsed - heapStart,
			}),
		);
		search.destroy();
		dom.window.close();
	}
}

for (const repeats of [2000, 20000, 100000]) {
	const source = "cat ".repeat(repeats);
	globalThis.gc?.();
	const heapStart = process.memoryUsage().heapUsed;
	let offsets, prepared, single, all;
	const match = measure(() => {
		offsets = helper.findTextOffsets(source, "(cat)", true, false);
	});
	const prepare = measure(() => {
		prepared = helper.prepareReplacements(source, "(cat)", "$'", true, false);
	});
	const one = measure(() => {
		single = prepared.one(Math.floor(repeats / 2));
	});
	const allLinear = measure(() => {
		all = helper.prepareReplacements(source, "(cat)", "$1!", true, false).all();
	});
	console.log(
		JSON.stringify({
			mode: "editing-algorithm",
			sourceChars: source.length,
			matches: offsets.length,
			match,
			prepare,
			one,
			singleInsertChars: single.insert.length,
			allLinear,
			allChanges: all.length,
			heapDeltaBytes: process.memoryUsage().heapUsed - heapStart,
			boundary:
				"Matching/template expansion only; excludes CodeMirror dispatch, undo, highlighting and host layout",
		}),
	);
}
