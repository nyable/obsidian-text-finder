import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { JSDOM } from "jsdom";
import { EditorSearch, editorExtensionProvider } from "../../src/app/workspace-runtime";
import { MarkdownView, Notice } from "../support/obsidian-host.mjs";
vi.mock("../../src/i18n", () => ({ i18n: { t: (key) => key } }));

function environment() {
	const dom = new JSDOM("<!doctype html><html><body></body></html>");
	dom.window.CSS = { highlights: new Map() };
	dom.window.Highlight = class extends Set {
		priority = 0;
	};
	const root = dom.window.document.createElement("div");
	root.innerHTML = "<p>hello <strong>world</strong></p>";
	dom.window.document.body.append(root);
	const view = new MarkdownView();
	view.file = { path: "a.md" };
	view.getMode = () => "preview";
	view.editor = {};
	view.previewMode = {
		containerEl: root,
		renderer: {
			sections: [{ el: root.firstChild, rendered: true }],
			text: "md",
			lastText: "md",
			parsing: false,
			rendered: null,
			previewEl: root,
			showSection() {},
			applyScrollSection() {
				return true;
			},
			updateVirtualDisplay() {},
			onRendered() {},
		},
	};
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
		destroy: () => calls.push(["destroy"]),
	};
	let open = true;
	const plugin = {
		settings: { useSelectionAsSearch: true },
		app: {
			workspace: {
				getActiveViewOfType: () => view,
				iterateAllLeaves: (callback) => {
					if (open) callback({ view });
				},
				on: (name, callback) => events.set(name, callback),
			},
		},
		registerEvent() {},
		addCommand: (command) => commands.set(command.id, command),
	};
	vi.spyOn(Notice, "notify").mockImplementation((text) => notices.push(text));
	const search = new EditorSearch(plugin);
	// This suite checks command routing, not Worker dispatch (covered separately).
	search.createMatchEngine = () => undefined;
	let created = 0;
	search.getFinder = (owner) => {
		assert.equal(owner, view);
		created++;
		return finder;
	};
	return {
		dom,
		root,
		view,
		plugin,
		commands,
		events,
		calls,
		notices,
		search,
		created: () => created,
		close: () => {
			open = false;
		},
	};
}

test("reading ShowFind checks without side effects and opens the plugin without native search", () => {
	const h = environment();
	const command = h.commands.get("text-finder-show-find");
	assert.equal(command.checkCallback(true), true);
	assert.equal(h.created(), 0);
	command.checkCallback(false);
	assert.deepEqual(h.calls, [["visible", true, undefined]]);
	assert.equal(h.notices.length, 0);
	h.search.dispose();
});

test("preset commands preserve IDs, do not create a Finder during availability checks, and capture the exact owner", () => {
	const h = environment();
	const save = h.commands.get("text-finder-save-preset");
	assert.equal(save.checkCallback(true), true);
	assert.equal(h.created(), 0);
	const recipe = {
		search: "exact",
		options: { regexMode: false, caseSensitive: true, wholeWord: false },
		replacement: null,
	};
	const finder = h.search.getFinder(h.view);
	finder.captureRecipe = () => recipe;
	const opened = [];
	h.search.openHistory = (...args) => opened.push(args);
	save.checkCallback(false);
	assert.deepEqual(opened[0], ["presets", recipe]);
	h.commands.get("text-finder-apply-preset").callback();
	assert.deepEqual(opened[1], ["presets"]);
	h.close();
	assert.equal(save.checkCallback(true), false);
	h.search.dispose();
});

test("reset-position command operates on an existing owner only and sets no default shortcut", () => {
	const h = environment(),
		command = h.commands.get("text-finder-reset-position");
	assert.equal(command.checkCallback(true), true);
	assert.equal(h.created(), 0);
	assert.equal(command.hotkeys, undefined);
	const finder = h.search.getFinder(h.view);
	h.calls.length = 0;
	h.search.owners.ensure(h.view).finder = finder;
	command.checkCallback(false);
	assert.deepEqual(h.calls, [["reset-position"]]);
	h.close();
	assert.equal(command.checkCallback(true), false);
	h.search.dispose();
});

