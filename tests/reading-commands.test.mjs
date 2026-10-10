import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";

const helper = loadSource("../src/util/text-helper.ts");
const readingSource = loadSource("../src/reading-search.ts", {
	"./reading-text": loadSource("../src/reading-text.ts"), "./util/text-helper": helper,
});
class MarkdownView {}

function environment() {
	const dom = new JSDOM("<!doctype html><html><body></body></html>");
	dom.window.CSS = { highlights: new Map() };
	dom.window.Highlight = class extends Set { priority = 0; };
	const root = dom.window.document.createElement("div");
	root.innerHTML = "<p>hello <strong>world</strong></p>";
	dom.window.document.body.append(root);
	const view = new MarkdownView();
	view.file = { path: "a.md" };
	view.getMode = () => "preview";
	view.editor = {};
	view.previewMode = { containerEl: root, renderer: {
		sections: [{ el: root.firstChild, rendered: true }], text: "md", lastText: "md", parsing: false, rendered: null,
		previewEl: root, showSection() {}, applyScrollSection() { return true; }, updateVirtualDisplay() {}, onRendered() {},
	} };
	const calls = [];
	const notices = [];
	const events = new Map();
	const commands = new Map();
	view.showSearch = () => calls.push(["native"]);
	const finder = {
		setVisible: (...args) => calls.push(["visible", ...args]),
		toggleVisible: () => calls.push(["toggle"]),
		toNextMatch: () => calls.push(["next"]),
		toPreviousMatch: () => calls.push(["previous"]),
		matchAgain: () => calls.push(["refresh"]),
		$destroy: () => calls.push(["destroy"]),
	};
	let open = true;
	const plugin = {
		settings: { useObsidianSearchInRead: false, useSelectionAsSearch: true },
		app: { workspace: {
			getActiveViewOfType: () => view,
			iterateAllLeaves: (callback) => { if (open) callback({ view }); },
			on: (name, callback) => events.set(name, callback),
		} },
		registerEvent() {}, addCommand: (command) => commands.set(command.id, command),
	};
	const { EditorSearch } = loadSource("../src/editor-extension.ts", {
		"./search-highlight": {}, "./SearchBox.svelte": {}, "./reading-search": readingSource,
		obsidian: { MarkdownView, Notice: class { constructor(text) { notices.push(text); } } },
		"./i18n": { i18n: { t: (key) => key } }, "./util/common-helper": {}, "./HistoryModal": {},
	});
	const search = new EditorSearch(plugin);
	let created = 0;
	search.getFinder = (owner) => { assert.equal(owner, view); created++; return finder; };
	return { dom, root, view, plugin, commands, events, calls, notices, search,
		created: () => created, close: () => { open = false; } };
}

test("reading ShowFind checks without side effects and opens the plugin without native search", () => {
	const h = environment();
	const command = h.commands.get("text-finder-show-find");
	assert.equal(command.checkCallback(true), true);
	assert.equal(h.created(), 0);
	command.checkCallback(false);
	assert.deepEqual(h.calls, [["visible", true, undefined]]);
	assert.equal(h.notices.length, 0);
	h.search.destoryAll();
});

test("reading selection comes from the owning preview document and ignores outside selections", () => {
	const h = environment();
	const selection = h.dom.window.getSelection();
	const range = h.dom.window.document.createRange();
	range.selectNodeContents(h.root.querySelector("strong"));
	selection.addRange(range);
	h.commands.get("text-finder-show-find").checkCallback(false);
	assert.deepEqual(h.calls.at(-1), ["visible", true, "world"]);
	const outside = h.dom.window.document.createElement("p"); outside.textContent = "outside";
	h.dom.window.document.body.append(outside);
	range.selectNodeContents(outside);
	selection.removeAllRanges(); selection.addRange(range);
	h.commands.get("text-finder-show-find").checkCallback(false);
	assert.deepEqual(h.calls.at(-1), ["visible", true, undefined]);
	h.search.destoryAll();
});

test("native preference is preserved and unsupported environments notify before falling back", () => {
	const h = environment();
	h.plugin.settings.useObsidianSearchInRead = true;
	h.commands.get("text-finder-show-find").checkCallback(false);
	assert.deepEqual(h.calls, [["native"]]);
	assert.equal(h.notices.length, 0);
	h.plugin.settings.useObsidianSearchInRead = false;
	delete h.dom.window.Highlight;
	h.commands.get("text-finder-show-find").checkCallback(false);
	assert.deepEqual(h.calls.at(-1), ["native"]);
	assert.equal(h.created(), 0);
	assert.deepEqual(h.notices, ["search.ReadingUnsupported"]);
	h.search.destoryAll();
});

