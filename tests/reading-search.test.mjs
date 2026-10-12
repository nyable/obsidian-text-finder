import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";

const textSource = loadSource("../src/reading-text.ts");
const helper = loadSource("../src/util/text-helper.ts");
const { ReadingSearch } = loadSource("../src/reading-search.ts", {
	"./reading-text": textSource, "./util/text-helper": helper,
});
const options = { regexMode: false, caseSensitive: false };

function environment(html = ["<p>hello <strong>world</strong> Cat cat</p>", "<p>tail cat</p>"], sharedDom) {
	const dom = sharedDom ?? new JSDOM("<!doctype html><html><body></body></html>");
	const doc = dom.window.document;
	if (!dom.window.CSS) dom.window.CSS = {};
	if (!dom.window.CSS.highlights) dom.window.CSS.highlights = new Map();
	dom.window.Highlight = class extends Set { priority = 0; };
	const root = doc.createElement("div");
	doc.body.append(root);
	const sections = html.map((content) => {
		const el = doc.createElement("div"); el.innerHTML = content;
		return { el, rendered: true, shown: true };
	});
	// Only the first section is attached. The tail simulates off-screen content.
	root.append(sections[0].el);
	const calls = [];
	const callbacks = [];
	const renderer = {
		sections, text: "markdown", lastText: "markdown", parsing: false, rendered: null, previewEl: root,
		showSection(section) { calls.push(["show", section]); section.shown = true; },
		applyScrollSection(section) { calls.push(["apply", section]); this.target = section; return true; },
		updateVirtualDisplay() { if (this.target) root.append(this.target.el); },
		onRendered(callback) { callbacks.push(callback); },
	};
	const view = { file: { path: "a.md" }, mode: "preview", getMode() { return this.mode; }, previewMode: { renderer, containerEl: root } };
	let open = true;
	let refreshes = 0;
	const search = new ReadingSearch(view, () => open, () => { refreshes++; });
	const run = (text, queryOptions = options, index = 0, scroll = false) => {
		let result;
		search.search(text, queryOptions, index, scroll, (value) => { result = value; });
		return result;
	};
	return { dom, doc, root, sections, renderer, view, calls, callbacks, search, run,
		close: () => { open = false; }, refreshes: () => refreshes };
}

test("reading index joins inline formatting and only searches displayed link text", () => {
	const h = environment(["<p>hello <strong>world</strong> <a href='https://secret.example'>guide</a></p>"]);
	const before = h.root.innerHTML;
	const result = h.run("hello world");
	assert.equal(result.matches.length, 1);
	const ranges = [...h.dom.window.CSS.highlights.get("nya-reading-current")];
	assert.equal(ranges.map((range) => range.toString()).join(""), "hello world");
	assert.equal(h.run("secret.example").matches.length, 0);
	assert.equal(h.run("guide").matches.length, 1);
	assert.equal(h.root.innerHTML, before, "highlights never split or wrap DOM nodes");
	h.search.destroy();
});

test("reading search counts detached tail sections before the user scrolls", () => {
	const h = environment();
	assert.equal(h.sections[1].el.isConnected, false);
	assert.equal(h.run("cat").matches.length, 3);
	assert.equal(h.run("cat", { ...options, caseSensitive: true }).matches.length, 2);
	const result = h.run("cat", options, 2, true);
	assert.equal(result.index, 2);
	assert.equal(h.calls.find(([name]) => name === "apply")[1], h.sections[1]);
	assert.equal(h.sections[1].el.isConnected, true);
	h.search.destroy();
});

test("reading result reuse never mutates earlier query snapshots or another view", () => {
	const first = environment(), second = environment(["<p>cat cat cat cat</p>"], first.dom);
	const initial = first.run("cat"); const snapshot = structuredClone(initial.matches);
	assert.equal(first.run("cat", options, 1, true).matches, initial.matches);
	assert.equal(second.run("cat").matches.length, 4);
	const next = first.run("tail"); assert.notEqual(next.matches, initial.matches);
	first.search.clear();
	assert.deepEqual(initial.matches, snapshot);
	assert.equal(second.run("cat", options, 3, true).index, 3);
	first.search.destroy(); second.search.destroy(); first.dom.window.close();
});

