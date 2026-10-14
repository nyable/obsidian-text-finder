import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { EditorState } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";
import { loadSource } from "./source-loader.mjs";
import { scopeSource } from "./search-scope-source.mjs";

const { scopeOutline, paddedScopeOutlines, measureScopeOutlines, previewScopeOutline } = loadSource("../src/scope-outline.ts");
const { scopeOutlineLayer, searchScopeField, searchScopeEffect } = scopeSource;
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const segments = (path) => [...path.matchAll(/M(-?[\d.]+) (-?[\d.]+)([HV])(-?[\d.]+)/g)].map(([, x, y, axis, end]) =>
	axis === "H" ? [Number(x), Number(y), Number(end), Number(y)] : [Number(x), Number(y), Number(x), Number(end)]);
const length = (path) => segments(path).reduce((sum, [x, y, xx, yy]) => sum + Math.abs(x - xx) + Math.abs(y - yy), 0);

test("union outline removes syntax/match seams instead of outlining each text fragment", () => {
	const path = scopeOutline([rect(10, 0, 20, 10), rect(20, 0, 40, 10), rect(15, 0, 25, 10)]);
	assert.equal(length(path), 80);
	assert.deepEqual(segments(path).filter(([x, , xx]) => x === xx).map(([x]) => x).sort((a, b) => a - b), [10, 40]);
});

test("cross-line outline follows stepped text contour, not its large bounding rectangle", () => {
	const path = scopeOutline([rect(20, 0, 100, 10), rect(0, 10, 100, 20), rect(0, 20, 40, 30)]);
	assert.equal(length(path), 260);
	assert.ok(segments(path).some(([x, y, xx, yy]) => x === 0 && y === 10 && xx === 20 && yy === 10));
	assert.ok(segments(path).some(([x, y, xx, yy]) => x === 40 && y === 20 && xx === 100 && yy === 20));
	assert.ok(!segments(path).some(([x, y, xx, yy]) => x === 0 && xx === 0 && y === 0 && yy === 30));
});

test("bidi fragments, holes and separated rows are never replaced by an enclosing rectangle", () => {
	const path = scopeOutline([rect(0, 0, 10, 10), rect(20, 0, 30, 10), rect(0, 30, 10, 40)]);
	assert.equal(length(path), 120);
	assert.equal(scopeOutline([rect(NaN, 0, 10, 10), rect(0, 0, 0, 10), rect(2, 3, 1, 5)]), "");
});

test("outline padding leaves 2px of inner clearance at each supported width without changing text boxes", () => {
	for (const width of [1, 2, 3]) {
		const boxes = [rect(10, 20, 50, 40)], before = structuredClone(boxes);
		const path = paddedScopeOutlines([boxes], width)[0], offset = 2 + width / 2;
		const xs = segments(path).flatMap(([x, , xx]) => [x, xx]);
		assert.equal(Math.min(...xs), 10 - offset); assert.equal(Math.max(...xs), 50 + offset);
		assert.equal(10 - (Math.min(...xs) + width / 2), 2);
		assert.deepEqual(boxes, before);
	}
});

test("padding preserves seams removal and limits expansion around narrow gaps and separate scopes", () => {
	const separate = paddedScopeOutlines([[rect(0, 0, 10, 10)], [rect(14, 0, 24, 10)]], 1);
	assert.equal(separate.length, 2);
	const right = Math.max(...segments(separate[0]).flatMap(([x, , xx]) => [x, xx]));
	const left = Math.min(...segments(separate[1]).flatMap(([x, , xx]) => [x, xx]));
	assert.ok(right + 0.5 < left - 0.5, 'stroke edges retain a gap');
	const joined = paddedScopeOutlines([[rect(0, 0, 10, 10), rect(10, 0, 20, 10)]], 1)[0];
	assert.equal(segments(joined).filter(([x, , xx]) => x === xx).length, 2);
	const bidi = paddedScopeOutlines([[rect(0, 0, 10, 10), rect(12, 0, 22, 10)]], 3)[0];
	assert.equal(segments(bidi).filter(([x, , xx]) => x === xx).length, 4, 'do not merge disconnected fragments even with a thick stroke');
	const concave = paddedScopeOutlines([[rect(20, 0, 100, 10), rect(0, 10, 100, 20), rect(0, 20, 40, 30)]], 1)[0];
	assert.ok(segments(concave).some(([x, y, xx, yy]) => y === yy && x === -2.5 && xx === 17.5));
});

