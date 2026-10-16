import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { JSDOM } from "jsdom";
import * as stateModule from "@codemirror/state";
import * as viewModule from "@codemirror/view";
import { readFileSync } from "node:fs";
import { compileString } from "sass";
import {
	textMatchMarker,
	searchCacheEffect,
	newlineMatchLayer,
	CLS,
} from "../../src/platform/codemirror/search-highlight";
import {
	searchScopeField,
	searchScopeEffect,
	scopeOutlineLayer,
} from "../../src/platform/codemirror/search-scope";
import * as scopeGeometry from "../../src/platform/codemirror/scope-geometry";
import * as outline from "../../src/shared/geometry/scope-outline";
import { findTextOffsets } from "../../src/core/search/text-matching";
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const segments = (path) =>
	[...path.matchAll(/M(-?[\d.]+) (-?[\d.]+)([HV])(-?[\d.]+)/g)].map(([, x, y, axis, end]) =>
		axis === "H"
			? [Number(x), Number(y), Number(end), Number(y)]
			: [Number(x), Number(y), Number(x), Number(end)],
	);

function fixture(doc, positions = {}) {
	const dom = new JSDOM('<html><body><div id="root"></div></body></html>'),
		root = dom.window.document.getElementById("root");
	const measurements = [],
		state = stateModule.EditorState.create({
			doc,
			extensions: [textMatchMarker, searchScopeField],
		});
	const view = {
		state,
		dom: root,
		contentDOM: root,
		scrollDOM: root,
		textDirection: 0,
		scaleX: 1,
		scaleY: 1,
		defaultCharacterWidth: 8,
		visibleRanges: [{ from: 0, to: state.doc.length }],
		lineBlockAt(pos) {
			const line = this.state.doc.lineAt(pos);
			return { from: line.from, to: line.to, type: 0 };
		},
		coordsAtPos(pos, side) {
			measurements.push([pos, side]);
			if (pos in positions) return positions[pos];
			const line = this.state.doc.lineAt(pos),
				x = (pos - line.from) * 8,
				y = (line.number - 1) * 20;
			return rect(x, y, x, y + 16);
		},
		textDirectionAt() {
			return this.textDirection;
		},
	};
	root.getBoundingClientRect = () => rect(0, 0, 400, 300);
	const setMatches = (matches, index = 0, visible = true) => {
		view.state = view.state.update({
			effects: searchCacheEffect.of({ doc: view.state.doc, visible, matches, index }),
		}).state;
	};
	const scope = (ranges) => {
		view.state = view.state.update({ effects: searchScopeEffect.of(ranges) }).state;
	};
	const mark = (id, boxes) => {
		const span = dom.window.document.createElement("span");
		span.dataset.nyaScope = String(id);
		span.getClientRects = () => boxes;
		root.append(span);
	};
	return { dom, root, view, measurements, setMatches, scope, mark };
}

test("newline-only matches have owner-local non-text glyphs with current/other colors and stable identities", () => {
	const h = fixture("a\n\nb");
	h.setMatches([
		{ from: 1, to: 2 },
		{ from: 2, to: 3 },
	]);
	const markers = newlineMatchLayer.markers(h.view);
	assert.equal(markers.length, 2);
	const [current, other] = markers.map((marker) => marker.draw());
	assert.equal(current.ownerDocument, h.dom.window.document);
	assert.ok(current.classList.contains(CLS.MATCH_CURRENT));
	assert.ok(!other.classList.contains(CLS.MATCH_CURRENT));
	assert.equal(current.textContent, "");
	assert.equal(current.getAttribute("aria-hidden"), "true");
	assert.equal(current.hasAttribute("aria-label"), false);
	assert.equal(current.hasAttribute("title"), false);
	assert.equal(current.tabIndex, -1);
	assert.equal(current.style.left, "8px");
	assert.equal(other.style.top, "20px");
	assert.ok(markers[0].eq(newlineMatchLayer.markers(h.view)[0]));
	h.setMatches(
		[
			{ from: 1, to: 2 },
			{ from: 2, to: 3 },
		],
		1,
	);
	assert.equal(markers[0].eq(newlineMatchLayer.markers(h.view)[0]), false);
	assert.ok(newlineMatchLayer.markers(h.view)[1].draw().classList.contains(CLS.MATCH_CURRENT));
	h.dom.window.close();
});

