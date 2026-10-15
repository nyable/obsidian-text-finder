// Diagnostic benchmark, intentionally not part of the correctness test suite.
// jsdom measures indexing/control logic, not Chromium painting or Obsidian layout.
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";
import { readingDependencies } from "./reading-source.mjs";

const { ReadingSearch } = loadSource("../src/reading-search.ts", {
	...readingDependencies,
	"./reading-text": loadSource("../src/reading-text.ts"),
	"./util/text-helper": loadSource("../src/util/text-helper.ts"),
});
for (const count of [100, 1000, 5000]) {
	const dom = new JSDOM("<!doctype html><body></body>");
	dom.window.CSS = { highlights: new Map() };
	dom.window.Highlight = class extends Set { priority = 0; };
	const root = dom.window.document.createElement("div");
	dom.window.document.body.append(root);
	const sections = Array.from({ length: count }, () => {
		const el = dom.window.document.createElement("div");
		el.innerHTML = "<p>hello <strong>world</strong> cat cat cat cat cat cat cat cat cat cat</p>";
		return { el, rendered: true };
	});
	sections.slice(0, 10).forEach(({ el }) => root.append(el));
	const renderer = {
		sections, text: "md", lastText: "md", parsing: false, rendered: null, previewEl: root,
		showSection() {}, applyScrollSection(section) { this.target = section; return true; },
		updateVirtualDisplay() { if (this.target && !root.contains(this.target.el)) root.append(this.target.el); },
		onRendered() {},
	};
	const view = { file: { path: "benchmark.md" }, getMode: () => "preview", previewMode: { renderer } };
	const search = new ReadingSearch(view, () => true, () => {});
	const options = { regexMode: false, caseSensitive: false };
	let result;
	const start = performance.now();
	search.search("cat", options, 0, false, (value) => { result = value; });
	const first = performance.now() - start;
	const navigation = [];
	for (let i = 0; i < 15; i++) {
		const start = performance.now();
		search.search("cat", options, i, true, (value) => { result = value; }, 1);
		navigation.push(performance.now() - start);
	}
	console.log(JSON.stringify({ sections: count, matches: result.matches.length,
		firstIndexMs: Math.round(first), navigationMedianMs: Math.round(navigation.sort((a, b) => a - b)[7] * 10) / 10,
		paintedRanges: dom.window.CSS.highlights.get("nya-reading-matches").size }));
	search.destroy(); dom.window.close();
}