function sample() {
	const dom = new JSDOM('<html><body><div id="root"></div></body></html>');
	const root = dom.window.document.getElementById('root');
	const add = (id, rectangles) => {
		const span = dom.window.document.createElement('span'); span.dataset.nyaScope = id;
		span.getClientRects = () => rectangles; root.append(span); return span;
	};
	return { dom, root, add };
}

test("DOM measurement groups split marks by scope, handles reflow and never bridges distinct selections", () => {
	const h = sample();
	h.add("0", [rect(110, 50, 120, 60)]); const next = h.add("0", [rect(120, 50, 150, 60)]);
	h.add("1", [rect(150, 50, 170, 60)]);
	let paths = measureScopeOutlines(h.root, { left: 100, top: 50 });
	assert.equal(paths.length, 2); assert.equal(length(paths[0]), 100); assert.equal(length(paths[1]), 60);
	next.getClientRects = () => [rect(100, 62, 140, 72)];
	paths = measureScopeOutlines(h.root, { left: 100, top: 50 });
	assert.equal(paths.length, 2); assert.equal(length(paths[0]), 124, 'small leading gaps join overlapping consecutive rows');
	h.root.replaceChildren(); assert.deepEqual(measureScopeOutlines(h.root, { left: 0, top: 0 }), []);
	h.dom.window.close();
});

test("outline layer creates owner-document decorative SVG markers and releases its style listener", () => {
	const h = sample(); h.add("0", [rect(140, 80, 180, 100)]);
	const win = h.dom.window;
	const state = EditorState.create({ doc: "cat cat", extensions: [searchScopeField] });
	let dispatches = 0;
	const view = { dom: h.root, contentDOM: h.root, scrollDOM: h.root, state: state.update({ effects: searchScopeEffect.of([{ from: 0, to: 3 }]) }).state,
		textDirection: 0, scaleX: 1, scaleY: 1, dispatch: () => dispatches++ };
	h.root.style.setProperty('--nya-scope-border-width', '2px');
	h.root.getBoundingClientRect = () => rect(100, 50, 500, 400);
	h.root.scrollLeft = 10; h.root.scrollTop = 20;
	let markers = scopeOutlineLayer.markers(view); assert.equal(markers.length, 1);
	assert.equal(markers[0].eq(scopeOutlineLayer.markers(view)[0]), true);
	const element = markers[0].draw(), svg = element.querySelector('svg');
	assert.equal(element.ownerDocument, h.dom.window.document); assert.equal(svg.getAttribute('aria-hidden'), 'true');
	assert.ok(segments(svg.querySelector('path').getAttribute('d')).some(([x, y]) => x === 47 && y === 47), '3px centerline offset leaves 2px inside a 2px stroke');
	const layer = win.document.createElement('div'); scopeOutlineLayer.mount(layer, view);
	win.document.dispatchEvent(new win.Event('nya-scope-style-change')); assert.equal(dispatches, 1);
	scopeOutlineLayer.destroy(layer, view); win.document.dispatchEvent(new win.Event('nya-scope-style-change')); assert.equal(dispatches, 1);
	h.root.style.setProperty('--nya-scope-border-width', '0px'); assert.deepEqual(scopeOutlineLayer.markers(view), []);
	h.root.style.setProperty('--nya-scope-border-width', '3px'); view.state = state; assert.deepEqual(scopeOutlineLayer.markers(view), []);
	h.dom.window.close();
});

