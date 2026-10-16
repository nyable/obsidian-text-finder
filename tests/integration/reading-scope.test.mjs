import assert from "node:assert/strict";
import { test } from "vitest";
import { JSDOM } from "jsdom";
import * as text from "../../src/features/reading/dom/reading-text";
import * as readingSelectionSource from "../../src/features/reading/dom/reading-selection";
import { ReadingSearch } from "../../src/features/reading/dom/reading-search";
const options = { regexMode: false, caseSensitive: true, wholeWord: false };
function fixture(html, matcher) {
	const dom = new JSDOM('<html><body><div id="preview"></div></body></html>', {
		pretendToBeVisual: true,
	});
	const doc = dom.window.document,
		root = doc.getElementById("preview");
	dom.window.CSS = { highlights: new Map() };
	dom.window.Highlight = class extends Set {
		priority = 0;
	};
	const sections = html.map((content) => {
		const el = doc.createElement("div");
		el.innerHTML = content;
		return { el, rendered: true };
	});
	root.append(sections[0].el);
	const calls = [];
	const renderer = {
		sections,
		text: "source",
		lastText: "source",
		parsing: false,
		rendered: null,
		previewEl: root,
		onRendered() {},
		showSection(s) {
			calls.push(s);
		},
		applyScrollSection(s) {
			this.target = s;
			return true;
		},
		updateVirtualDisplay() {
			if (this.target) root.append(this.target.el);
		},
	};
	const view = {
		file: { path: "note.md" },
		getMode: () => "preview",
		previewMode: { renderer, containerEl: root },
	};
	let refreshes = 0;
	const search = new ReadingSearch(
		view,
		() => true,
		() => {
			refreshes++;
		},
		5000,
		matcher,
	);
	const run = (query, opts = options, index = 0, scroll = false) => {
		let value;
		search.search(query, opts, index, scroll, (result) => {
			value = result;
		});
		return value;
	};
	const scope = (node, from, to = node.length) =>
		search.setScope([{ start: { node, offset: from }, end: { node, offset: to } }]);
	return {
		dom,
		doc,
		root,
		sections,
		renderer,
		view,
		search,
		run,
		scope,
		calls,
		refreshes: () => refreshes,
		destroy() {
			search.destroy();
			dom.window.close();
		},
	};
}

test("reading scope maps the selected occurrence, not identical text elsewhere, and survives browser selection changes", () => {
	const h = fixture(["<p>cat cat cat</p>"]);
	const node = h.root.querySelector("p").firstChild;
	assert.equal(h.scope(node, 4, 7), true);
	assert.deepEqual(h.run("cat").matches, [{ from: 4, to: 7, index: 0 }]);
	h.dom.window.getSelection().removeAllRanges();
	assert.equal(h.run("cat", options, 0, true).matches.length, 1);
	assert.deepEqual(h.search.getScopeRanges(), [{ from: 4, to: 7 }]);
	assert.equal([...h.dom.window.CSS.highlights.get("nya-reading-scope")][0].toString(), "cat");
	assert.equal(h.root.querySelector("p").textContent, "cat cat cat");
	h.destroy();
});

test("scoped regex keeps full reading context and starts scanning at each exact range", () => {
	const h = fixture(["<p>foobar aaa</p>"]),
		node = h.root.querySelector("p").firstChild;
	assert.equal(h.scope(node, 3, 6), true);
	assert.equal(h.run("(?<=foo)bar", { ...options, regexMode: true }).matches.length, 1);
	assert.equal(h.run("^bar", { ...options, regexMode: true }).matches.length, 0);
	assert.equal(h.scope(node, 8, 10), true);
	assert.equal(h.run("aa").matches.length, 1);
	h.destroy();
});

test("reading scope supports multiple ranges without searching or joining their gaps", () => {
	const h = fixture(["<p>cat cat cat</p>"]),
		node = h.root.querySelector("p").firstChild;
	assert.equal(
		h.search.setScope(
			[0, 8].map((offset) => ({
				start: { node, offset },
				end: { node, offset: offset + 3 },
			})),
		),
		true,
	);
	assert.equal(h.run("cat").matches.length, 2);
	assert.equal(h.run("cat cat").matches.length, 0);
	h.destroy();
});