test("regex anchors and lookarounds use the full logical reading text", (t) => {
	t.mock.method(console, "log", () => {});
	const h = environment(["<p>foo<strong>bar</strong></p>", "<p>bar</p>"]);
	assert.equal(h.run("(?<=foo)bar", { ...options, regexMode: true }).matches.length, 1);
	assert.equal(h.run("^bar$", { ...options, regexMode: true }).matches.length, 1);
	assert.equal(h.run("^", { ...options, regexMode: true }).matches.length, 0);
	assert.equal(h.run("[", { ...options, regexMode: true }).matches.length, 0);
	h.search.destroy();
});

test("index has block and cell boundaries, decodes entities and preserves preformatted whitespace", () => {
	const h = environment(["<p>A &amp; B<br>C</p><table><tr><td>one</td><td>two</td></tr></table><pre><code>  a\n\tb</code></pre>"]);
	const index = textSource.indexReadingText([h.sections[0].el]);
	assert.ok(index.text.includes("A & B\nC"));
	assert.ok(index.text.includes("one\ttwo"));
	assert.ok(index.text.includes("  a\n\tb"));
	assert.equal(h.run("onetwo").matches.length, 0);
	assert.equal(h.run("a\n\tb").matches.length, 1);
	h.search.destroy();
});

test("excluded UI, embedded notes, hidden text and diagram internals cannot become matches", () => {
	const h = environment([`<p>own</p><div class="internal-embed"><p>embedded</p></div>
		<div class="metadata-container">property</div><button>copy</button><svg><text>diagram</text></svg>
		<mjx-container>formula</mjx-container><div hidden>hidden</div><div class="block-language-dataview">generated</div>`]);
	for (const text of ["embedded", "property", "copy", "diagram", "formula", "hidden", "generated"]) {
		assert.equal(h.run(text).matches.length, 0, text);
	}
	assert.equal(h.run("own").matches.length, 1);
	h.search.destroy();
});

test("search never publishes a partial count while rendering, and later completes", async () => {
	const h = environment();
	h.renderer.rendered = [];
	h.sections[1].rendered = false;
	const results = [];
	h.search.search("cat", options, 0, false, (result) => results.push(result));
	assert.equal(results[0].pending, true);
	assert.deepEqual(results[0].matches, []);
	h.sections[1].rendered = true;
	h.callbacks[0]();
	// The real renderer invokes callbacks before resetting this flag.
	h.renderer.rendered = null;
	await Promise.resolve();
	assert.equal(results[1].matches.length, 3);
	h.search.destroy();
});

test("virtual section attachment does not invalidate the text index or trigger a refresh", async () => {
	const h = environment();
	h.run("cat");
	h.root.append(h.sections[1].el);
	h.sections[0].el.remove();
	await new Promise((resolve) => h.dom.window.setTimeout(resolve, 80));
	assert.equal(h.refreshes(), 0);
	assert.equal(h.run("cat").matches.length, 3);
	h.search.destroy();
});

test("explicit repeated hard breaks remain in the logical text", () => {
	const h = environment(["<p>A<br><br>B</p>"]);
	const index = textSource.indexReadingText([h.sections[0].el]);
	assert.ok(index.text.includes("A\n\nB"));
	assert.equal(h.run("A\n\nB").matches.length, 1);
	h.search.destroy();
});

test("an already-complete render belonging to the previous file is not published for the new file", async () => {
	const h = environment();
	h.view.getViewData = () => "new markdown";
	const result = h.run("cat");
	assert.equal(result.pending, true);
	assert.equal(result.matches.length, 0);
	await Promise.resolve();
	assert.equal(h.dom.window.CSS.highlights.has("nya-reading-matches"), false);
	h.search.destroy();
});

test("cross-block regex ranges paint only accepted text, not intervening controls", () => {
	const h = environment(["<p>one</p><button>do not paint</button><p>two</p>"]);
	assert.equal(h.run("one\\s+two", { ...options, regexMode: true }).matches.length, 1);
	const ranges = [...h.dom.window.CSS.highlights.get("nya-reading-current")];
	assert.equal(ranges.map((range) => range.toString()).join(""), "onetwo");
	h.search.destroy();
});

