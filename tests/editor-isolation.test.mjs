import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { loadSource } from "./source-loader.mjs";

const helper = loadSource("../src/util/text-helper.ts");
class MarkdownView {}
const highlightStub = { CLS: { FINDER: "nya-finder" }, searchCacheEffect: { of: (value) => value } };

function editorView(content) {
	const view = new MarkdownView();
	view.file = { path: "note.md" };
	view.scrolls = [];
	view.transactions = [];
	view.modeChanges = [];
	view.mode = "source";
	view.getMode = () => view.mode;
	view.getState = () => ({ mode: "source", source: true });
	view.setState = (state) => { view.modeChanges.push(state); };
	view.editor = {
		getValue: () => view.editor.cm.state.doc.toString(),
		offsetToPos: (offset) => offset,
		scrollIntoView: (range) => view.scrolls.push(range),
		cm: {
			state: EditorState.create({ doc: content }),
			dispatch(spec) {
				view.transactions.push(spec);
				// Effects are inspected as snapshots; real StateField is tested separately.
				this.state = this.state.update({ changes: spec.changes, selection: spec.selection }).state;
				view.afterDispatch?.(spec);
			},
		},
	};
	return view;
}

function environment() {
	const a = editorView("cat cat");
	const b = editorView("prefix cat");
	let active = a;
	let open = [a, b];
	const events = new Map();
	const commands = new Map();
	const workspace = {
		getActiveViewOfType: () => active,
		iterateAllLeaves: (callback) => open.forEach((view) => callback({ view })),
		on: (name, callback) => events.set(name, callback),
	};
	let saves = 0;
	const plugin = {
		settings: {
			enableHistory: true, historyMaxCount: 10, searchHistory: [],
			moveCursorToMatch: true, clearAfterHidden: false,
		},
		app: { workspace },
		registerEvent: () => {}, addCommand: (command) => commands.set(command.id, command),
		saveSettings: () => { saves++; return Promise.resolve(); },
	};
	const { EditorSearch } = loadSource("../src/editor-extension.ts", {
		"./search-highlight": highlightStub,
		"./SearchBox.svelte": {}, obsidian: { MarkdownView },
		"./i18n": { i18n: { t: (key) => key } }, "./util/common-helper": {}, "./HistoryModal": {},
	});
	const search = new EditorSearch(plugin);
	const finder = (view) => {
		const component = loadSource("../src/SearchBox.svelte", {
			"./search-highlight": highlightStub,
			"./editor-extension": highlightStub,
			"./util/text-helper": helper, "./constants": loadSource("../src/constants.ts"),
			obsidian: { MarkdownView, Platform: { isMobile: false } },
		});
		component.editorSearch = search;
		component.ownerView = view;
		component.getSearchCache().visible = true;
		component.setFindText("cat", false);
		search.finderViews.set(view, component);
		return component;
	};
	const fa = finder(a);
	const fb = finder(b);
	return {
		a, b, fa, fb, plugin, search, events, commands,
		activate: (view) => { active = view; },
		close: (view) => { open = open.filter((item) => item !== view); },
		saves: () => saves,
	};
}

test("inactive Finder search, navigation and replacements never touch the active view", () => {
	const h = environment();
	h.activate(h.b);
	const bTransactions = h.b.transactions.length;
	h.fa.setFindText("cat", false);
	h.fa.toNextMatch();
	assert.deepEqual(h.a.scrolls.at(-1), { from: 4, to: 7 });
	h.fa.replaceMatchedText("dog");
	assert.equal(h.a.editor.getValue(), "cat dog");
	assert.equal(h.b.editor.getValue(), "prefix cat");
	assert.equal(h.b.transactions.length, bTransactions);
	assert.equal(h.b.scrolls.length, 0);
	assert.equal(h.b.modeChanges.length, 0);
});

for (const action of ["toNextMatch", "toPreviousMatch"]) {
	test(`${action} scrolls before saving and save completion has no editor effects`, async () => {
		const h = environment();
		let resolve;
		h.plugin.saveSettings = () => new Promise((done) => { resolve = done; });
		h.fa[action]();
		assert.equal(h.a.scrolls.length, 1, "navigation is synchronous even with a pending save");
		h.activate(h.b);
		const count = h.a.transactions.length;
		resolve();
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(h.a.transactions.length, count);
		assert.equal(h.b.scrolls.length, 0);
	});
}

test("failed history save is caught without blocking navigation", async (t) => {
	const h = environment();
	const error = new Error("disk failure");
	t.mock.method(console, "error", () => {});
	h.plugin.saveSettings = async () => { throw error; };
	h.fa.toNextMatch();
	assert.equal(h.a.scrolls.length, 1);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(console.error.mock.calls.length, 1);
	assert.equal(console.error.mock.calls[0].arguments[1], error);
});