test("element boundaries, inline formatting and collapsed whitespace use inward mapping without source syntax", () => {
	const h = fixture(["<p>first <strong>cat</strong>   dog</p>"]);
	const p = h.root.querySelector("p");
	assert.equal(
		h.search.setScope([{ start: { node: p, offset: 1 }, end: { node: p, offset: 2 } }]),
		true,
	);
	assert.deepEqual(
		h.search.getScopeRanges(),
		[{ from: 6, to: 9 }],
		"element start excludes preceding collapsed whitespace",
	);
	assert.equal(h.run("cat").matches.length, 1);
	assert.equal(h.run("first").matches.length, 0);
	const index = text.indexReadingText([h.sections[0].el]),
		last = p.lastChild;
	assert.equal(
		text.readingPointOffset(index, { node: last, offset: 1 }, "start"),
		index.text.indexOf("dog"),
	);
	assert.equal(
		text.readingPointOffset(index, { node: last, offset: 1 }, "end"),
		index.text.indexOf("dog") - 1,
	);
	assert.equal(text.readingPointOffset(index, { node: last, offset: 999 }, "start"), null);
	h.destroy();
});

test("excluded endpoints and outside selections are rejected rather than approximated", () => {
	const h = fixture(["<p>cat<button>secret</button>dog</p>"]);
	assert.equal(h.scope(h.root.querySelector("button").firstChild, 0), false);
	assert.equal(h.scope(h.doc.createTextNode("cat"), 0), false);
	assert.equal(h.search.getScopeRanges(), undefined);
	h.destroy();
});

test("empty query retains scope presentation, clearScope explicitly restores full search, close releases everything", () => {
	const h = fixture(["<p>cat cat</p>"]);
	h.scope(h.root.querySelector("p").firstChild, 4, 7);
	assert.equal(h.run("").matches.length, 0);
	assert.equal(h.search.getScopeRanges().length, 1);
	assert.equal(h.dom.window.CSS.highlights.get("nya-reading-scope").size, 1);
	h.search.clearScope();
	assert.equal(h.run("cat").matches.length, 2);
	h.search.clear();
	assert.equal(h.search.getScopeRanges(), undefined);
	assert.equal(h.dom.window.CSS.highlights.size, 0);
	assert.equal(h.doc.querySelector(".nya-reading-overlay"), null);
	h.destroy();
});

test("virtual detach/reattach preserves locked ranges and complete counts, but replacement nodes invalidate them", async () => {
	const h = fixture(["<p>cat cat</p>", "<p>cat</p>"]);
	h.scope(h.root.querySelector("p").firstChild, 4, 7);
	assert.equal(h.run("cat").matches.length, 1);
	h.sections[0].el.remove();
	h.root.append(h.sections[1].el);
	await Promise.resolve();
	assert.equal(h.run("cat").matches.length, 1);
	assert.equal(h.search.isScopeInvalid(), false);
	h.root.append(h.sections[0].el);
	await Promise.resolve();
	assert.equal(h.run("cat").matches.length, 1);
	h.sections[0].el.innerHTML = "<p>cat cat</p>";
	const result = h.run("cat");
	assert.equal(result.matches.length, 0);
	assert.equal(result.scopeInvalid, true);
	assert.deepEqual(h.search.getScopeRanges(), []);
	assert.equal(h.run("cat").matches.length, 0);
	h.destroy();
});

for (const reason of ["file", "source", "renderer", "text"])
	test(`reading scope fails closed on ${reason} identity change`, () => {
		const h = fixture(["<p>cat cat</p>"]);
		h.scope(h.root.querySelector("p").firstChild, 4, 7);
		h.run("cat");
		if (reason === "file") h.view.file = { path: "note.md" };
		if (reason === "source") h.renderer.text = h.renderer.lastText = "changed";
		if (reason === "renderer") h.view.previewMode.renderer = { ...h.renderer };
		if (reason === "text") h.root.querySelector("p").firstChild.data = "cat dog";
		assert.equal(h.run("cat").matches.length, 0);
		assert.equal(h.search.isScopeInvalid(), true);
		h.destroy();
	});