test("window migration releases the old registry and recreates ranges in the owning document", () => {
	const h = environment();
	h.run("cat");
	const next = new JSDOM("<!doctype html><html><body></body></html>");
	next.window.CSS = { highlights: new Map() };
	next.window.Highlight = class extends Set { priority = 0; };
	next.window.document.body.append(next.window.document.adoptNode(h.root));
	for (const section of h.sections) {
		if (section.el.ownerDocument !== next.window.document) next.window.document.adoptNode(section.el);
	}
	h.run("cat");
	assert.equal(h.dom.window.CSS.highlights.has("nya-reading-matches"), false);
	assert.ok(next.window.CSS.highlights.get("nya-reading-matches").size > 0);
	for (const range of next.window.CSS.highlights.get("nya-reading-matches")) {
		assert.equal(range.startContainer.ownerDocument, next.window.document);
	}
	h.search.destroy();
});

test("navigation expands only folded target ancestors without modifying text", () => {
	const h = environment([`<ul><li class="is-collapsed"><span class="list-collapse-indicator"></span>
		<ul><li>cat</li></ul></li><li class="is-collapsed"><ul><li>fox</li></ul></li></ul>`]);
	const parent = h.root.querySelector("li");
	parent.querySelector(".list-collapse-indicator").addEventListener("click", () => parent.classList.remove("is-collapsed"));
	const before = h.root.textContent;
	h.run("cat", options, 0, true);
	assert.equal(parent.classList.contains("is-collapsed"), false);
	assert.equal(h.root.querySelectorAll("li.is-collapsed").length, 1);
	assert.equal(h.root.textContent, before);
	h.search.destroy();
});

test("empty queries cancel pending render callbacks and release their results", async () => {
	const h = environment();
	h.renderer.rendered = [];
	let calls = 0;
	h.search.search("cat", options, 0, true, () => calls++);
	assert.equal(h.run("").pending, false);
	h.renderer.rendered = null;
	h.callbacks[0]();
	await Promise.resolve();
	assert.equal(calls, 1);
	assert.equal(h.calls.length, 0);
	h.search.destroy();
});

for (const invalidate of [
	(h) => h.close(), (h) => { h.view.mode = "source"; },
	(h) => { h.view.file = { path: "b.md" }; }, (h) => h.search.destroy(),
]) {
	test("late render callbacks cannot act on a closed, switched or disposed owner", async () => {
		const h = environment();
		h.renderer.rendered = [];
		let completed = 0;
		h.search.search("cat", options, 0, true, () => completed++);
		invalidate(h);
		h.renderer.rendered = null;
		h.callbacks[0]();
		await Promise.resolve();
		assert.equal(completed, 1);
		assert.equal(h.calls.length, 0);
		h.search.destroy();
	});
}

test("a new query invalidates the pending render callback of the previous query", async () => {
	const h = environment();
	h.renderer.rendered = [];
	let first = 0;
	let second;
	h.search.search("cat", options, 0, false, () => first++);
	h.search.search("world", options, 0, false, (result) => { second = result; });
	h.renderer.rendered = null;
	h.callbacks.forEach((callback) => callback());
	await Promise.resolve();
	assert.equal(first, 1);
	assert.equal(second.matches.length, 1);
	h.search.destroy();
});

test("detached section text changes are revalidated synchronously before navigation", () => {
	const h = environment();
	h.run("cat");
	h.sections[1].el.querySelector("p").firstChild.data = "tail fox";
	const result = h.run("cat", options, 2, true);
	assert.equal(result.matches.length, 2);
	assert.equal(result.index, 0);
	assert.equal(h.calls.filter(([name]) => name === "apply").length, 0);
	h.search.destroy();
});

test("background section mutation schedules refresh without scrolling and clear disconnects it", async () => {
	const h = environment();
	h.run("cat");
	h.sections[1].el.querySelector("p").textContent = "new cat cat";
	await new Promise((resolve) => h.dom.window.setTimeout(resolve, 80));
	assert.equal(h.refreshes(), 1);
	assert.equal(h.calls.length, 0);
	assert.equal(h.run("cat").matches.length, 4);
	h.search.clear();
	h.sections[1].el.querySelector("p").textContent = "cat";
	await new Promise((resolve) => h.dom.window.setTimeout(resolve, 80));
	assert.equal(h.refreshes(), 1);
	h.search.destroy();
});