test("a multiline match marks each consumed newline, but EOF, match endpoints and zero-width positions do not", () => {
	const h = fixture("abc\n\ndef\n");
	h.setMatches([{ from: 0, to: h.view.state.doc.length }]);
	assert.equal(newlineMatchLayer.markers(h.view).length, 3);
	assert.equal(
		h.view.state.field(textMatchMarker).size,
		1,
		"one match remains one decoration and one count",
	);
	h.setMatches([
		{ from: 0, to: 3 },
		{ from: 4, to: 4 },
	]);
	assert.equal(newlineMatchLayer.markers(h.view).length, 0);
	h.setMatches([{ from: 0, to: 5 }]);
	assert.equal(newlineMatchLayer.markers(h.view).length, 2);
	h.setMatches([], -1);
	assert.deepEqual(newlineMatchLayer.markers(h.view), []);
	h.dom.window.close();
});

test("literal and regex newline queries feed real match offsets into the same decorative layer and scope restriction", () => {
	const h = fixture("abc\n\ndef");
	for (const [query, regex] of [
		["\n", false],
		["\\n", true],
		["\\n\\n", true],
		["abc\\n\\ndef", true],
	]) {
		const matches = findTextOffsets(h.view.state.doc.toString(), query, regex, true);
		h.setMatches(matches);
		assert.equal(matches.length, query === "\n" || query === "\\n" ? 2 : 1);
		assert.equal(newlineMatchLayer.markers(h.view).length, 2);
	}
	const scoped = findTextOffsets(h.view.state.doc.toString(), "\\n", true, true, false, [
		{ from: 4, to: 5 },
	]);
	h.setMatches(scoped);
	assert.equal(newlineMatchLayer.markers(h.view).length, 1);
	assert.equal(newlineMatchLayer.markers(h.view)[0].draw().style.top, "20px");
	h.dom.window.close();
});

test("newlines obey visible intervals, folded-block protection and actual measured wrap geometry", () => {
	const h = fixture("long line\n\nb", { 9: rect(30, 40, 30, 56) });
	h.setMatches([{ from: 0, to: h.view.state.doc.length }]);
	assert.equal(
		newlineMatchLayer.markers(h.view)[0].draw().style.top,
		"40px",
		"use final visual row, not source line number",
	);
	h.view.visibleRanges = [
		{ from: 0, to: 9 },
		{ from: 10, to: 12 },
	];
	assert.equal(
		newlineMatchLayer.markers(h.view).length,
		1,
		"hidden newline does not become a phantom marker",
	);
	h.view.lineBlockAt = () => ({ from: 0, to: 12, type: 0 });
	assert.deepEqual(
		newlineMatchLayer.markers(h.view),
		[],
		"folded source cannot borrow a neighboring block",
	);
	h.view.lineBlockAt = () => ({ from: 10, to: 10, type: 3 });
	assert.deepEqual(
		newlineMatchLayer.markers(h.view),
		[],
		"replacement widgets are not source text",
	);
	h.dom.window.close();
});

test("newline markers clear on hide, writes, stale document results and undo rather than reusing old coordinates", () => {
	const h = fixture("a\nb");
	const matches = [{ from: 1, to: 2 }];
	h.setMatches(matches);
	const old = searchCacheEffect.of({ doc: h.view.state.doc, matches, visible: true, index: 0 });
	h.setMatches(matches, 0, false);
	assert.deepEqual(newlineMatchLayer.markers(h.view), []);
	h.setMatches(matches);
	const transaction = h.view.state.update({ changes: { from: 0, insert: "x" } });
	h.view.state = transaction.state;
	assert.deepEqual(newlineMatchLayer.markers(h.view), []);
	h.view.state = h.view.state.update({ effects: old }).state;
	assert.deepEqual(newlineMatchLayer.markers(h.view), []);
	h.view.state = h.view.state.update({
		changes: transaction.changes.invert(transaction.startState.doc),
	}).state;
	assert.deepEqual(newlineMatchLayer.markers(h.view), []);
	h.dom.window.close();
});