test("theme-only reindex retains scopes when text and numeric node mapping are unchanged", () => {
	const h = fixture(["<p>cat cat</p>"]);
	h.scope(h.root.querySelector("p").firstChild, 4, 7);
	h.run("cat");
	h.search.invalidate();
	assert.equal(h.run("cat").matches.length, 1);
	assert.equal(h.search.isScopeInvalid(), false);
	h.destroy();
});

test("temporary unsupported APIs invalidate a reading scope without silently restoring full search on recovery", () => {
	const h = fixture(["<p>cat cat</p>"]);
	h.scope(h.root.querySelector("p").firstChild, 4, 7);
	h.run("cat");
	const Highlight = h.dom.window.Highlight;
	h.dom.window.Highlight = undefined;
	assert.equal(h.run("cat").unsupported, true);
	assert.deepEqual(h.search.getScopeRanges(), []);
	h.dom.window.Highlight = Highlight;
	assert.equal(h.run("cat").matches.length, 0);
	assert.equal(h.search.isScopeInvalid(), true);
	h.destroy();
});

test("owner document migration invalidates scope and removes old highlight ownership and overlay", () => {
	const h = fixture(["<p>cat cat</p>"]);
	h.scope(h.root.querySelector("p").firstChild, 4, 7);
	h.run("cat");
	const popup = new JSDOM("<html><body></body></html>");
	popup.window.CSS = { highlights: new Map() };
	popup.window.Highlight = class extends Set {
		priority = 0;
	};
	popup.window.document.body.append(popup.window.document.adoptNode(h.root));
	assert.equal(h.run("cat").matches.length, 0);
	assert.equal(h.search.isScopeInvalid(), true);
	assert.equal(h.dom.window.CSS.highlights.size, 0);
	assert.equal(h.doc.querySelector(".nya-reading-overlay"), null);
	h.destroy();
	popup.window.close();
});

test("two scoped panes share a registry but keep independent ranges and destroying one leaves the other intact", () => {
	const h = fixture(["<p>cat cat</p>"]);
	h.scope(h.root.querySelector("p").firstChild, 4, 7);
	h.run("cat");
	const root = h.doc.createElement("div"),
		section = h.doc.createElement("div");
	section.innerHTML = "<p>cat cat</p>";
	root.append(section);
	h.doc.body.append(root);
	const renderer = {
		...h.renderer,
		sections: [{ el: section, rendered: true }],
		previewEl: root,
	};
	const view = { ...h.view, previewMode: { renderer, containerEl: root } };
	const other = new ReadingSearch(
			view,
			() => true,
			() => {},
		),
		node = section.firstChild.firstChild;
	other.setScope([{ start: { node, offset: 0 }, end: { node, offset: 3 } }]);
	other.search("cat", options, 0, false, () => {});
	assert.equal(h.dom.window.CSS.highlights.get("nya-reading-scope").size, 2);
	h.search.clear();
	assert.equal(h.dom.window.CSS.highlights.get("nya-reading-scope").size, 1);
	assert.equal([...h.dom.window.CSS.highlights.get("nya-reading-scope")][0].startContainer, node);
	other.destroy();
	h.destroy();
});