test("split views have independent current ranges and destroying one preserves the other", () => {
	const h = environment();
	const other = environment(undefined, h.dom);
	h.run("cat", options, 2);
	other.run("world");
	assert.equal(h.dom.window.CSS.highlights.get("nya-reading-current").size, 2);
	h.search.destroy();
	const ranges = [...h.dom.window.CSS.highlights.get("nya-reading-current")];
	assert.equal(ranges.length, 1);
	assert.equal(ranges[0].toString(), "world");
	other.search.destroy();
	assert.equal(h.dom.window.CSS.highlights.has("nya-reading-current"), false);
});

test("unsupported renderer/highlight environments fail closed rather than searching only attached DOM", () => {
	const h = environment();
	delete h.renderer.sections;
	assert.equal(ReadingSearch.supported(h.view), false);
	assert.equal(h.run("cat").unsupported, true);
	h.renderer.sections = h.sections;
	delete h.dom.window.Highlight;
	assert.equal(ReadingSearch.supported(h.view), false);
	assert.equal(h.run("cat").matches.length, 0);
	h.search.destroy();
});

test("reading offsets preserve Unicode and exact whitespace rather than lowercasing the document", () => {
	const h = environment(["<p>İ CAT 😀 cat</p>"]);
	assert.equal(h.run("cat").matches.length, 2);
	const ranges = [...h.dom.window.CSS.highlights.get("nya-reading-matches")];
	assert.deepEqual(ranges.map((range) => range.toString()), ["CAT", "cat"]);
	assert.equal(h.run(" ").matches.length, 3);
	h.search.destroy();
});

test("virtualization rebuilds highlights from stable endpoints after detach and reattach", async () => {
	const h = environment();
	h.run("cat");
	h.sections[0].el.remove();
	h.root.append(h.sections[0].el);
	await Promise.resolve();
	await Promise.resolve();
	const ranges = [...h.dom.window.CSS.highlights.get("nya-reading-matches")];
	assert.ok(ranges.length > 0);
	assert.ok(ranges.every((range) => range.toString().toLowerCase() === "cat"));
	assert.equal(h.run("cat").matches.length, 3);
	h.search.destroy();
});

test("navigation constructs its target range only after virtual section mounting", () => {
	const h = environment();
	h.run("cat");
	h.run("cat", options, 2, true);
	const ranges = [...h.dom.window.CSS.highlights.get("nya-reading-current")];
	assert.equal(ranges.map((range) => range.toString()).join(""), "cat");
	assert.ok(ranges.every((range) => h.sections[1].el.contains(range.startContainer)));
	h.search.destroy();
});

test("same-query background refresh preserves the pending user scroll and current index", async () => {
	const h = environment();
	h.run("cat", options, 1);
	h.renderer.rendered = [];
	const results = [];
	h.search.search("cat", options, 1, true, (result) => results.push(result));
	h.search.search("cat", options, 0, false, (result) => results.push(result));
	h.callbacks.forEach((callback) => callback());
	h.renderer.rendered = null;
	await Promise.resolve();
	assert.equal(results.at(-1).index, 1);
	assert.ok(h.calls.some(([action]) => action === "show"));
	h.search.destroy();
});

test("pending reading navigation accumulates net direction across refreshes and wraps negative steps", async () => {
	const h = environment(["<p>cat cat cat cat cat</p>"]);
	h.run("cat"); h.renderer.rendered = [];
	let result;
	for (const direction of [1, 1, 1, -1]) h.search.search("cat", options, 0, true, (value) => { result = value; }, direction);
	h.search.search("cat", options, 0, false, (value) => { result = value; });
	h.renderer.rendered = null; h.callbacks.forEach((callback) => callback()); await Promise.resolve();
	assert.equal(result.index, 2);
	h.renderer.rendered = [];
	for (let i = 0; i < 8; i++) h.search.search("cat", options, 2, true, (value) => { result = value; }, -1);
	h.renderer.rendered = null; h.callbacks.forEach((callback) => callback()); await Promise.resolve();
	assert.equal(result.index, 4); h.search.destroy();
});