test("ToggleFind uses the same native fallback and closes an already-open plugin Finder", () => {
	const h = environment();
	h.plugin.settings.useObsidianSearchInRead = true;
	h.commands.get("text-finder-toggle-find").checkCallback(false);
	assert.deepEqual(h.calls, [["native"]]);
	h.search.finderViews.set(h.view, { isVisible: () => true, setVisible: (value) => h.calls.push(["visible", value]) });
	h.commands.get("text-finder-toggle-find").checkCallback(false);
	assert.deepEqual(h.calls.at(-1), ["visible", false]);
	h.search.finderViews.clear();
	h.search.destoryAll();
});

for (const [id, action] of [
	["text-finder-hide-find", ["visible", false]], ["text-finder-toggle-find", ["visible", true, undefined]],
	["text-finder-next-match", ["next"]], ["text-finder-previous-match", ["previous"]],
]) {
	test(`${id} works in reading mode, with no mutation during availability checks`, () => {
		const h = environment();
		const command = h.commands.get(id);
		assert.equal(command.checkCallback(true), true);
		assert.equal(h.created(), 0);
		command.checkCallback(false);
		assert.deepEqual(h.calls, [action]);
		h.close();
		assert.equal(command.checkCallback(false), false);
		assert.equal(h.calls.length, 1);
		h.search.destoryAll();
	});
}

test("reading replace and replace-all command callbacks never resolve an editable Finder", () => {
	const h = environment();
	for (const id of ["text-finder-replace", "text-finder-replace-all", "text-finder-show-find-and-replace", "text-finder-toggle-replace"]) {
		h.commands.get(id).editorCallback(h.view.editor, h.view);
	}
	assert.equal(h.created(), 0);
	assert.equal(h.calls.length, 0);
	h.search.destoryAll();
});

test("closing a reading leaf destroys its search, finder and cache references", () => {
	const h = environment();
	h.search.finderViews.set(h.view, { $destroy: () => h.calls.push(["destroy"]) });
	h.search.finderCache.set("owner", h.search.finderViews.get(h.view));
	const adapter = h.search.getReadingSearch(h.view);
	adapter.search("world", { regexMode: false, caseSensitive: false }, 0, false, () => {});
	assert.equal(h.dom.window.CSS.highlights.has("nya-reading-matches"), true);
	h.close();
	h.events.get("layout-change")();
	assert.deepEqual(h.calls, [["destroy"]]);
	assert.equal(h.search.finderCache.size, 0);
	assert.equal(h.search.finderViews.size, 0);
	assert.equal(h.search.readingSearches.size, 0);
	assert.equal(h.dom.window.CSS.highlights.has("nya-reading-matches"), false);
	h.search.destoryAll();
});

test("view-scoped Escape listener is removed when its leaf closes", () => {
	const h = environment();
	h.view.containerEl = h.root;
	let escapes = 0;
	const finder = { closeFinder: () => escapes++, $destroy() {} };
	h.search.registerFinderEvent(h.view, finder);
	h.search.finderViews.set(h.view, finder);
	h.root.dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Escape" }));
	assert.equal(escapes, 1);
	h.close(); h.events.get("layout-change")();
	h.root.dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Escape" }));
	assert.equal(escapes, 1);
	assert.equal(h.search.finderEvents.size, 0);
	h.search.destoryAll();
});

test("theme changes invalidate only existing reading adapters without creating finders", () => {
	const h = environment();
	let invalidations = 0;
	h.search.readingSearches.set(h.view, { invalidate: () => invalidations++, destroy() {} });
	h.events.get("css-change")();
	assert.equal(invalidations, 1);
	assert.equal(h.created(), 0);
	h.search.destoryAll();
});

test("native fallback closes the plugin finder and remains bound to its open owner", () => {
	const h = environment();
	h.search.finderViews.set(h.view, { setVisible: (visible) => h.calls.push(["visible", visible]) });
	h.search.openNativeSearch(h.view);
	assert.deepEqual(h.calls, [["visible", false], ["native"]]);
	h.close(); h.search.openNativeSearch(h.view);
	assert.equal(h.calls.length, 2);
	h.search.finderViews.clear(); h.search.destoryAll();
});