test("scope changes cancel async matches and reject late results; execution errors do not restore full search", async () => {
	const pending = [];
	let cancels = 0;
	const h = fixture(["<p>cat cat</p>"], {
		cancel() {
			cancels++;
		},
		destroy() {},
		match(source, query, options, ranges) {
			return new Promise((resolve) =>
				pending.push({ source, query, options, ranges, resolve }),
			);
		},
	});
	const node = h.root.querySelector("p").firstChild;
	h.scope(node, 0, 3);
	h.run("cat");
	h.scope(node, 4, 7);
	h.run("cat");
	assert.ok(cancels > 0);
	assert.deepEqual(pending[1].ranges, [{ from: 4, to: 7 }]);
	pending[0].resolve({ status: "completed", matches: [{ from: 0, to: 3 }], synchronous: false });
	await Promise.resolve();
	assert.equal(h.search.matchOffsets.length, 0);
	pending[1].resolve({ status: "failed", error: new Error("worker") });
	await Promise.resolve();
	assert.deepEqual(h.search.getScopeRanges(), [{ from: 4, to: 7 }]);
	h.search.retrySynchronously();
	assert.equal(h.run("cat").matches.length, 1);
	h.destroy();
});

test("reading newline provenance distinguishes hard breaks, pre text, paragraph boundaries, barriers and trailing sentinel", () => {
	const h = fixture([
		'<p>A<br><br>B</p><pre>x\n\ny</pre><div class="internal-embed">hidden</div><p>C</p>',
	]);
	const index = text.indexReadingText([h.sections[0].el]);
	assert.equal(index.breaks.filter((b) => b.kind === "hard").length, 2);
	assert.equal(index.breaks.filter((b) => b.kind === "text").length, 2);
	assert.ok(index.breaks.some((b) => b.kind === "barrier"));
	assert.ok(
		!text
			.readingBreaks(index, 0, index.text.length)
			.some((b) => b.from === index.text.length - 1),
	);
	const result = h.run("\\n\\n", { ...options, regexMode: true });
	assert.equal(result.matches.length, 2);
	assert.equal(
		h.run("\\n", { ...options, regexMode: true }).matches.length,
		5,
		"two hard, two pre and one paragraph boundary; no barrier or sentinel",
	);
	assert.equal(h.run("hidden").matches.length, 0);
	h.destroy();
});

test("pure hard-break matches navigate after mounting and scopes can select br with element endpoints", () => {
	const h = fixture(["<p>head</p>", "<p>A<br><br>B</p>"]);
	const result = h.run("\\n\\n", { ...options, regexMode: true }, 0, true);
	assert.equal(result.matches.length, 1);
	assert.ok(h.root.contains(h.sections[1].el));
	assert.ok(h.calls.length);
	const p = h.sections[1].el.firstChild;
	assert.equal(
		h.search.setScope([{ start: { node: p, offset: 1 }, end: { node: p, offset: 2 } }]),
		true,
	);
	assert.equal(h.run("\\n", { ...options, regexMode: true }).matches.length, 1);
	h.destroy();
});

test("selection tracker captures before focus leaves, handles reverse selections and clears on new body interaction", () => {
	const h = fixture(["<p>cat cat</p>"]),
		node = h.root.querySelector("p").firstChild;
	const tracker = new readingSelectionSource.ReadingSelectionTracker();
	tracker.connect(h.root, h.view.file);
	const selection = h.dom.window.getSelection();
	selection.setBaseAndExtent(node, 7, node, 4);
	h.doc.dispatchEvent(new h.dom.window.Event("selectionchange"));
	selection.removeAllRanges();
	h.doc.dispatchEvent(new h.dom.window.Event("selectionchange"));
	assert.equal(tracker.get(h.root, h.view.file)[0].start.offset, 4);
	h.root.dispatchEvent(new h.dom.window.Event("pointerdown", { bubbles: true }));
	assert.equal(tracker.get(h.root, h.view.file), null);
	selection.setBaseAndExtent(node, 0, node, 3);
	h.doc.dispatchEvent(new h.dom.window.Event("selectionchange"));
	tracker.destroy();
	selection.removeAllRanges();
	assert.equal(tracker.get(h.root, {}), null);
	tracker.destroy();
	h.destroy();
});

