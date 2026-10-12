// Opt-in index diagnostic. jsdom does not measure Chromium style/layout costs.
// Compare against a git ref without changing the worktree or retaining old code.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";

const current = loadSource("../src/reading-text.ts");
const ref = process.argv[2];
let baseline;
if (ref) {
	const source = execFileSync("git", ["show", `${ref}:src/reading-text.ts`], { encoding: "utf8" });
	const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } });
	const module = { exports: {} };
	new Function("exports", compiled.outputText)(module.exports);
	baseline = module.exports;
}
const round = (value) => Math.round(value * 100) / 100;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const cases = [
	{ name: "inline", html: "<p>hello <strong>world</strong> cat cat cat cat cat cat cat cat cat cat</p>" },
	{ name: "excluded", html: '<p>cat <span hidden>hidden</span><button>control</button><span aria-hidden="true">aria</span><span class="math">formula</span><svg><text>svg</text></svg> tail</p><div class="internal-embed"><p>embedded</p></div>' },
	{ name: "formatted", html: '<ul><li class="is-collapsed"><ul style="display:none"><li>cat <em>folded</em></li></ul></li></ul><div class="callout is-collapsed"><div class="callout-content" style="display:none">callout</div></div><table><tr><td>A</td><td></td><td>B</td></tr></table><pre><code>  code\n\tcat</code></pre>' },
];
const counts = process.argv[3] ? [Number(process.argv[3])] : [100, 1000, 5000];
const scenarios = process.argv[4] ? cases.filter((item) => item.name === process.argv[4]) : cases;
const samplesPerCase = Number(process.argv[5] ?? 3);
assert.ok(counts.every((count) => Number.isSafeInteger(count) && count > 0));
assert.ok(scenarios.length && Number.isSafeInteger(samplesPerCase) && samplesPerCase >= 3);
console.log(JSON.stringify({ node: process.version, baselineRef: ref ?? null,
	samplesPerCase,
	boundary: "Alternating warm runs on identical attached/detached DOM; API timings are exclusive and instrumented separately from total. Not real host performance." }));
for (const count of counts) {
	for (const scenario of scenarios) {
		const dom = new JSDOM("<!doctype html><body></body>");
		const doc = dom.window.document;
		const roots = Array.from({ length: count }, () => { const el = doc.createElement("div"); el.innerHTML = scenario.html; return el; });
		roots.slice(0, 10).forEach((el) => doc.body.append(el));
		function profile(implementation) {
			const counters = {}; let depth = 0;
			const wrap = (name, original) => function (...args) {
				if (depth) return original.apply(this, args);
				depth++; const start = performance.now();
				try { return original.apply(this, args); }
				finally {
					const item = counters[name] ??= { calls: 0, ms: 0 }; item.calls++; item.ms += performance.now() - start; depth--;
				}
			};
			const win = dom.window, proto = win.Element.prototype;
			const style = win.getComputedStyle, matches = proto.matches;
			const children = Object.getOwnPropertyDescriptor(win.Node.prototype, "childNodes");
			win.getComputedStyle = wrap("computedStyle", style); proto.matches = wrap("selector", matches);
			Object.defineProperty(win.Node.prototype, "childNodes", { ...children, get: wrap("childNodes", children.get) });
			try {
				const start = performance.now(); implementation.indexReadingText(roots); const totalMs = performance.now() - start;
				const apiMs = Object.values(counters).reduce((sum, entry) => sum + entry.ms, 0);
				return { totalMs: round(totalMs), otherMs: round(Math.max(0, totalMs - apiMs)),
					apis: Object.fromEntries(Object.entries(counters).map(([name, entry]) => [name, { calls: entry.calls, ms: round(entry.ms) }])) };
			} finally { win.getComputedStyle = style; proto.matches = matches; Object.defineProperty(win.Node.prototype, "childNodes", children); }
		}
		const implementations = baseline ? { baseline, current } : { current };
		const samples = Object.fromEntries(Object.keys(implementations).map((key) => [key, []]));
		let index;
		for (let iteration = 0; iteration <= samplesPerCase; iteration++) {
			const order = Object.entries(implementations); if (iteration % 2) order.reverse();
			for (const [name, implementation] of order) {
				const start = performance.now(); index = implementation.indexReadingText(roots);
				if (iteration) samples[name].push(performance.now() - start);
			}
		}
		if (baseline) {
			const actual = current.indexReadingText(roots), expected = baseline.indexReadingText(roots);
			assert.equal(actual.text, expected.text, "Logical text must agree");
			assert.equal(actual.spans.length, expected.spans.length);
			actual.spans.forEach((span, i) => {
				assert.equal(span.node, expected.spans[i].node, "DOM identity must agree");
				const { node: _actualNode, ...offsets } = span;
				const { node: _expectedNode, ...expectedOffsets } = expected.spans[i];
				assert.deepEqual(offsets, expectedOffsets, "Logical and node offsets must agree");
			});
		}
		console.log(JSON.stringify({ sections: count, scenario: scenario.name, chars: index.text.length, spans: index.spans.length,
			medianMs: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, round(median(values))])),
			profiles: Object.fromEntries(Object.entries(implementations).map(([name, impl]) => [name, profile(impl)])) }));
		dom.window.close();
	}
}
