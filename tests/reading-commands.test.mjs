import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";
import { matchEngineSource } from "./match-engine-source.mjs";

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
		isDocked: () => false,
		closeFinder: () => calls.push(["close"]),
		setVisible: (...args) => calls.push(["visible", ...args]),
		toggleVisible: () => calls.push(["toggle"]),
		toNextMatch: () => calls.push(["next"]),
		toPreviousMatch: () => calls.push(["previous"]),
		matchAgain: () => calls.push(["refresh"]),
		resetFinderPosition: () => calls.push(["reset-position"]),
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
		"./match-engine": matchEngineSource,
		"./search-highlight": {}, "./SearchBox.svelte": {}, "./reading-search": readingSource,
		obsidian: { MarkdownView, Notice: class { constructor(text) { notices.push(text); } } },
		"./i18n": { i18n: { t: (key) => key } }, "./util/common-helper": {}, "./HistoryModal": {},
	});
	const search = new EditorSearch(plugin);
	// This suite checks command routing, not Worker dispatch (covered separately).
	search.createMatchEngine = () => undefined;
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

test("reset-position command operates on an existing owner only and sets no default shortcut", () => {
	const h = environment(), command = h.commands.get("text-finder-reset-position");
	assert.equal(command.checkCallback(true), true); assert.equal(h.created(), 0); assert.equal(command.hotkeys, undefined);
	const finder = h.search.getFinder(h.view); h.calls.length = 0; h.search.finderViews.set(h.view, finder);
	command.checkCallback(false); assert.deepEqual(h.calls, [["reset-position"]]);
	h.close(); assert.equal(command.checkCallback(true), false); h.search.destoryAll();
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
	h.search.finderViews.set(h.view, { isVisible: () => true, isDocked: () => false, closeFinder: () => h.calls.push(["close"]) });
	h.commands.get("text-finder-toggle-find").checkCallback(false);
	assert.deepEqual(h.calls.at(-1), ["close"]);
	h.search.finderViews.clear();
	h.search.destoryAll();
});

test("find commands expand a compact Finder instead of closing it or replacing its stored query", () => {
	const h = environment();
	const finder = { isVisible: () => true, isDocked: () => true,
		setVisible: (...args) => h.calls.push(["visible", ...args]), closeFinder: () => h.calls.push(["close"]), $destroy() {} };
	h.search.finderViews.set(h.view, finder); h.search.getFinder = () => finder;
	const selection = h.dom.window.getSelection(), range = h.dom.window.document.createRange();
	range.selectNodeContents(h.root.querySelector("strong")); selection.addRange(range);
	for (const id of ["text-finder-toggle-find", "text-finder-show-find"]) {
		const command = h.commands.get(id);
		command.checkCallback(true); assert.equal(h.calls.length, id.endsWith("toggle-find") ? 0 : 1);
		command.checkCallback(false);
	}
	assert.deepEqual(h.calls, [["visible", true, undefined], ["visible", true, undefined]]);
	h.plugin.settings.useObsidianSearchInRead = true;
	h.commands.get("text-finder-toggle-find").checkCallback(false);
	assert.deepEqual(h.calls.slice(-2), [["visible", false], ["native"]]);
	h.search.destoryAll();
});

test("automatic entry activation shares native preference, unsupported fallback and owner validity", () => {
	const h = environment();
	assert.equal(h.search.activateFloatingFinder(h.view), true); assert.equal(h.calls.length, 0);
	h.plugin.settings.useObsidianSearchInRead = true;
	assert.equal(h.search.activateFloatingFinder(h.view), false); assert.deepEqual(h.calls, [["native"]]);
	h.plugin.settings.useObsidianSearchInRead = false; delete h.dom.window.Highlight;
	assert.equal(h.search.activateFloatingFinder(h.view), false); assert.equal(h.notices.length, 1);
	h.close(); const count = h.calls.length;
	assert.equal(h.search.activateFloatingFinder(h.view), false); assert.equal(h.calls.length, count);
	h.search.destoryAll();
});