test("selection tracker clears stale candidates on source/version changes and body mutation, and releases owner listeners", async () => {
	const h = fixture(["<p>cat cat</p>"]),
		node = h.root.querySelector("p").firstChild;
	const tracker = new readingSelectionSource.ReadingSelectionTracker(),
		selection = h.dom.window.getSelection();
	tracker.connect(h.root, h.view.file, "v1");
	selection.setBaseAndExtent(node, 0, node, 3);
	h.doc.dispatchEvent(new h.dom.window.Event("selectionchange"));
	selection.removeAllRanges();
	assert.ok(tracker.get(h.root, h.view.file, "v1"));
	assert.equal(tracker.get(h.root, h.view.file, "v2"), null);
	selection.setBaseAndExtent(node, 0, node, 3);
	h.doc.dispatchEvent(new h.dom.window.Event("selectionchange"));
	selection.removeAllRanges();
	node.data = "dog cat";
	await Promise.resolve();
	assert.equal(tracker.get(h.root, h.view.file, "v2"), null);
	tracker.destroy();
	node.data = "cat cat";
	await Promise.resolve();
	h.destroy();
});

test("overlay coalesces scroll redraw in an owner frame and clear cancels pending frames and observers", () => {
	const h = fixture(["<p>A<br>B</p>"]);
	const frames = new Map(),
		cancelled = [],
		observers = [];
	h.dom.window.requestAnimationFrame = (fn) => {
		frames.set(frames.size + 1, fn);
		return frames.size;
	};
	h.dom.window.cancelAnimationFrame = (id) => {
		cancelled.push(id);
		frames.delete(id);
	};
	h.dom.window.ResizeObserver = class {
		constructor(fn) {
			this.fn = fn;
			observers.push(this);
		}
		observe() {}
		disconnect() {
			this.disconnected = true;
		}
	};
	h.root.querySelector("br").getBoundingClientRect = () => ({
		left: 10,
		right: 10,
		top: 10,
		bottom: 26,
		height: 16,
	});
	h.run("\\n", { ...options, regexMode: true });
	assert.equal(h.doc.querySelectorAll(".nya-newline-match").length, 1);
	h.root.dispatchEvent(new h.dom.window.Event("scroll"));
	h.root.dispatchEvent(new h.dom.window.Event("scroll"));
	assert.equal(frames.size, 1);
	assert.equal(h.doc.querySelector(".nya-reading-overlay").style.visibility, "hidden");
	h.search.clear();
	assert.equal(frames.size, 0);
	assert.equal(cancelled.length, 1);
	assert.ok(observers.every((o) => o.disconnected));
	h.root.dispatchEvent(new h.dom.window.Event("scroll"));
	assert.equal(frames.size, 0);
	h.destroy();
});

test("reading overlay uses a separate decorative portal, remeasures and releases resize/scroll/style resources", async () => {
	const h = fixture(["<p>A<br><br>B</p>"]);
	const rootHTML = h.root.innerHTML;
	const brs = h.root.querySelectorAll("br");
	brs.forEach((br, i) => {
		br.getBoundingClientRect = () => ({
			left: 20,
			right: 20,
			top: 20 + i * 20,
			bottom: 36 + i * 20,
			height: 16,
		});
	});
	h.root.style.setProperty("--nya-scope-border-width", "1px");
	const p = h.root.querySelector("p");
	h.search.setScope([{ start: { node: p, offset: 0 }, end: { node: p, offset: 4 } }]);
	h.run("\\n\\n", { ...options, regexMode: true });
	const overlay = h.doc.querySelector(".nya-reading-overlay");
	assert.ok(overlay);
	assert.equal(h.root.contains(overlay), false);
	assert.equal(overlay.getAttribute("aria-hidden"), "true");
	assert.equal(overlay.textContent, "");
	assert.equal(overlay.querySelectorAll(".nya-newline-match").length, 2);
	assert.ok(overlay.querySelector(".nya-scope-outline"));
	assert.equal(h.root.innerHTML, rootHTML);
	const refreshes = h.refreshes();
	h.doc.dispatchEvent(new h.dom.window.Event("nya-scope-style-change"));
	await Promise.resolve();
	assert.equal(h.refreshes(), refreshes, "style redraw does not invalidate index");
	h.search.clear();
	assert.equal(h.doc.querySelector(".nya-reading-overlay"), null);
	h.destroy();
});