test("reading selection comes from the owning preview document and ignores outside selections", () => {
	const h = environment();
	const selection = h.dom.window.getSelection();
	const range = h.dom.window.document.createRange();
	range.selectNodeContents(h.root.querySelector("strong"));
	selection.addRange(range);
	h.commands.get("text-finder-show-find").checkCallback(false);
	assert.deepEqual(h.calls.at(-1), ["visible", true, "world"]);
	const outside = h.dom.window.document.createElement("p");
	outside.textContent = "outside";
	h.dom.window.document.body.append(outside);
	range.selectNodeContents(outside);
	selection.removeAllRanges();
	selection.addRange(range);
	h.commands.get("text-finder-show-find").checkCallback(false);
	assert.deepEqual(h.calls.at(-1), ["visible", true, undefined]);
	h.search.dispose();
});

test("retired native preference is ignored and unsupported environments still notify before falling back", () => {
	const h = environment();
	h.plugin.settings.useObsidianSearchInRead = true;
	h.commands.get("text-finder-show-find").checkCallback(false);
	assert.deepEqual(h.calls, [["visible", true, undefined]]);
	assert.equal(h.notices.length, 0);
	delete h.dom.window.Highlight;
	h.commands.get("text-finder-show-find").checkCallback(false);
	assert.deepEqual(h.calls.at(-1), ["native"]);
	assert.equal(h.created(), 1);
	assert.deepEqual(h.notices, ["search.ReadingUnsupported"]);
	h.search.dispose();
});

test("ToggleFind uses the same native fallback and closes an already-open plugin Finder", () => {
	const h = environment();
	delete h.dom.window.Highlight;
	h.commands.get("text-finder-toggle-find").checkCallback(false);
	assert.deepEqual(h.calls, [["native"]]);
	h.search.owners.ensure(h.view).finder = {
		isVisible: () => true,
		isDocked: () => false,
		closeFinder: () => h.calls.push(["close"]),
	};
	h.commands.get("text-finder-toggle-find").checkCallback(false);
	assert.deepEqual(h.calls.at(-1), ["close"]);
	delete h.search.owners.get(h.view).finder;
	h.search.dispose();
});

test("find commands expand a compact Finder instead of closing it or replacing its stored query", () => {
	const h = environment();
	const finder = {
		isVisible: () => true,
		isDocked: () => true,
		setVisible: (...args) => h.calls.push(["visible", ...args]),
		closeFinder: () => h.calls.push(["close"]),
		destroy() {},
	};
	h.search.owners.ensure(h.view).finder = finder;
	h.search.getFinder = () => finder;
	const selection = h.dom.window.getSelection(),
		range = h.dom.window.document.createRange();
	range.selectNodeContents(h.root.querySelector("strong"));
	selection.addRange(range);
	for (const id of ["text-finder-toggle-find", "text-finder-show-find"]) {
		const command = h.commands.get(id);
		command.checkCallback(true);
		assert.equal(h.calls.length, id.endsWith("toggle-find") ? 0 : 1);
		command.checkCallback(false);
	}
	assert.deepEqual(h.calls, [
		["visible", true, undefined],
		["visible", true, undefined],
	]);
	delete h.dom.window.Highlight;
	h.commands.get("text-finder-toggle-find").checkCallback(false);
	assert.deepEqual(h.calls.slice(-2), [["visible", false], ["native"]]);
	h.search.dispose();
});

test("automatic entry activation ignores retired preference and keeps unsupported fallback and owner validity", () => {
	const h = environment();
	assert.equal(h.search.activateFloatingFinder(h.view), true);
	assert.equal(h.calls.length, 0);
	h.plugin.settings.useObsidianSearchInRead = true;
	assert.equal(h.search.activateFloatingFinder(h.view), true);
	assert.equal(h.calls.length, 0);
	delete h.dom.window.Highlight;
	assert.equal(h.search.activateFloatingFinder(h.view), false);
	assert.equal(h.notices.length, 1);
	h.close();
	const count = h.calls.length;
	assert.equal(h.search.activateFloatingFinder(h.view), false);
	assert.equal(h.calls.length, count);
	h.search.dispose();
});