test("editor-change routes by source, including MarkdownFileInfo, without scrolling", () => {
	const h = environment();
	h.activate(h.b);
	h.a.editor.cm.state = EditorState.create({ doc: "prefix cat cat cat" });
	const bCount = h.b.transactions.length;
	h.events.get("editor-change")(h.a.editor, { file: h.a.file });
	assert.equal(h.fa.getSearchCache().matches.length, 3);
	assert.equal(h.b.transactions.length, bCount);
	assert.equal(h.a.scrolls.length, 0);
	h.events.get("editor-change")({}, h.a);
	assert.equal(h.b.transactions.length, bCount);
	// Unknown editors must not fall back to the active Finder.
	h.events.get("editor-change")({}, {});
	assert.equal(h.b.transactions.length, bCount);
});

test("activating an unopened Finder does not create one or scroll another view", () => {
	const h = environment();
	let creates = 0;
	h.search.getFinder = () => { creates++; throw new Error("unexpected creation"); };
	h.events.get("active-leaf-change")({ view: editorView("cat") });
	h.events.get("active-leaf-change")({ view: h.a });
	assert.equal(creates, 0);
	assert.equal(h.a.scrolls.length, 0);
});

test("file-open resets match identity when the same view opens another file", () => {
	const h = environment();
	h.fa.getSearchCache().index = 1;
	h.a.file = { path: "other.md" };
	h.a.editor.cm.state = EditorState.create({ doc: "xx cat cat" });
	h.events.get("file-open")();
	assert.equal(h.fa.getSearchCache().index, 0);
	assert.equal(h.fa.getSearchCache().matches[0].from, 3);
	assert.equal(h.a.scrolls.length, 0);
	h.fa.scrollToMatch();
	assert.deepEqual(h.a.scrolls.at(-1), { from: 3, to: 6 });
});

test("navigation and direct scrolling revalidate edited offsets and invalid indices", () => {
	const h = environment();
	h.a.editor.cm.state = EditorState.create({ doc: "prefix cat" });
	h.fa.getSearchCache().index = -4;
	h.fa.toNextMatch();
	assert.deepEqual(h.a.scrolls.at(-1), { from: 7, to: 10 });
	h.a.editor.cm.state = EditorState.create({ doc: "fox" });
	h.fa.scrollToMatch();
	assert.equal(h.fa.getSearchCache().matches.length, 0);
	assert.equal(h.a.scrolls.length, 1);
});

test("two views of one file have independent current matches", () => {
	const h = environment();
	h.b.file = h.a.file;
	h.b.editor.cm.state = EditorState.create({ doc: "cat cat" });
	h.fb.matchAgain(false);
	h.fa.toNextMatch();
	assert.equal(h.fa.getSearchCache().index, 1);
	assert.equal(h.fb.getSearchCache().index, 0);
});

test("a recreated editor is used rather than a stale CodeMirror instance", () => {
	const h = environment();
	const old = h.a.editor;
	h.a.editor = editorView("xx cat").editor;
	h.fa.replaceAllMatchedText("dog");
	assert.equal(h.a.editor.getValue(), "xx dog");
	assert.equal(old.cm.state.doc.toString(), "cat cat");
});

test("closed or reading-mode targets are safe no-ops even while another editor is active", () => {
	for (const invalidate of [(h) => h.close(h.a), (h) => { h.a.mode = "preview"; }]) {
		const h = environment();
		h.activate(h.b);
		invalidate(h);
		const aCount = h.a.transactions.length;
		const bCount = h.b.transactions.length;
		h.fa.toNextMatch();
		assert.equal(h.fa.replaceAllMatchedText("dog").changed, false);
		h.fa.emitChange();
		assert.equal(h.a.transactions.length, aCount);
		assert.equal(h.b.transactions.length, bCount);
		assert.equal(h.fa.getSearchCache().matches.length, 0);
	}
});

test("highlight effects are independent snapshots and old contexts cannot dispatch", () => {
	const h = environment();
	const effect = h.a.transactions.at(-1).effects[0];
	h.fa.getSearchCache().matches[0].from = 100;
	assert.equal(effect.matches[0].from, 0);
	const context = h.fa.getEditorContext();
	h.a.editor.cm.state = EditorState.create({ doc: "new cat" });
	const count = h.a.transactions.length;
	h.fa.emitChange(true, undefined, context);
	assert.equal(h.a.transactions.length, count);
});