test("newline marker uses RTL/scale/scroll coordinates and remains independent of scope border settings", () => {
	const h = fixture("a\nb", { 1: rect(170, 80, 170, 110) });
	h.setMatches([{ from: 1, to: 2 }]);
	h.view.textDirection = 1;
	h.view.scaleX = h.view.scaleY = 2;
	h.root.getBoundingClientRect = () => rect(100, 50, 500, 400);
	Object.defineProperty(h.root, "clientWidth", { value: 200 });
	h.root.scrollLeft = 10;
	h.root.scrollTop = 20;
	const node = newlineMatchLayer.markers(h.view)[0].draw();
	assert.equal(node.dataset.direction, "rtl");
	assert.equal(node.style.left, "74px");
	assert.equal(node.style.top, "70px");
	assert.equal(node.style.width, "16px");
	assert.equal(node.style.height, "30px");
	assert.equal(node.style.fontSize, "16px");
	h.view.coordsAtPos = () => null;
	assert.deepEqual(newlineMatchLayer.markers(h.view), []);
	h.dom.window.close();
});

test("a large offscreen source is not walked when drawing newline matches", () => {
	const h = fixture("x\n".repeat(10000));
	h.setMatches([{ from: 0, to: h.view.state.doc.length }]);
	h.view.visibleRanges = [{ from: 10000, to: 10010 }];
	assert.equal(newlineMatchLayer.markers(h.view).length, 5);
	assert.equal(h.measurements.length, 5);
	h.dom.window.close();
});

test("blank lines in one exact scope join adjacent contours using their common text width, not editor width", () => {
	for (const blank of ["\n", "\n\n", "  \n\t\n"]) {
		const h = fixture(`abc\n${blank}def`),
			last = h.view.state.doc.line(h.view.state.doc.lines);
		h.scope([{ from: 0, to: h.view.state.doc.length }]);
		h.mark(0, [
			rect(0, 0, 24, 16),
			rect(0, (last.number - 1) * 20, 40, (last.number - 1) * 20 + 16),
		]);
		h.root.style.setProperty("--nya-scope-border-width", "1px");
		const nodes = scopeOutlineLayer.markers(h.view);
		assert.equal(nodes.length, 1);
		const edges = segments(nodes[0].draw().querySelector("path").getAttribute("d"));
		assert.equal(
			edges.filter(([x, , xx]) => x === xx && x === -0.5).length,
			1,
			"one unbroken left edge across selected blank lines",
		);
		assert.ok(Math.max(...edges.flatMap(([x, , xx]) => [x, xx])) < 50);
		assert.equal(h.view.state.doc.toString(), `abc\n${blank}def`);
		h.dom.window.close();
	}
});

test("blank-line supplementation cannot connect independent scopes or hidden/folded source", () => {
	const h = fixture("abc\n\ndef");
	const input = new Map([
		["0", [rect(0, 0, 24, 16)]],
		["1", [rect(0, 40, 24, 56)]],
	]);
	const before = structuredClone(input);
	scopeGeometry.addScopeBlankLines(
		h.view,
		[
			{ from: 0, to: 4 },
			{ from: 5, to: 8 },
		],
		input,
		{ left: 0, top: 0 },
	);
	assert.deepEqual(input, before);
	for (const setup of [
		() => {
			h.view.visibleRanges = [
				{ from: 0, to: 4 },
				{ from: 5, to: 8 },
			];
		},
		() => {
			h.view.visibleRanges = [{ from: 0, to: 8 }];
			h.view.lineBlockAt = () => ({ from: 0, to: 8, type: 0 });
		},
		() => {
			h.view.coordsAtPos = () => null;
		},
	]) {
		setup();
		const groups = new Map([["0", [rect(0, 0, 24, 16), rect(0, 40, 24, 56)]]]),
			original = structuredClone(groups);
		scopeGeometry.addScopeBlankLines(h.view, [{ from: 0, to: 8 }], groups, { left: 0, top: 0 });
		assert.deepEqual(groups, original);
	}
	h.dom.window.close();
});