for (const [id, action] of [
	["text-finder-hide-find", ["close"]],
	["text-finder-toggle-find", ["visible", true, undefined]],
	["text-finder-next-match", ["next"]],
	["text-finder-previous-match", ["previous"]],
]) {
	test(`${id} works in reading mode, with no mutation during availability checks`, () => {
		const h = environment();
		const command = h.commands.get(id);
		assert.equal(command.checkCallback(true), true);
		assert.equal(h.created(), 0);
		if (id === "text-finder-hide-find")
			h.search.owners.ensure(h.view).finder = {
				closeFinder: () => h.calls.push(["close"]),
				destroy() {},
			};
		command.checkCallback(false);
		assert.deepEqual(h.calls, [action]);
		h.close();
		assert.equal(command.checkCallback(false), false);
		assert.equal(h.calls.length, 1);
		h.search.dispose();
	});
}

test("reading replace and replace-all command callbacks never resolve an editable Finder", () => {
	const h = environment();
	for (const id of [
		"text-finder-replace",
		"text-finder-replace-all",
		"text-finder-show-find-and-replace",
		"text-finder-toggle-replace",
	]) {
		h.commands.get(id).editorCallback(h.view.editor, h.view);
	}
	assert.equal(h.created(), 0);
	assert.equal(h.calls.length, 0);
	h.search.dispose();
});

test("reading selection command is available without creating Finder during checks and never invokes native full search", () => {
	const h = environment();
	let scoped = 0;
	const finder = h.search.getFinder(h.view);
	finder.findInSelection = () => {
		scoped++;
	};
	const command = h.commands.get("text-finder-find-in-selection"),
		before = h.created();
	assert.equal(command.checkCallback(true), true);
	assert.equal(h.created(), before);
	delete h.dom.window.Highlight;
	command.checkCallback(false);
	assert.equal(scoped, 1);
	assert.equal(h.calls.length, 0);
	h.search.dispose();
});

test("ordinary open commands preserve a scoped session query instead of seeding from the current match", () => {
	const h = environment();
	h.view.getMode = () => "source";
	h.view.editor.cm = { state: { doc: {} } };
	h.view.editor.getSelection = () => "selected match";
	const finder = h.search.getFinder(h.view);
	finder.hasSelectionScope = () => true;
	finder.showReplace = (...args) => h.calls.push(["replace-ui", ...args]);
	h.commands.get("text-finder-show-find").checkCallback(false);
	h.commands.get("text-finder-show-find-and-replace").editorCallback(h.view.editor, h.view);
	assert.deepEqual(h.calls, [
		["visible", true, undefined],
		["replace-ui", undefined],
	]);
	h.search.dispose();
});

test("closing a reading leaf destroys its search, finder and cache references", () => {
	const h = environment();
	h.search.owners.ensure(h.view).finder = { destroy: () => h.calls.push(["destroy"]) };
	const adapter = h.search.getReadingSearch(h.view);
	adapter.search("world", { regexMode: false, caseSensitive: false }, 0, false, () => {});
	assert.equal(h.dom.window.CSS.highlights.has("nya-reading-matches"), true);
	h.close();
	h.events.get("layout-change")();
	assert.deepEqual(h.calls, [["destroy"]]);
	assert.equal([...h.search.owners.entries()].length, 0);
	assert.equal(h.dom.window.CSS.highlights.has("nya-reading-matches"), false);
	h.search.dispose();
});

test("view-scoped Escape listener is removed when its leaf closes", () => {
	const h = environment();
	h.view.containerEl = h.root;
	let escapes = 0;
	const finder = { isVisible: () => true, closeFinder: () => escapes++, destroy() {} };
	h.search.registerFinderEvent(h.view, finder);
	h.search.owners.ensure(h.view).finder = finder;
	h.root.dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Escape" }));
	assert.equal(escapes, 1);
	h.close();
	h.events.get("layout-change")();
	h.root.dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Escape" }));
	assert.equal(escapes, 1);
	assert.equal(h.search.owners.get(h.view), undefined);
	h.search.dispose();
});