test("replacement recomputation stays in its owner if dispatch activates another view", () => {
	const h = environment();
	h.a.afterDispatch = (spec) => { if (spec.changes) h.activate(h.b); };
	const count = h.b.transactions.length;
	h.fa.replaceMatchedText("dog");
	assert.equal(h.a.editor.getValue(), "dog cat");
	assert.deepEqual(h.fa.getSearchCache().matches.map(({ from, to }) => [from, to]), [[4, 7]]);
	assert.equal(h.b.transactions.length, count);
});

test("replacement completion does not scroll a new file opened in its owner view", () => {
	const h = environment();
	h.a.afterDispatch = (spec) => {
		if (!spec.changes) return;
		h.a.file = { path: "replacement-completion.md" };
		h.a.editor.cm.state = EditorState.create({ doc: "new cat" });
	};
	assert.equal(h.fa.replaceMatchedText("dog").changed, true);
	assert.equal(h.a.editor.getValue(), "new cat");
	assert.equal(h.a.scrolls.length, 0);
	assert.equal(h.fa.getSearchCache().matches.length, 0);
});

test("editing regex context invalidates lookbehind matches and result highlights", () => {
	const h = environment();
	h.fa.getSearchCache().options.regexMode = true;
	h.a.editor.cm.state = EditorState.create({ doc: "foobar" });
	h.fa.setFindText("(?<=foo)bar", false);
	assert.equal(h.fa.getSearchCache().matches.length, 1);
	h.a.editor.cm.state = EditorState.create({ doc: "xxxbar" });
	h.events.get("editor-change")(h.a.editor, h.a);
	assert.equal(h.fa.getSearchCache().matches.length, 0);
	assert.deepEqual(h.a.transactions.at(-1).effects[0].matches, []);
});

test("inverse and redo edits recompute Finder matches without scrolling", () => {
	const h = environment();
	const before = h.a.editor.cm.state;
	const transaction = before.update({ changes: { from: 0, to: 3, insert: "dog" } });
	h.a.editor.cm.state = transaction.state;
	h.events.get("editor-change")(h.a.editor, h.a);
	assert.equal(h.fa.getSearchCache().matches.length, 1);
	h.a.editor.cm.state = transaction.state.update({ changes: transaction.changes.invert(before.doc) }).state;
	h.events.get("editor-change")(h.a.editor, h.a);
	assert.equal(h.fa.getSearchCache().matches.length, 2);
	h.a.editor.cm.state = h.a.editor.cm.state.update({ changes: transaction.changes }).state;
	h.events.get("editor-change")(h.a.editor, h.a);
	assert.equal(h.fa.getSearchCache().matches.length, 1);
	assert.equal(h.a.scrolls.length, 0);
});

test("ordinary navigation reuses valid matches rather than running another search", () => {
	const h = environment();
	const matches = h.fa.getSearchCache().matches;
	h.fa.toNextMatch();
	h.fa.toPreviousMatch();
	assert.equal(h.fa.getSearchCache().matches, matches);
});

for (const id of ["text-finder-next-match", "text-finder-previous-match", "text-finder-replace", "text-finder-replace-all"]) {
	test(`${id} uses the supplied command editor, not the global active view`, () => {
		const h = environment();
		h.activate(h.b);
		h.fa.getSearchCache().replace = "dog";
		const count = h.b.transactions.length;
		h.commands.get(id).editorCallback(h.a.editor, { file: h.a.file });
		assert.equal(h.b.transactions.length, count);
		assert.ok(h.a.scrolls.length > 0 || h.a.editor.getValue().includes("dog"));
	});
}

test("unloading invalidates saved contexts and event callbacks", () => {
	const h = environment();
	const context = h.fa.getEditorContext();
	h.search.destoryAll();
	const count = h.a.transactions.length;
	h.fa.emitChange(true, undefined, context);
	h.events.get("editor-change")(h.a.editor, h.a);
	h.events.get("file-open")();
	assert.equal(h.a.transactions.length, count);
});

test("creating a Finder passes its explicit owner even if another view is active", () => {
	const h = environment();
	const created = [];
	const { EditorSearch } = loadSource("../src/editor-extension.ts", {
		"./search-highlight": highlightStub,
		"./SearchBox.svelte": { default: class {
			constructor(options) { created.push(options); }
		} },
		obsidian: { MarkdownView }, "./i18n": { i18n: { t: (key) => key } },
		"./util/common-helper": { generateUniqueId: () => "explicit-owner" }, "./HistoryModal": {},
	});
	h.plugin.registerDomEvent = () => {};
	h.a.containerEl = { querySelector: () => null };
	h.activate(h.b);
	const search = new EditorSearch(h.plugin);
	const finder = search.getFinder(h.a);
	assert.equal(created.length, 1);
	assert.equal(created[0].props.ownerView, h.a);
	assert.equal(created[0].target, h.a.containerEl);
	assert.equal(search.getFinder(h.a), finder);
});