test("outline style subscription follows adopted owner documents without leaking the old listener", () => {
	const a = sample(), b = sample(), element = a.dom.window.document.createElement('div');
	let dispatches = 0; const view = { dom: a.root, dispatch: () => dispatches++ };
	scopeOutlineLayer.mount(element, view);
	b.root.append(b.dom.window.document.adoptNode(a.root));
	scopeOutlineLayer.update({ view }, element);
	a.dom.window.document.dispatchEvent(new a.dom.window.Event('nya-scope-style-change')); assert.equal(dispatches, 0);
	b.dom.window.document.dispatchEvent(new b.dom.window.Event('nya-scope-style-change')); assert.equal(dispatches, 1);
	scopeOutlineLayer.destroy(element);
	b.dom.window.document.dispatchEvent(new b.dom.window.Event('nya-scope-style-change')); assert.equal(dispatches, 1);
	a.dom.window.close(); b.dom.window.close();
});

test("preview remeasures on resize, remains decorative and releases observer/listeners on destruction", async () => {
	const h = sample(); const span = h.add("preview", [rect(10, 10, 30, 20)]);
	let observe = 0, disconnect = 0, resize;
	h.dom.window.ResizeObserver = class { constructor(callback) { resize = callback; } observe() { observe++; } disconnect() { disconnect++; } };
	const action = previewScopeOutline(h.root); await Promise.resolve();
	assert.equal(observe, 1); assert.equal(h.root.querySelectorAll(':scope > svg').length, 1);
	const old = h.root.querySelector('path').getAttribute('d');
	span.getClientRects = () => [rect(20, 30, 40, 40)]; resize(); await Promise.resolve();
	assert.notEqual(h.root.querySelector('path').getAttribute('d'), old);
	const beforeWidth = h.root.querySelector('path').getAttribute('d');
	h.root.style.setProperty('--nya-scope-border-width', '3px');
	h.dom.window.document.dispatchEvent(new h.dom.window.Event('nya-scope-style-change')); await Promise.resolve();
	assert.notEqual(h.root.querySelector('path').getAttribute('d'), beforeWidth, 'width changes remeasure preview clearance without requiring resize');
	resize(); action.destroy(); await Promise.resolve();
	assert.equal(disconnect, 1); assert.equal(h.root.querySelector('svg'), null);
	h.dom.window.dispatchEvent(new h.dom.window.Event('resize')); await Promise.resolve(); assert.equal(h.root.querySelector('svg'), null);
	h.dom.window.close();
});

test("real CodeMirror renders separate scope identities across split marks and removes layer resources on destroy", () => {
	const h = sample(), win = h.dom.window;
	const previous = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver };
	globalThis.window = win; globalThis.document = win.document; globalThis.MutationObserver = win.MutationObserver;
	win.requestAnimationFrame = () => 1; win.cancelAnimationFrame = () => {};
	let view;
	try {
		view = new EditorView({ parent: h.root, state: EditorState.create({ doc: 'cat cat\ncat cat',
			extensions: [searchScopeField, scopeSource.searchScopeDecoration, EditorView.decorations.of(
				Decoration.set([Decoration.mark({ class: 'syntax-test' }).range(2, 4)]))] }) });
		view.dispatch({ effects: searchScopeEffect.of([{ from: 1, to: 10 }, { from: 11, to: 14 }]) });
		assert.ok(view.contentDOM.querySelectorAll('[data-nya-scope="0"]').length >= 2);
		assert.equal(view.contentDOM.querySelectorAll('[data-nya-scope="1"]').length, 1);
		assert.ok(view.scrollDOM.querySelector('.nya-scope-layer'));
		assert.equal(view.scrollDOM.querySelector('.nya-scope-layer').getAttribute('aria-hidden'), 'true');
		view.dispatch({ effects: searchScopeEffect.of(null) }); assert.equal(view.contentDOM.querySelector('[data-nya-scope]'), null);
		view.destroy(); view = undefined; assert.equal(h.root.querySelector('.nya-scope-layer'), null);
	} finally { view?.destroy(); Object.assign(globalThis, previous); win.close(); }
});