test("nonoverlapping indented lines connect through the measured blank insertion point without filling their bounding box", () => {
	const h = fixture("abc\n\ndef", { 4: rect(40, 20, 40, 36), 5: rect(80, 40, 80, 56) });
	const groups = new Map([["0", [rect(0, 0, 24, 16), rect(80, 40, 104, 56)]]]);
	scopeGeometry.addScopeBlankLines(h.view, [{ from: 0, to: 8 }], groups, { left: 0, top: 0 });
	const edges = segments(outline.paddedScopeOutlines([...groups.values()], 1)[0]);
	assert.ok(
		edges.some(([x, , xx]) => x === xx && x > 24 && x < 80),
		"interior stepped connector, not a large enclosing rectangle",
	);
	assert.ok(groups.get("0").some((r) => r.left === 40 && r.right === 44));
	assert.ok(
		groups
			.get("0")
			.filter((r) => r.right - r.left > 24 && r.top >= 16 && r.bottom <= 40)
			.every((r) => r.bottom - r.top <= 4),
		"horizontal arms stay narrow instead of filling the blank band",
	);
	h.dom.window.close();
});

test("bidi fragment holes remain disconnected rather than receiving guessed blank corridors", () => {
	const h = fixture("abc\n\ndef");
	const groups = new Map([["0", [rect(0, 0, 8, 16), rect(16, 0, 24, 16), rect(0, 40, 24, 56)]]]);
	const before = structuredClone(groups);
	scopeGeometry.addScopeBlankLines(h.view, [{ from: 0, to: 8 }], groups, { left: 0, top: 0 });
	assert.deepEqual(groups, before);
	h.dom.window.close();
});

test("a connector that would touch another selection is rejected rather than joining scopes", () => {
	const h = fixture("abc\n\ndef");
	const groups = new Map([
		["0", [rect(0, 0, 24, 16), rect(0, 40, 24, 56)]],
		["1", [rect(10, 20, 20, 30)]],
	]);
	const before = structuredClone(groups);
	scopeGeometry.addScopeBlankLines(h.view, [{ from: 0, to: 8 }], groups, { left: 0, top: 0 });
	assert.deepEqual(groups, before);
	h.dom.window.close();
});

test("newline-only scope and selected leading/trailing blank lines acquire visible outline geometry", () => {
	const h = fixture("\n\n");
	const groups = new Map();
	scopeGeometry.addScopeBlankLines(h.view, [{ from: 0, to: 2 }], groups, { left: 0, top: 0 });
	assert.ok(groups.get("0").some((r) => r.top === 0 && r.bottom === 36 && r.right > r.left));
	assert.equal(outline.paddedScopeOutlines([...groups.values()], 1).length, 1);
	h.dom.window.close();
});

test("blank connectors are added after text-row normalization, so their height never flattens the text contour", () => {
	const h = fixture("abc\n\n\n\ndef");
	h.mark(0, [rect(10, 0, 24, 16), rect(0, 80, 24, 96)]);
	h.scope([{ from: 0, to: 10 }]);
	h.root.style.setProperty("--nya-scope-border-width", "1px");
	const edges = segments(
		scopeOutlineLayer.markers(h.view)[0].draw().querySelector("path").getAttribute("d"),
	);
	assert.ok(
		edges.some(([x, y, xx, yy]) => y === yy && x === -0.5 && xx === 9.5 && y > 16),
		"lower line remains wider than connector",
	);
	h.dom.window.close();
});