test("theme changes invalidate only existing reading adapters without creating finders", () => {
	const h = environment();
	let invalidations = 0;
	h.search.owners.ensure(h.view).reading = { invalidate: () => invalidations++, destroy() {} };
	h.events.get("css-change")();
	assert.equal(invalidations, 1);
	assert.equal(h.created(), 0);
	h.search.dispose();
});

test("native fallback closes the plugin finder and remains bound to its open owner", () => {
	const h = environment();
	h.search.owners.ensure(h.view).finder = {
		setVisible: (visible) => h.calls.push(["visible", visible]),
	};
	h.search.openNativeSearch(h.view);
	assert.deepEqual(h.calls, [["visible", false], ["native"]]);
	h.close();
	h.search.openNativeSearch(h.view);
	assert.equal(h.calls.length, 2);
	delete h.search.owners.get(h.view).finder;
	h.search.dispose();
});

test("hidden, modified and consumed Escape events never close Finder", () => {
	const h = environment();
	h.view.containerEl = h.root;
	let visible = false;
	let closes = 0;
	h.search.registerFinderEvent(h.view, { isVisible: () => visible, closeFinder: () => closes++ });
	const key = (options = {}) =>
		h.root.dispatchEvent(
			new h.dom.window.KeyboardEvent("keydown", {
				key: "Escape",
				cancelable: true,
				...options,
			}),
		);
	key();
	assert.equal(closes, 0);
	visible = true;
	key({ metaKey: true });
	key({ isComposing: true });
	assert.equal(closes, 0);
	const consumed = new h.dom.window.KeyboardEvent("keydown", { key: "Escape", cancelable: true });
	consumed.preventDefault();
	h.root.dispatchEvent(consumed);
	assert.equal(closes, 0);
	key();
	assert.equal(closes, 1);
	h.search.dispose();
});

test("late layout callbacks do not initialize unloaded plugins and initialization is idempotent", () => {
	let callback;
	let unloaded = false;
	let commands = 0;
	let extensions = 0;
	const plugin = {
		editorSearch: null,
		isUnloaded: () => unloaded,
		app: {
			workspace: {
				onLayoutReady: (fn) => {
					callback = fn;
				},
				on() {},
				iterateAllLeaves() {},
			},
		},
		registerEvent() {},
		addCommand() {
			commands++;
		},
		registerEditorExtension() {
			extensions++;
		},
	};
	editorExtensionProvider(plugin);
	unloaded = true;
	callback();
	assert.equal(plugin.editorSearch, null);
	assert.equal(commands, 0);
	unloaded = false;
	callback();
	callback();
	assert.equal(commands, 14);
	assert.equal(extensions, 1);
	plugin.editorSearch.dispose();
});

test("unload closes tracked history modals exactly once", () => {
	const h = environment();
	let closes = 0;
	h.search.historyModals.add({ close: () => closes++ });
	h.search.dispose();
	h.search.dispose();
	assert.equal(closes, 1);
	assert.equal(h.search.historyModals.size, 0);
});

test("unload releases every owner even when menu and modal cleanup throw", () => {
	const h = environment(),
		releases = [];
	h.search.openMenus.add({
		hide() {
			releases.push("menu");
			throw new Error("menu cleanup");
		},
	});
	h.search.historyModals.add({
		close() {
			releases.push("modal");
			throw new Error("modal cleanup");
		},
	});
	h.search.owners.ensure(h.view).finder = {
		destroy() {
			releases.push("finder");
		},
	};
	assert.throws(() => h.search.dispose(), AggregateError);
	assert.deepEqual(releases, ["menu", "modal", "finder"]);
	assert.equal(h.search.openMenus.size, 0);
	assert.equal(h.search.historyModals.size, 0);
	assert.equal(h.search.owners.get(h.view), undefined);
	h.search.dispose();
	assert.equal(releases.length, 3);
});