test("CSS hidden text is excluded while folded list and callout bodies remain searchable", () => {
	const h = environment([`<p>visible <span style="display:none">secret</span><span style="visibility:hidden">invisible</span></p>
		<ul><li class="is-collapsed"><ul style="display:none"><li>folded-list</li></ul></li></ul>
		<div class="callout is-collapsed"><div class="callout-content" style="display:none"><p>folded-callout</p></div></div>`]);
	assert.equal(h.run("secret").matches.length, 0);
	assert.equal(h.run("invisible").matches.length, 0);
	assert.equal(h.run("folded-list").matches.length, 1);
	assert.equal(h.run("folded-callout").matches.length, 1);
	h.search.destroy();
});

test("CSS style changes invalidate matches before the next action", () => {
	const h = environment(["<p><span>cat</span></p>"]);
	h.run("cat");
	h.root.querySelector("span").style.display = "none";
	assert.equal(h.run("cat").matches.length, 0);
	h.search.destroy();
});

test("trailing collapsible spaces and empty cells retain correct logical boundaries", () => {
	const h = environment(["<p>cat <em> </em></p><table><tr><td>one</td><td></td><td>two</td></tr></table>"]);
	const index = textSource.indexReadingText([h.sections[0].el]);
	assert.ok(index.text.startsWith("cat\n"));
	assert.ok(index.text.includes("one\t\ttwo"));
	assert.equal(h.run("cat$", { ...options, regexMode: true }).matches.length, 1);
	h.search.destroy();
});

test("private renderer exceptions are caught and clear highlights before reporting failure", () => {
	const h = environment();
	h.renderer.showSection = () => { throw new Error("private bridge changed"); };
	let result;
	assert.doesNotThrow(() => { result = h.run("cat", options, 0, true); });
	assert.equal(result.error, "failed");
	assert.equal(h.dom.window.CSS.highlights.has("nya-reading-matches"), false);
	h.search.destroy();
});

test("failed virtual mounting is reported rather than publishing successful navigation", () => {
	const h = environment();
	h.run("cat");
	h.renderer.applyScrollSection = () => false;
	const result = h.run("cat", options, 2, true);
	assert.equal(result.error, "failed");
	h.search.destroy();
});

test("render readiness is retried without DOM changes, preserving the requested scroll", async () => {
	const h = environment();
	h.renderer.rendered = [];
	const results = [];
	h.search.search("cat", options, 0, true, (result) => results.push(result));
	h.callbacks[0]();
	await Promise.resolve();
	h.renderer.rendered = null;
	await new Promise((resolve) => h.dom.window.setTimeout(resolve, 130));
	assert.equal(results.at(-1).pending, false);
	assert.equal(results.at(-1).matches.length, 3);
	assert.equal(h.calls.filter(([action]) => action === "show").length, 1);
	h.search.destroy();
});

test("render waiting has a bounded timeout and can be retried after recovery", async () => {
	const h = environment();
	h.search.destroy();
	const search = new ReadingSearch(h.view, () => true, () => {}, 25);
	h.renderer.rendered = [];
	const results = [];
	search.search("cat", options, 0, false, (result) => results.push(result));
	await new Promise((resolve) => h.dom.window.setTimeout(resolve, 65));
	assert.equal(results.at(-1).error, "timeout");
	assert.equal(results.at(-1).pending, false);
	assert.equal(search.waitTimer, null);
	assert.equal(search.observer, null);
	h.renderer.rendered = null;
	search.search("cat", options, 0, false, (result) => results.push(result));
	assert.equal(results.at(-1).matches.length, 3);
	search.destroy();
});

test("clear cancels readiness retries and prevents late painting or callbacks", async () => {
	const h = environment();
	h.renderer.rendered = [];
	let calls = 0;
	h.search.search("cat", options, 0, true, () => calls++);
	h.search.clear();
	h.renderer.rendered = null;
	h.callbacks[0]();
	await new Promise((resolve) => h.dom.window.setTimeout(resolve, 130));
	assert.equal(calls, 1);
	assert.equal(h.search.waitTimer, null);
	assert.equal(h.search.observer, null);
	assert.equal(h.calls.length, 0);
	h.search.destroy();
});