for (const [id, action] of [
	["text-finder-hide-find", ["close"]], ["text-finder-toggle-find", ["visible", true, undefined]],
	["text-finder-next-match", ["next"]], ["text-finder-previous-match", ["previous"]],
]) {
	test(`${id} works in reading mode, with no mutation during availability checks`, () => {
		const h = environment();
		const command = h.commands.get(id);
		assert.equal(command.checkCallback(true), true);
		assert.equal(h.created(), 0);
		if (id === "text-finder-hide-find") h.search.finderViews.set(h.view, { closeFinder: () => h.calls.push(["close"]), $destroy() {} });
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
	for (const id of ["text-finder-replace", "text-finder-replace-all", "text-finder-show-find-and-replace", "text-finder-toggle-replace", "text-finder-find-in-selection"]) {
		h.commands.get(id).editorCallback(h.view.editor, h.view);
	}
	assert.equal(h.created(), 0);
	assert.equal(h.calls.length, 0);
	h.search.destoryAll();
});

test("ordinary open commands preserve a scoped session query instead of seeding from the current match", () => {
	const h = environment(); h.view.getMode = () => "source";
	h.view.editor.cm = { state: { doc: {} } }; h.view.editor.getSelection = () => "selected match";
	const finder = h.search.getFinder(h.view); finder.hasSelectionScope = () => true;
	finder.showReplace = (...args) => h.calls.push(["replace-ui", ...args]);
	h.commands.get("text-finder-show-find").checkCallback(false);
	h.commands.get("text-finder-show-find-and-replace").editorCallback(h.view.editor, h.view);
	assert.deepEqual(h.calls, [["visible", true, undefined], ["replace-ui", undefined]]);
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
	const finder = { isVisible: () => true, closeFinder: () => escapes++, $destroy() {} };
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

test("hidden, modified and consumed Escape events never close Finder", () => {
	const h = environment(); h.view.containerEl = h.root;
	let visible = false; let closes = 0;
	h.search.registerFinderEvent(h.view, { isVisible: () => visible, closeFinder: () => closes++ });
	const key = (options = {}) => h.root.dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Escape", cancelable: true, ...options }));
	key(); assert.equal(closes, 0);
	visible = true;
	key({ metaKey: true }); key({ isComposing: true }); assert.equal(closes, 0);
	const consumed = new h.dom.window.KeyboardEvent("keydown", { key: "Escape", cancelable: true });
	consumed.preventDefault(); h.root.dispatchEvent(consumed); assert.equal(closes, 0);
	key(); assert.equal(closes, 1); h.search.destoryAll();
});

test("late layout callbacks do not initialize unloaded plugins and initialization is idempotent", () => {
	let callback; let unloaded = false; let commands = 0; let extensions = 0;
	const plugin = { editorSearch: null, isUnloaded: () => unloaded,
		app: { workspace: { onLayoutReady: (fn) => { callback = fn; }, on() {} } },
		registerEvent() {}, addCommand() { commands++; }, registerEditorExtension() { extensions++; } };
	const { editorExtensionProvider } = loadSource("../src/editor-extension.ts", {
		"./match-engine": matchEngineSource,
		"./search-highlight": {}, "./SearchBox.svelte": {}, "./reading-search": {}, obsidian: {},
		"./i18n": { i18n: { t: (key) => key } }, "./util/common-helper": {}, "./HistoryModal": {},
	});
	editorExtensionProvider(plugin); unloaded = true; callback();
	assert.equal(plugin.editorSearch, null); assert.equal(commands, 0);
	unloaded = false; callback(); callback();
	assert.equal(commands, 12); assert.equal(extensions, 1); plugin.editorSearch.destoryAll();
});

test("unload closes tracked history modals exactly once", () => {
	const h = environment(); let closes = 0;
	h.search.historyModals.add({ close: () => closes++ });
	h.search.destoryAll(); h.search.destoryAll();
	assert.equal(closes, 1); assert.equal(h.search.historyModals.size, 0);
});