test("blank connectors remeasure for scroll, scale and source changes without modifying exact ranges", () => {
	const h = fixture("abc\n\ndef", {
		3: rect(110, 60, 110, 76),
		4: rect(110, 80, 110, 96),
		5: rect(110, 100, 110, 116),
	});
	h.scope([{ from: 0, to: 8 }]);
	h.mark(0, [rect(110, 60, 150, 76), rect(110, 100, 150, 116)]);
	h.root.getBoundingClientRect = () => rect(100, 50, 500, 400);
	h.root.scrollLeft = 5;
	h.root.scrollTop = 10;
	h.view.scaleX = h.view.scaleY = 2;
	h.root.style.setProperty("--nya-scope-border-width", "2px");
	const oldRanges = h.view.state.field(searchScopeField).ranges;
	const path = scopeOutlineLayer
		.markers(h.view)[0]
		.draw()
		.querySelector("path")
		.getAttribute("d");
	assert.ok(
		segments(path).some(([x, y, xx, yy]) => x === xx && x === 19 && y === 27 && yy === 89),
	);
	assert.deepEqual(h.view.state.field(searchScopeField).ranges, oldRanges);
	h.scope(null);
	assert.deepEqual(scopeOutlineLayer.markers(h.view), []);
	h.dom.window.close();
});

test("each pane uses its own newline coordinates and older hosts keep text highlights without a layer", async () => {
	const a = fixture("a\nb"),
		b = fixture("a\nb", { 1: rect(40, 60, 40, 80) });
	a.setMatches([{ from: 1, to: 2 }]);
	b.setMatches([{ from: 1, to: 2 }]);
	assert.equal(newlineMatchLayer.markers(a.view)[0].draw().style.left, "8px");
	assert.equal(newlineMatchLayer.markers(b.view)[0].draw().style.left, "40px");
	a.setMatches([], -1);
	assert.equal(newlineMatchLayer.markers(b.view).length, 1);
	vi.resetModules();
	vi.doMock("@codemirror/view", async (importOriginal) => ({
		...(await importOriginal()),
		layer: undefined,
	}));
	const legacy = await import("../../src/platform/codemirror/search-highlight");
	vi.doUnmock("@codemirror/view");
	let state = stateModule.EditorState.create({
		doc: "a\nb",
		extensions: [legacy.textMatchMarker],
	});
	state = state.update({
		effects: legacy.searchCacheEffect.of({
			doc: state.doc,
			matches: [{ from: 1, to: 2 }],
			visible: true,
			index: 0,
		}),
	}).state;
	assert.equal(state.field(legacy.textMatchMarker).size, 1);
	a.dom.window.close();
	b.dom.window.close();
});

test("real CodeMirror owns the newline layer and removes it on destroy; decorative CSS cannot alter wrapping", () => {
	const h = fixture("a\nb"),
		win = h.dom.window;
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		MutationObserver: globalThis.MutationObserver,
	};
	Object.assign(globalThis, {
		window: win,
		document: win.document,
		MutationObserver: win.MutationObserver,
	});
	win.requestAnimationFrame = () => 1;
	win.cancelAnimationFrame = () => {};
	let view;
	try {
		view = new viewModule.EditorView({
			parent: h.root,
			state: stateModule.EditorState.create({ doc: "a\nb", extensions: [textMatchMarker] }),
		});
		const layer = h.root.querySelector(".nya-newline-layer");
		assert.ok(layer);
		assert.equal(layer.getAttribute("aria-hidden"), "true");
		view.destroy();
		view = null;
		assert.equal(h.root.querySelector(".nya-newline-layer"), null);
	} finally {
		view?.destroy();
		Object.assign(globalThis, previous);
		h.dom.window.close();
	}
	const css = compileString(readFileSync("src/styles/index.scss", "utf8")).css;
	assert.match(
		css,
		/\.nya-newline-layer,\s*\.nya-newline-match\s*\{[^}]*pointer-events: none[^}]*user-select: none/s,
	);
	assert.match(css, /\.nya-newline-match::before\s*\{[^}]*content: "↵"/s);
});