test("asynchronous renderer failures are contained and publish an actionable error", async () => {
	const h = environment();
	h.renderer.rendered = [];
	h.renderer.showSection = () => { throw new Error("broken navigation"); };
	const results = [];
	h.search.search("cat", options, 0, true, (result) => results.push(result));
	h.renderer.rendered = null;
	h.callbacks[0]();
	await Promise.resolve();
	assert.equal(results.at(-1).error, "failed");
	assert.equal(h.search.observer, null);
	h.search.destroy();
});

test("a throwing Highlight constructor fails closed and releases registry ownership", () => {
	const h = environment();
	h.run("cat");
	h.dom.window.Highlight = class { constructor() { throw new Error("host highlight failed"); } };
	const result = h.run("cat");
	assert.equal(result.error, "failed");
	assert.equal(h.dom.window.CSS.highlights.has("nya-reading-matches"), false);
	assert.equal(h.search.observer, null);
	h.search.destroy();
});

test("cross-section matches navigate to their first endpoint and paint mounted portions only", () => {
	const h = environment(["<p>hello</p>", "<p>world</p>"]);
	const result = h.run("hello\\s+world", { ...options, regexMode: true }, 0, true);
	assert.equal(result.matches.length, 1);
	assert.equal(h.calls.filter(([action]) => action === "show").length, 2);
	const ranges = [...h.dom.window.CSS.highlights.get("nya-reading-current")];
	assert.equal(ranges.map((range) => range.toString()).join(""), "hello");
	h.search.destroy();
});

test("CSS class rules hide text in attached and detached sections", () => {
	const h = environment(["<p>cat</p>", "<p><span class='concealed'>secret</span></p>"]);
	const style = h.doc.createElement("style"); style.textContent = ".concealed { display: none }"; h.doc.head.append(style);
	assert.equal(h.run("secret").matches.length, 0);
	assert.equal(h.run("cat").matches.length, 1);
	h.search.destroy();
});

test("repeated open/search/clear cycles release endpoints, observers, timers and highlights", () => {
	const h = environment();
	for (let i = 0; i < 30; i++) {
		h.run("cat");
		assert.ok(h.search.observer);
		assert.ok(h.search.sectionEndpoints.size > 0);
		h.search.clear();
		assert.equal(h.search.observer, null);
		assert.equal(h.search.request, null);
		assert.equal(h.search.textIndex, null);
		assert.equal(h.search.sectionEndpoints.size, 0);
		assert.equal(h.search.timer, null);
		assert.equal(h.search.waitTimer, null);
		assert.equal(h.dom.window.CSS.highlights.size, 0);
	}
	h.search.destroy();
});

test("painting only creates ranges for attached sections, without discarding offscreen matches", () => {
	const h = environment(Array.from({ length: 200 }, () => "<p>cat cat</p>"));
	const result = h.run("cat");
	assert.equal(result.matches.length, 400);
	assert.equal(h.dom.window.CSS.highlights.get("nya-reading-matches").size, 2);
	assert.equal(h.search.sectionEndpoints.size, 200);
	h.search.destroy();
});

test("owner invalidation during readiness retry stops all timers and observers", async () => {
	const h = environment();
	h.renderer.rendered = [];
	h.run("cat", options, 0, true);
	h.close();
	await new Promise((resolve) => h.dom.window.setTimeout(resolve, 130));
	assert.equal(h.search.observer, null);
	assert.equal(h.search.waitTimer, null);
	assert.equal(h.search.request, null);
	assert.equal(h.calls.length, 0);
	h.search.destroy();
});

test("private mounting callbacks that change owner cannot continue navigation or publish results", () => {
	const h = environment();
	h.run("cat");
	h.renderer.applyScrollSection = () => { h.view.file = { path: "other.md" }; return true; };
	let completed = false;
	h.search.search("cat", options, 2, true, () => { completed = true; });
	assert.equal(completed, false);
	h.search.destroy();
});
