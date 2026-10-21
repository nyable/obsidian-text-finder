// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, vi, onTestFinished } from "vitest";
import { EditorState } from "@codemirror/state";
import * as stateModule from "@codemirror/state";
import { compileString } from "sass";
import { JSDOM } from "jsdom";
import { HistoryController } from "../../src/features/history";
import * as toolbarSource from "../../src/features/finder/model/toolbar";
import * as helper from "../../src/core/search/text-matching";
import { ReadingSearch } from "../../src/features/reading/dom/reading-search";
import { EditorSearch } from "../../src/app/workspace-runtime";
import { MatchEngine } from "../../src/platform/browser/match-engine";
import { searchScopeField } from "../../src/platform/codemirror/search-scope";
import { Platform, Menu } from "../support/obsidian-host.mjs";
import { mountFinder } from "../../src/features/finder/ui/mount-finder";
import { createFinderHost } from "../../src/app/create-finder-host";
import { synchronousMatcher } from "../support/synchronous-matcher";
import { createFinderEditor } from "../../src/platform/codemirror/finder-editor";
import { nextTick as tick } from "vue";
import { installWorkerHost } from "../match-worker-host.mjs";
import { componentStyles as compileStyles } from "../support/component-styles.mjs";
import FinderPanel from "../../src/features/finder/ui/FinderPanel.vue";
import FinderToolbar from "../../src/features/finder/ui/FinderToolbar.vue";
import SearchStatus from "../../src/features/finder/ui/SearchStatus.vue";

vi.mock("../../src/i18n", () => ({ i18n: { t: (key) => key } }));
vi.mock("../../src/platform/codemirror/search-highlight", async (importOriginal) => ({
	...(await importOriginal()),
	searchCacheEffect: { of: (value) => value },
}));
const attachHistory = (plugin) => {
	plugin.history = new HistoryController(
		() => plugin.settings,
		async () => {
			try {
				await plugin.saveSettings();
			} catch (error) {
				console.error("Text Finder: failed to save search history", error);
				throw error;
			}
		},
	);
};
const componentStyles = (
	await Promise.all(
		[
			["FinderPanel", FinderPanel],
			["FinderToolbar", FinderToolbar],
			["SearchStatus", SearchStatus],
		].map(([name, component]) =>
			compileStyles(`src/features/finder/ui/${name}.vue`, component.__scopeId),
		),
	)
).flat();

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const style = dom.window.document.createElement("style");
// Simulate host mobile textarea metrics before the plugin styles. jsdom does
// not faithfully resolve specificity between separately injected stylesheets.
style.textContent =
	"body.is-mobile textarea { padding: 12px 10px; line-height: 32px; min-height: 52px; height: 52px; box-sizing: content-box; }\n" +
	componentStyles.join("\n");
dom.window.document.head.append(style);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Element = dom.window.Element;
globalThis.SVGElement = dom.window.SVGElement;

function createPanel(target, owner, host, cid) {
	return mountFinder(target, {
		owner: owner.containerEl ?? target,
		host: createFinderHost(host, owner),
		cid,
		editor: createFinderEditor(
			() => host.getEditorContext(owner),
			() => host.plugin.app?.vault,
			() => owner.file ?? null,
		),
	});
}

function mount(_t, matcher, settings = {}, open = true) {
	const target = document.createElement("div");
	document.body.append(target);
	const scrolls = [];
	const specs = [];
	let saves = 0;
	let resolve;
	const pending = new Promise((done) => {
		resolve = done;
	});
	const view = {
		file: { path: "a.md" },
		getState: () => ({ mode: "source", source: true }),
		setState: () => {},
	};
	const editor = {
		getValue: () => editor.cm.state.doc.toString(),
		offsetToPos: (offset) => offset,
		scrollIntoView: (range) => scrolls.push(range),
		cm: {
			state: EditorState.create({ doc: "cat cat", extensions: [searchScopeField] }),
			dispatch(spec) {
				specs.push(spec);
				this.state =
					spec instanceof stateModule.Transaction
						? spec.state
						: this.state.update({
								changes: spec.changes,
								selection: spec.selection,
								annotations: spec.annotations,
								effects:
									spec.effects instanceof stateModule.StateEffect
										? spec.effects
										: undefined,
							}).state;
			},
		},
	};
	view.editor = editor;
	view.containerEl = target;
	const plugin = {
		settings: {
			enableInputHotkeys: true,
			enableHistory: true,
			historyMaxCount: 10,
			searchHistory: [],
			moveCursorToMatch: true,
			...settings,
		},
		reportError() {},
		saveSettings: () => {
			saves++;
			return pending;
		},
	};
	attachHistory(plugin);
	const editorSearch = {
		plugin,
		getMatchEngine: () => matcher ?? synchronousMatcher(),
		getReadingSelection: () => null,
		clearReadingSearch() {},
		activateFloatingFinder: () => true,
		getEditorContext: (owner) => {
			assert.equal(owner, view);
			return {
				view,
				editor,
				editorView: editor.cm,
				file: view.file,
				doc: editor.cm.state.doc,
			};
		},
	};
	const component = createPanel(target, view, editorSearch, "a");
	onTestFinished(() => {
		component.destroy();
		target.remove();
		resolve();
	});
	if (open) component.setVisible(true, "cat");
	scrolls.length = 0;
	return {
		component,
		target,
		scrolls,
		specs,
		plugin,
		view,
		editorSearch,
		resolve,
		saves: () => saves,
	};
}

const deferred = () => {
	let resolve, reject;
	const promise = new Promise((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
};
const settlePosition = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
	await tick();
};

for (const replacement of ["dog", "cat"]) {
	test(`filtered replacement ${replacement} does not claim a commit or navigate in the real Finder`, async () => {
		const h = mount();
		const cm = h.view.editor.cm;
		cm.state = EditorState.create({
			doc: "cat cat",
			extensions: [
				searchScopeField,
				EditorState.transactionFilter.of((tr) => (tr.docChanged ? [] : tr)),
			],
		});
		h.component.matchAgain(false);
		h.scrolls.length = 0;
		const result = await h.component.replaceMatchedText(replacement);
		await settlePosition();
		assert.equal(result.changed, false);
		assert.equal(result.changeCount, 0);
		assert.equal(result.status, "failed");
		assert.equal(cm.state.doc.toString(), "cat cat");
		assert.deepEqual(h.scrolls, []);
		assert.equal(h.component.getSearchCache().index, 0);
	});
}

function selectScope(h, ranges, source) {
	const cm = h.view.editor.cm;
	if (source !== undefined)
		cm.state = EditorState.create({
			doc: source,
			extensions: [searchScopeField, EditorState.allowMultipleSelections.of(true)],
		});
	cm.dispatch({
		selection: stateModule.EditorSelection.create(
			ranges.map(({ from, to }) => stateModule.EditorSelection.range(from, to)),
		),
	});
}

function setReplacement(h, value) {
	const input = h.target.querySelector(".replacer textarea");
	assert.ok(input, "replacement input must be mounted");
	input.value = value;
	input.dispatchEvent(new input.ownerDocument.defaultView.Event("input", { bubbles: true }));
}

test("preset application preserves exact scope, does not write, and follows global escape settings", async (t) => {
	const h = mount(t, undefined, { useEscapeCharInReplace: true });
	await tick();
	selectScope(h, [{ from: 4, to: 7 }]);
	h.component.findInSelection();
	const recipe = {
		search: "cat",
		options: { regexMode: true, caseSensitive: true, wholeWord: false },
		replacement: { text: "\\n", interpretEscapes: false },
	};
	assert.equal(h.component.applyRecipe(recipe), true);
	await tick();
	assert.equal(h.view.editor.getValue(), "cat cat");
	assert.equal(h.component.hasSelectionScope(), true);
	assert.deepEqual(h.component.getSearchCache().matches, [{ from: 4, to: 7, index: 0 }]);
	assert.deepEqual(h.component.captureRecipe(), {
		...recipe,
		collapse: false,
		replacement: { text: "\\n", interpretEscapes: true },
	});
	assert.equal(h.plugin.settings.useEscapeCharInReplace, true);
	h.component.replaceAllMatchedText("\\n");
	assert.equal(h.view.editor.getValue(), "cat \n");
});

test("selection command preserves query, locks exact multiline characters and navigation cannot shrink scope", async (t) => {
	const h = mount(t);
	await tick();
	selectScope(h, [{ from: 6, to: 13 }], "cat A cat\ncat B cat");
	assert.equal(h.component.findInSelection(), true);
	await tick();
	assert.equal(h.component.getSearchCache().search, "cat");
	assert.deepEqual(
		h.component.getSearchCache().matches.map(({ from, to }) => [from, to]),
		[
			[6, 9],
			[10, 13],
		],
	);
	h.component.toNextMatch();
	h.component.toNextMatch();
	await settlePosition();
	assert.deepEqual(h.view.editor.cm.state.field(searchScopeField).ranges, [{ from: 6, to: 13 }]);
	assert.equal(h.target.querySelector(".nya-scope-status"), null);
	assert.ok(h.target.querySelector('[aria-label="search.tip.More"] .nya-toolbar-indicator'));
	setReplacement(h, "dog");
	h.component.replaceAllMatchedText("dog");
	assert.equal(h.view.editor.getValue(), "cat A dog\ndog B cat");
});

test("toolbar captures original selection after navigation and hiding its action adds no counter marker", async (t) => {
	const h = mount(t, undefined, {}, false);
	await tick();
	selectScope(h, [{ from: 4, to: 7 }]);
	h.component.setVisible(true, "cat");
	await settlePosition();
	assert.equal(h.view.editor.cm.state.selection.main.from, 0);
	h.target.querySelector('[aria-label="search.tip.More"]').click();
	await tick();
	const toggle = h.target.querySelector('[data-overflow-action="selection"]');
	assert.equal(toggle.getAttribute("aria-label"), "search.tip.FindInSelection");
	toggle.click();
	await tick();
	assert.equal(toggle.getAttribute("aria-pressed"), "true");
	assert.deepEqual(h.component.getSearchCache().matches, [{ from: 4, to: 7, index: 0 }]);
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => (item.id === "selection" ? { ...item, placement: "hidden" } : item));
	h.component.refreshToolbar();
	await tick();
	assert.equal(h.target.querySelector(".nya-scope-status"), null);
	assert.equal(h.target.querySelector('[aria-label="search.tip.More"]'), null);
	assert.equal(h.component.hasSelectionScope(), true);
	h.component.toggleFindInSelection();
	await tick();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(h.target.querySelector(".nya-scope-status"), null);
});

test("selection scope tracks edits and length-changing replacement, empty scope blocks all writes and undo restores anchors", async (t) => {
	const h = mount(t);
	await tick();
	selectScope(h, [{ from: 4, to: 7 }]);
	h.component.findInSelection();
	h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } });
	h.component.matchAgain(false);
	assert.deepEqual(h.component.getSearchCache().matches, [{ from: 11, to: 14, index: 0 }]);
	h.component.replaceAllMatchedText("cat!");
	assert.equal(h.view.editor.getValue(), "prefix cat cat!");
	assert.deepEqual(h.view.editor.cm.state.field(searchScopeField).ranges, [{ from: 11, to: 15 }]);
	const before = h.view.editor.cm.state,
		removed = before.update({ changes: { from: 11, to: 15 } });
	h.view.editor.cm.state = removed.state;
	h.component.matchAgain(false);
	await tick();
	h.target.querySelector('[aria-label="search.tip.More"]').click();
	await tick();
	assert.equal(
		h.target.querySelector('[data-overflow-action="selection"]').getAttribute("aria-pressed"),
		"true",
	);
	assert.equal(
		h.target.querySelector('[data-overflow-action="selection"]').getAttribute("aria-label"),
		"search.tip.FindInSelectionUnavailable",
	);
	assert.equal(h.component.getSearchCache().matches.length, 0);
	h.component.replaceAllMatchedText("dog");
	assert.equal(h.view.editor.getValue(), "prefix cat ");
	h.view.editor.cm.dispatch({ changes: removed.changes.invert(before.doc) });
	h.component.matchAgain(false);
	assert.equal(h.component.getSearchCache().matches.length, 1);
});

test("multiple nonempty selections exclude intervening text from replace all", async (t) => {
	const h = mount(t);
	await tick();
	selectScope(
		h,
		[
			{ from: 0, to: 3 },
			{ from: 8, to: 11 },
		],
		"cat cat cat",
	);
	h.component.findInSelection();
	h.component.replaceAllMatchedText("dog!");
	assert.equal(h.view.editor.getValue(), "dog! cat dog!");
	assert.deepEqual(h.view.editor.cm.state.field(searchScopeField).ranges, [
		{ from: 0, to: 4 },
		{ from: 9, to: 13 },
	]);
});

test("selection scope survives docking but close blocks hidden replacement until an explicit new session", async (t) => {
	const h = mount(t);
	await tick();
	selectScope(h, [{ from: 4, to: 7 }]);
	h.component.findInSelection();
	h.component.dockFinder();
	await tick();
	assert.equal(h.component.hasSelectionScope(), true);
	h.component.expandFinder();
	h.component.setVisible(false);
	assert.equal(h.view.editor.cm.state.field(searchScopeField).ranges, null);
	h.component.replaceAllMatchedText("dog");
	assert.equal(h.view.editor.getValue(), "cat cat");
	h.component.setVisible(true);
	h.component.replaceAllMatchedText("dog");
	assert.equal(h.view.editor.getValue(), "dog dog");
});

for (const reason of ["file", "editor", "reading", "window"]) {
	test(`selection scope invalidation (${reason}) never silently replaces entire file`, async (t) => {
		const h = mount(t);
		await tick();
		selectScope(h, [{ from: 4, to: 7 }]);
		h.component.findInSelection();
		if (reason === "file") h.view.file = { path: "new.md" };
		if (reason === "editor") h.view.editor.cm.state = EditorState.create({ doc: "cat cat" });
		if (reason === "reading") h.view.getMode = () => "preview";
		if (reason === "window") {
			const other = new JSDOM("<html><body></body></html>");
			onTestFinished(() => other.window.close());
			other.window.document.body.append(other.window.document.adoptNode(h.target));
		}
		// A replacement call alone must discover invalidation without an event.
		h.component.replaceAllMatchedText("dog");
		assert.equal(h.view.editor.getValue(), "cat cat");
	});
}

test("no selection and reading mode cannot enable scope and produce no document writes", async (t) => {
	const h = mount(t);
	await tick();
	let errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	assert.equal(h.component.findInSelection(), false);
	assert.deepEqual(errors, ["search.SelectionRequired"]);
	selectScope(h, [{ from: 4, to: 7 }]);
	h.view.getMode = () => "preview";
	assert.equal(h.component.findInSelection(), false);
	assert.equal(h.component.hasSelectionScope(), false);
});

test("real Finder enables reading scope, keeps query and More state, blocks invalid ranges and clears on close", async (t) => {
	const h = mount(t, undefined, {}, false);
	await tick();
	const root = document.createElement("div"),
		section = document.createElement("div");
	section.innerHTML = "<p>cat cat cat</p>";
	root.append(section);
	h.target.append(root);
	h.view.getMode = () => "preview";
	window.CSS ??= {};
	window.CSS.highlights = new Map();
	window.Highlight = class extends Set {
		priority = 0;
	};
	h.view.previewMode = {
		containerEl: root,
		renderer: {
			sections: [{ el: section, rendered: true }],
			text: "source",
			lastText: "source",
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
	const reading = new ReadingSearch(
		h.view,
		() => true,
		() => h.component.matchAgain(false),
	);
	onTestFinished(() => reading.destroy());
	h.editorSearch.getReadingSearch = () => reading;
	h.editorSearch.clearReadingSearch = () => reading.clear();
	h.editorSearch.canSearchReading = () => true;
	const node = section.querySelector("p").firstChild;
	h.editorSearch.getReadingSelection = () => [
		{ start: { node, offset: 4 }, end: { node, offset: 7 } },
	];
	h.component.setFindText("cat", false);
	assert.equal(h.component.findInSelection(), true);
	await tick();
	assert.equal(h.component.getSearchCache().search, "cat");
	assert.equal(h.component.getSearchCache().matches.length, 1);
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	more.click();
	await tick();
	const button = h.target.querySelector('[data-overflow-action="selection"]');
	assert.equal(button.getAttribute("aria-pressed"), "true");
	node.data = "cat dog cat";
	h.component.matchAgain(false);
	await tick();
	assert.equal(h.component.getSearchCache().matches.length, 0);
	assert.equal(button.getAttribute("aria-label"), "search.tip.FindInSelectionUnavailable");
	button.click();
	await tick();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(
		h.component.findInCapturedSelection([
			{ start: { node, offset: 0 }, end: { node, offset: 3 } },
		]),
		true,
	);
	assert.equal(reading.getScopeRanges().length, 1);
	h.component.findSelectedText("cat");
	await tick();
	assert.equal(reading.getScopeRanges(), undefined);
	assert.equal(h.component.hasSelectionScope(), false);
	assert.equal(h.component.getSearchCache().matches.length, 2);
	h.component.setVisible(false);
	assert.equal(reading.getScopeRanges(), undefined);
	assert.equal(h.view.editor.getValue(), "cat cat");
});

test("menu selected-text action clears active and blocked scope and seeds query even from a docked Finder", async (t) => {
	const h = mount(t, undefined, {}, false);
	await tick();
	selectScope(h, [{ from: 4, to: 7 }]);
	h.component.findInSelection();
	h.component.setFindText("dog", false);
	assert.equal(h.component.findSelectedText("cat"), true);
	await tick();
	assert.equal(h.component.hasSelectionScope(), false);
	assert.equal(h.view.editor.cm.state.field(searchScopeField).ranges, null);
	assert.equal(h.component.getSearchCache().search, "cat");
	assert.equal(h.component.getSearchCache().matches.length, 2);
	selectScope(h, [{ from: 0, to: 3 }]);
	h.component.findInSelection();
	h.component.setVisible(false);
	assert.equal(h.component.findSelectedText("cat"), true);
	await tick();
	assert.equal(h.component.hasSelectionScope(), false);
	assert.equal(h.component.getSearchCache().matches.length, 2);
	h.component.dockFinder();
	await tick();
	h.component.findSelectedText("cat");
	await tick();
	assert.equal(h.component.isDocked(), false);
	assert.equal(h.component.getSearchCache().search, "cat");
});

test("captured menu scope uses its exact snapshot rather than the selection left after menu focus", async (t) => {
	const h = mount(t);
	await tick();
	h.component.setFindText("cat", false);
	selectScope(h, [{ from: 0, to: 3 }]);
	assert.equal(h.component.findInCapturedSelection([{ from: 4, to: 7 }]), true);
	await tick();
	assert.equal(h.component.getSearchCache().search, "cat");
	assert.deepEqual(h.component.getSearchCache().matches, [{ from: 4, to: 7, index: 0 }]);
	assert.deepEqual(h.view.editor.cm.state.field(searchScopeField).ranges, [{ from: 4, to: 7 }]);
});

test("mobile scoped finder uses only the inline toggle to indicate and clear the scope", async (t) => {
	Platform.isMobile = true;
	document.body.classList.add("is-mobile");
	onTestFinished(() => {
		Platform.isMobile = false;
		document.body.classList.remove("is-mobile");
	});
	const h = mount(t);
	await tick();
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => (item.id === "selection" ? { ...item, placement: "inline" } : item));
	h.component.refreshToolbar();
	selectScope(h, [{ from: 4, to: 7 }]);
	h.component.findInSelection();
	await tick();
	const toggle = h.target.querySelector('[data-toolbar-action="selection"]');
	assert.equal(toggle.getAttribute("aria-pressed"), "true");
	assert.equal(h.target.querySelector(".nya-scope-status"), null);
	assert.equal(
		h.target.querySelector('.nya-float-tip [role="button"], .nya-float-tip button'),
		null,
	);
	toggle.click();
	await tick();
	assert.equal(toggle.getAttribute("aria-pressed"), "false");
	assert.equal(h.component.getSearchCache().matches.length, 2);
	h.component.setVisible(false);
	await tick();
	assert.equal(h.target.querySelector(".nya-scope-status")?.tabIndex ?? -1, -1);
});

test("production Worker honors scope for single/all replacement and mapped post-commit results", async (t) => {
	for (const all of [false, true]) {
		const host = installWorkerHost({ URL: {} }),
			engine = new MatchEngine(() => host.win);
		onTestFinished(async () => {
			engine.destroy();
			await host.dispose();
		});
		const h = mount(t, engine, {}, false);
		await tick();
		selectScope(h, [{ from: 4, to: 11 }], "cat cat cat cat");
		h.component.setFindText("cat", false);
		h.component.findInSelection();
		setReplacement(h, "cat!");
		const result = await (all
			? h.component.replaceAllMatchedText("cat!")
			: h.component.replaceOnce());
		await result.navigationCompletion;
		await tick();
		assert.equal(h.view.editor.getValue(), all ? "cat cat! cat! cat" : "cat cat! cat cat");
		assert.equal(result.changeCount, all ? 2 : 1);
		assert.equal(h.component.getSearchCache().matches.length, 2);
	}
});

test("automatic floating entry and background refreshes never search, scroll or take focus", async (t) => {
	const matcher = delayedMatcher(),
		h = mount(t, matcher, {}, false);
	await tick();
	const input = document.createElement("input");
	document.body.append(input);
	onTestFinished(() => input.remove());
	input.focus();
	h.component.setFindText("cat", false);
	matcher.requests[0].resolve(matchedCats);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	matcher.requests.length = 0;
	h.specs.length = 0;
	h.component.showFloatingEntry();
	await tick();
	assert.equal(h.component.isVisible(), true);
	assert.equal(h.component.isDocked(), true);
	assert.deepEqual(
		h.component.getSearchCache().matches,
		[],
		"idle icon never shows old file coordinates or counts",
	);
	assert.equal(document.activeElement, input);
	assert.equal(matcher.requests.length, 0);
	h.component.matchAgain(false);
	h.component.matchAgain(false);
	await tick();
	h.component.resetFinderPosition();
	await tick();
	assert.equal(h.component.isDocked(), true);
	assert.equal(matcher.requests.length, 0);
	assert.equal(h.scrolls.length, 0);
	assert.equal(h.specs.length, 0);
	h.target.querySelector(".nya-dock-expand").click();
	await tick();
	assert.equal(h.component.isDocked(), false);
	assert.equal(matcher.requests.length, 1);
	assert.notEqual(document.activeElement, h.target.querySelector("textarea"));
	matcher.requests[0].resolve(matchedCats);
	await settlePosition();
	assert.equal(h.scrolls.length, 0);
});

test("compact entry uses quiet theme surfaces, rounded interactions and unchanged accessible controls", async (t) => {
	for (const mobile of [false, true]) {
		Platform.isMobile = mobile;
		document.body.classList.toggle("is-mobile", mobile);
		onTestFinished(() => {
			Platform.isMobile = false;
			document.body.classList.remove("is-mobile");
		});
		const h = mount(t, undefined, {}, false);
		Platform.isMobile = false;
		await tick();
		h.component.showFloatingEntry();
		await tick();
		const node = h.target.querySelector(".nya-finder"),
			tab = node.querySelector(".nya-dock-tab"),
			button = tab.querySelector("button");
		const css = window.getComputedStyle(node),
			buttonCss = window.getComputedStyle(button);
		assert.equal(css.backgroundColor, "var(--background-secondary)");
		assert.equal(css.borderColor, "var(--background-modifier-border)");
		assert.equal(css.borderRadius, "8px");
		assert.equal(css.boxShadow, "none");
		assert.equal(css.width, mobile ? "40px" : "30px");
		assert.equal(css.height, mobile ? "40px" : "30px");
		assert.equal(buttonCss.color, "var(--text-normal)");
		assert.equal(window.getComputedStyle(tab).borderRadius, "inherit");
		assert.equal(buttonCss.borderRadius, "inherit");
		assert.equal(button.getAttribute("aria-label"), null);
		assert.equal(button.getAttribute("title"), null);
		assert.ok(document.getElementById(button.getAttribute("aria-labelledby"))?.textContent);
		assert.equal(button.getAttribute("aria-expanded"), "false");
	}
	// jsdom does not render theme variables or hover/focus. Check the compiled
	// rules, not visual contrast claims, and leave both themes to host acceptance.
	assert.match(
		style.textContent,
		/\.nya-dock-tab[^{}]*button[^{}]*:active[^{}]*\{[^}]*background:\s*var\(--background-modifier-active-hover,\s*var\(--background-modifier-hover\)\)/,
	);
	assert.match(
		style.textContent,
		/\.nya-dock-tab[^{}]*button[^{}]*:focus-visible[^{}]*\{[^}]*outline:\s*2px solid var\(--interactive-accent\)/,
	);
	assert.match(style.textContent, /\.nya-dock-expand[^{}]*\{[^}]*touch-action:\s*none/);
});

test("mobile automatic entry corrects post-layout edge geometry and preserves manual parking through refresh", async (t) => {
	for (const side of ["left", "right"]) {
		Platform.isMobile = true;
		document.body.classList.add("is-mobile");
		onTestFinished(() => {
			Platform.isMobile = false;
			document.body.classList.remove("is-mobile");
		});
		const matcher = delayedMatcher(),
			h = mount(t, matcher, { finderDockSide: side, finderAutoDock: false }, false);
		Platform.isMobile = false;
		await tick();
		const node = h.target.querySelector(".nya-finder");
		let visible = true;
		h.target.getBoundingClientRect = () => ({
			left: 0,
			top: 0,
			right: visible ? 400 : 0,
			bottom: visible ? 650 : 0,
			width: visible ? 400 : 0,
			height: visible ? 650 : 0,
		});
		node.getBoundingClientRect = () => {
			const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
			// Model delayed compact contents: the first synchronous measurement is
			// still full width; after tick the compact 40px DOM has been rendered.
			const compact = !!node.querySelector(".nya-dock-tab"),
				width = compact ? 40 : 320;
			const css = window.getComputedStyle(node);
			const base =
				css.transform === "none"
					? css.right === "auto"
						? 8
						: 400 - 8 - width
					: (400 - width) / 2;
			return {
				left: base + x,
				right: base + x + width,
				top: 88 + y,
				bottom: 128 + y,
				width,
				height: 40,
			};
		};
		const external = document.createElement("input");
		document.body.append(external);
		onTestFinished(() => external.remove());
		external.focus();
		h.component.showFloatingEntry();
		await tick();
		const css = window.getComputedStyle(node);
		assert.equal(css.transform, "none");
		assert.equal(css.right, side === "right" ? "8px" : "auto");
		assert.equal(
			css.transition,
			"opacity 0.12s ease",
			"position measurements never include a moving transform/right transition",
		);
		assert.equal(
			side === "right"
				? node.getBoundingClientRect().right
				: node.getBoundingClientRect().left,
			side === "right" ? 392 : 8,
		);
		assert.equal(document.activeElement, external);
		assert.equal(matcher.requests.length, 0);
		assert.equal(h.scrolls.length, 0);
		const button = node.querySelector(".nya-dock-expand");
		const startX = node.getBoundingClientRect().left;
		sendPointer(button, "pointerdown", startX + 20, 108);
		sendPointer(document, "pointermove", 200, 138);
		sendPointer(document, "pointerup", 200, 138);
		assert.equal(node.getBoundingClientRect().left, 180);
		assert.equal(h.component.isDocked(), true);
		h.component.matchAgain(false);
		await tick();
		assert.equal(node.getBoundingClientRect().left, 180);
		visible = false;
		window.dispatchEvent(new window.Event("resize"));
		visible = true;
		window.dispatchEvent(new window.Event("resize"));
		assert.equal(
			node.getBoundingClientRect().left,
			180,
			"reactivating the tab does not force a parked icon back to the edge",
		);
		assert.equal(matcher.requests.length, 0);
		assert.equal(h.scrolls.length, 0);
	}
});

test("mobile marker expansion stays inside bounds after positional animations would have finished", async (t) => {
	Platform.isMobile = true;
	document.body.classList.add("is-mobile");
	onTestFinished(() => {
		Platform.isMobile = false;
		document.body.classList.remove("is-mobile");
	});
	for (const side of ["left", "right"]) {
		for (const ownerWidth of [400, 600]) {
			const h = mount(t, undefined, { finderDockSide: side }, false);
			await tick();
			const node = h.target.querySelector(".nya-finder");
			let settled = false,
				delayedWidth = false;
			h.target.getBoundingClientRect = () => ({
				left: 0,
				top: 0,
				right: ownerWidth,
				bottom: 650,
				width: ownerWidth,
				height: 650,
			});
			node.getBoundingClientRect = () => {
				const [x = 0, y = 0] = (node.style.translate || "0px 0px")
					.split(" ")
					.map(parseFloat);
				const compact = node.classList.contains("nya-finder--docked");
				const width =
					compact || (delayedWidth && node.querySelector(".nya-dock-tab"))
						? 40
						: Math.min(416, ownerWidth - 16);
				const css = window.getComputedStyle(node);
				// jsdom does not animate or lay out boxes. Model the bad intermediate
				// transform position only when the actual compiled CSS permits it.
				const movingBase = !settled && /\b(?:transform|right|all)\b/.test(css.transition);
				const base = compact
					? side === "left"
						? 8
						: ownerWidth - 8 - width
					: (ownerWidth - width) / 2 - (movingBase ? width / 2 : 0);
				return {
					left: base + x,
					right: base + x + width,
					top: 88 + y,
					bottom: 128 + y,
					width,
					height: 40,
				};
			};
			h.component.showFloatingEntry();
			await tick();
			// Cover the middle, both safe edges, and content-size changes at tick.
			for (const [markerLeft, delayed] of [
				[ownerWidth / 2 - 20, false],
				[8, false],
				[ownerWidth - 48, false],
				[ownerWidth / 2 - 20, true],
			]) {
				if (!h.component.isDocked()) {
					h.component.dockFinder(side);
					await tick();
				}
				const marker = node.querySelector(".nya-dock-expand"),
					start = node.getBoundingClientRect();
				sendPointer(marker, "pointerdown", start.left + 20, start.top + 20);
				sendPointer(document, "pointermove", markerLeft + 20, 200);
				sendPointer(document, "pointerup", markerLeft + 20, 200);
				assert.equal(node.getBoundingClientRect().left, markerLeft);
				const markerTop = node.getBoundingClientRect().top;
				settled = false;
				delayedWidth = delayed;
				// A fresh short tap clears drag-click suppression, as on Android.
				sendPointer(marker, "pointerdown", markerLeft + 20, 200);
				sendPointer(document, "pointerup", markerLeft + 20, 200);
				marker.dispatchEvent(new window.MouseEvent("click", { detail: 1, bubbles: true }));
				await tick();
				const placed = node.getBoundingClientRect();
				assert.ok(
					placed.left >= 8 && placed.right <= ownerWidth - 8,
					"expanded layout is clamped",
				);
				if (!delayed) {
					const expectedLeft =
						placed.width >= (ownerWidth - 16) * 0.85
							? (ownerWidth - placed.width) / 2
							: Math.max(
									8,
									Math.min(
										markerLeft + 20 - placed.width / 2,
										ownerWidth - 8 - placed.width,
									),
								);
					assert.equal(
						placed.left,
						expectedLeft,
						"full-width panels center; narrower panels expand around the marker",
					);
				}
				assert.equal(placed.top, markerTop, "expansion preserves reachable marker height");
				settled = true;
				assert.deepEqual(
					node.getBoundingClientRect(),
					placed,
					"CSS completion without resize cannot push the panel outside the viewport",
				);
				assert.doesNotMatch(
					window.getComputedStyle(node).transition,
					/\b(?:transform|right|all)\b/,
				);
				assert.notEqual(document.activeElement, node.querySelector("textarea"));
				assert.equal(h.scrolls.length, 0);
			}
		}
	}
});

test("mobile position transitions are disabled without changing desktop transitions or reduced-motion rules", async (t) => {
	onTestFinished(() => {
		Platform.isMobile = false;
		document.body.classList.remove("is-mobile");
	});
	for (const mobile of [false, true]) {
		Platform.isMobile = mobile;
		document.body.classList.toggle("is-mobile", mobile);
		const h = mount(t);
		await tick();
		const node = h.target.querySelector(".nya-finder"),
			transition = window.getComputedStyle(node).transition;
		if (mobile) assert.equal(transition, "opacity 0.2s linear");
		else {
			assert.match(transition, /transform 0.2s linear/);
			assert.match(transition, /right 0.3s/);
		}
		node.classList.add("nya-finder--dragging");
		assert.equal(window.getComputedStyle(node).transition, "opacity 0.12s ease");
	}
	Platform.isMobile = false;
	document.body.classList.remove("is-mobile");
	assert.match(
		style.textContent,
		/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*transition:\s*none\s*!important/,
	);
});

test("queued automatic entry placement cannot override close, expansion, file changes or destruction", async (t) => {
	for (const action of ["close", "expand", "file", "destroy"]) {
		const h = mount(t, undefined, {}, false);
		await tick();
		const node = h.target.querySelector(".nya-finder");
		h.component.showFloatingEntry();
		if (action === "close") h.component.setVisible(false);
		else if (action === "expand") h.component.expandFinder();
		else if (action === "file") h.view.file = { path: "b.md" };
		else h.component.destroy();
		await tick();
		if (action === "close") assert.equal(h.component.isVisible(), false);
		else if (action === "expand") assert.equal(h.component.isDocked(), false);
		else if (action === "destroy") assert.equal(node.isConnected, false);
		assert.notEqual(document.activeElement, node.querySelector(".nya-dock-expand"));
	}
});

test("automatic entry activation can delegate to native search without expanding or focusing input", async (t) => {
	const h = mount(t, undefined, {}, false);
	await tick();
	const input = document.createElement("input");
	document.body.append(input);
	onTestFinished(() => input.remove());
	input.focus();
	let calls = 0;
	// Change the existing controller shared with the component.
	Object.assign(h.editorSearch, {
		getEditorContext: () => null,
		activateFloatingFinder: (owner) => {
			assert.equal(owner, h.view);
			calls++;
			h.component.setVisible(false);
			return false;
		},
	});
	await tick();
	h.component.showFloatingEntry();
	await tick();
	h.target.querySelector(".nya-dock-expand").click();
	await tick();
	assert.equal(calls, 1);
	assert.equal(h.component.isVisible(), false);
	assert.equal(document.activeElement, input);
});

test("replace UI commands expand compact and closed sessions, preserve inputs and focus replacement", async (t) => {
	const h = mount(t);
	await tick();
	setReplacement(h, "dog");
	h.component.setCollapse(false);
	h.component.dockFinder();
	await tick();
	h.component.showReplace("different selection");
	await tick();
	assert.equal(h.component.isDocked(), false);
	assert.equal(h.component.getSearchCache().collapse, false);
	assert.equal(h.component.getSearchCache().search, "cat");
	assert.equal(h.component.getSearchCache().replace, "dog");
	assert.equal(document.activeElement, h.target.querySelector(".replacer textarea"));
	h.component.dockFinder();
	await tick();
	h.component.toggleReplaceFromCommand();
	await tick();
	assert.equal(
		h.component.getSearchCache().collapse,
		false,
		"compact state must not toggle an already open replacement row off",
	);
	assert.equal(document.activeElement, h.target.querySelector(".replacer textarea"));
	h.component.toggleReplaceFromCommand();
	await tick();
	assert.equal(h.component.getSearchCache().collapse, true);
	h.component.toggleReplaceFromCommand();
	await tick();
	assert.equal(h.component.getSearchCache().collapse, false);
	h.component.closeFinder();
	await tick();
	h.component.toggleReplaceFromCommand();
	await tick();
	assert.equal(h.component.isVisible(), true);
	assert.equal(h.component.getSearchCache().collapse, false);
	assert.equal(document.activeElement, h.target.querySelector(".replacer textarea"));
});

test("queued replacement focus cannot override close, a newer find command, owner file or reading mode", async (t) => {
	for (const action of ["close", "find", "file", "reading"]) {
		const h = mount(t);
		await tick();
		h.component.showReplace();
		if (action === "close") h.component.closeFinder();
		else if (action === "find") h.component.setVisible(true);
		else if (action === "file") h.view.file = { path: "b.md" };
		else h.view.getMode = () => "preview";
		await tick();
		assert.notEqual(document.activeElement, h.target.querySelector(".replacer textarea"));
	}
});

test("empty-query compact command expansion focuses only after layout with preventScroll and no ancestor panning", async (t) => {
	for (const target of ["search", "replace"]) {
		const h = mount(t, undefined, {}, false);
		await tick();
		const node = h.target.querySelector(".nya-finder"),
			query = node.querySelector("textarea"),
			replace = node.querySelector(".replacer textarea");
		h.target.getBoundingClientRect = () => ({
			left: 0,
			top: 0,
			right: 800,
			bottom: 600,
			width: 800,
			height: 600,
		});
		node.getBoundingClientRect = () => {
			const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
			const width = node.classList.contains("nya-finder--docked") ? 30 : 448;
			return {
				left: 752 - width + x,
				top: 88 + y,
				right: 752 + x,
				bottom: 126 + y,
				width,
				height: 38,
			};
		};
		h.target.scrollLeft = 23;
		h.target.scrollTop = 37;
		const header = document.createElement("header");
		h.target.prepend(header);
		h.component.showFloatingEntry();
		await tick();
		const input = target === "search" ? query : replace,
			nativeFocus = input.focus;
		const queryFocus = target === "replace" ? vi.spyOn(query, "focus") : null;
		const focus = vi.spyOn(input, "focus").mockImplementation(function (options) {
			// jsdom does not implement focus scrolling. Model its possible ancestor
			// effect, and separately assert layout is already committed at this call.
			if (!options?.preventScroll) {
				h.target.scrollLeft = 400;
				h.target.scrollTop = 0;
			}
			assert.equal(
				node.querySelector(".nya-dock-tab"),
				null,
				"expanded DOM is committed before input focus",
			);
			assert.equal(input.tabIndex >= 0, true);
			const box = node.getBoundingClientRect();
			assert.ok(box.left >= 8 && box.right <= 792, "placement is corrected before focus");
			if (target === "replace")
				assert.equal(node.querySelector(".replacer").style.display, "");
			return nativeFocus.call(this, options);
		});
		if (target === "search") h.component.setVisible(true);
		else h.component.showReplace();
		assert.equal(focus.mock.calls.length, 0, "compact expansion waits for layout");
		await tick();
		assert.equal(focus.mock.calls.length, 1);
		assert.deepEqual(focus.mock.calls[0], [{ preventScroll: true }]);
		assert.equal(
			queryFocus?.mock.calls.length ?? 0,
			0,
			"replacement command never focuses query first",
		);
		assert.equal(document.activeElement, input);
		assert.equal(h.target.scrollLeft, 23);
		assert.equal(h.target.scrollTop, 37);
		assert.equal(h.scrolls.length, 0, "empty query never invokes match navigation");
		assert.equal(h.target.querySelector("header"), header);
	}
});

test("compact query focus is invalidated by close, re-collapse, owner changes or destruction", async (t) => {
	for (const action of ["close", "dock", "file", "mode", "document", "destroy"]) {
		const h = mount(t, undefined, {}, false);
		await tick();
		h.component.showFloatingEntry();
		await tick();
		const input = h.target.querySelector("textarea"),
			focus = vi.spyOn(input, "focus");
		h.component.setVisible(true);
		if (action === "close") h.component.setVisible(false);
		else if (action === "dock") h.component.dockFinder();
		else if (action === "file") h.view.file = { path: "other.md" };
		else if (action === "mode") h.view.getMode = () => "preview";
		else if (action === "document") {
			const foreign = new JSDOM("<!doctype html><body></body>");
			onTestFinished(() => foreign.window.close());
			foreign.window.document.body.append(foreign.window.document.adoptNode(h.target));
		} else h.component.destroy();
		await tick();
		assert.equal(focus.mock.calls.length, 0, action);
	}
});

test("non-compact query opening keeps immediate focus without scrolling and still navigates real matches", async (t) => {
	const h = mount(t, undefined, {}, false);
	await tick();
	const input = h.target.querySelector("textarea"),
		focus = vi.spyOn(input, "focus");
	h.component.setVisible(true, "cat");
	assert.equal(document.activeElement, input);
	assert.equal(focus.mock.calls.length, 1);
	assert.deepEqual(focus.mock.calls[0], [{ preventScroll: true }]);
	assert.ok(
		h.scrolls.length > 0,
		"preventScroll applies to focus, not intentional match navigation",
	);
	await tick();
	assert.equal(input.selectionStart, 0);
	assert.equal(input.selectionEnd, 3);
});

test("new replacement intent supersedes queued compact query focus and selects only the replacement text", async (t) => {
	const h = mount(t, undefined, {}, false);
	await tick();
	setReplacement(h, "dog");
	h.component.showFloatingEntry();
	await tick();
	const query = h.target.querySelector("textarea"),
		replace = h.target.querySelector(".replacer textarea");
	const queryFocus = vi.spyOn(query, "focus"),
		replaceFocus = vi.spyOn(replace, "focus");
	h.component.setVisible(true, "cat");
	h.component.showReplace();
	await tick();
	assert.equal(queryFocus.mock.calls.length, 0);
	assert.equal(replaceFocus.mock.calls.length, 1);
	assert.deepEqual(replaceFocus.mock.calls[0], [{ preventScroll: true }]);
	assert.equal(document.activeElement, replace);
	assert.equal(replace.selectionStart, 0);
	assert.equal(replace.selectionEnd, 3);
});

test("replacement UI commands do not open or change a reading-mode entry", async (t) => {
	const h = mount(t, undefined, {}, false);
	await tick();
	h.view.getMode = () => "preview";
	h.component.showFloatingEntry();
	await tick();
	const before = JSON.parse(JSON.stringify(h.component.getSearchCache()));
	h.component.showReplace("other");
	h.component.toggleReplaceFromCommand();
	await tick();
	assert.equal(h.component.isDocked(), true);
	assert.deepEqual(h.component.getSearchCache(), before);
	assert.notEqual(document.activeElement, h.target.querySelector(".replacer textarea"));
});

test("edge collapse retains session, highlights and replace expansion without closing or input focus", async (t) => {
	const h = mount(t, undefined, { clearAfterHidden: true });
	await tick();
	h.component.setCollapse(false);
	setReplacement(h, "dog");
	await tick();
	const before = JSON.parse(JSON.stringify(h.component.getSearchCache())),
		specs = h.specs.length,
		scrolls = h.scrolls.length;
	h.component.dockFinder();
	await tick();
	assert.equal(h.component.isVisible(), true);
	assert.deepEqual(h.component.getSearchCache(), before);
	assert.equal(h.specs.length, specs);
	assert.equal(h.scrolls.length, scrolls);
	assert.ok(h.target.querySelector(".nya-finder--docked"));
	assert.equal(h.target.querySelector(".main-part").hasAttribute("inert"), true);
	assert.equal(window.getComputedStyle(h.target.querySelector(".main-part")).display, "none");
	assert.equal(h.target.querySelector("textarea").tabIndex, -1);
	h.target.querySelector("textarea").focus();
	assert.notEqual(document.activeElement, h.target.querySelector("textarea"));
	h.target.querySelector(".nya-dock-expand").click();
	await tick();
	assert.equal(h.target.querySelector(".main-part").hasAttribute("inert"), false);
	assert.notEqual(document.activeElement, h.target.querySelector("textarea"));
	assert.deepEqual(h.component.getSearchCache(), before);
	h.component.dockFinder();
	await tick();
	h.component.setVisible(true);
	await tick();
	assert.equal(h.target.querySelector(".nya-dock-tab"), null);
	assert.equal(document.activeElement, h.target.querySelector("textarea"));
	h.component.dockFinder();
	await tick();
	h.component.closeFinder();
	await tick();
	assert.equal(h.component.isVisible(), false);
	assert.equal(h.component.getSearchCache().search, "");
	assert.equal(h.component.getSearchCache().replace, "");
	assert.equal(h.target.querySelector(".nya-dock-tab"), null);
});

test("collapsed pending editor matches publish highlights but relinquish scroll; close still rejects late results", async (t) => {
	const matcher = delayedMatcher(),
		h = mount(t, matcher);
	await tick();
	const cancels = matcher.cancels ?? 0;
	h.component.dockFinder();
	await tick();
	assert.equal(matcher.cancels ?? 0, cancels);
	assert.equal(h.target.querySelector(".nya-dock-state").textContent, "…");
	matcher.requests[0].resolve(matchedCats);
	await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(h.scrolls.length, 0);
	assert.equal(h.specs.at(-1).effects[0].visible, true);
	h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } });
	h.component.matchAgain(false);
	await tick();
	assert.equal(matcher.requests.length, 2);
	h.component.closeFinder();
	const count = h.specs.length;
	matcher.requests[1].resolve(matchedCats);
	await settlePosition();
	assert.equal(h.specs.length, count);
});

test("edge collapse blocks during replacement prepare/rematch and replacement commands expand it", async (t) => {
	const h = await mountReplacement(t);
	h.component.dockFinder();
	await tick();
	const pending = h.component.replaceOnce();
	await tick();
	assert.equal(h.target.querySelector(".nya-dock-tab"), null);
	assert.equal(h.component.dockFinder(), false);
	assert.equal(h.target.querySelector('[aria-label="search.tip.DockFinder"]'), null);
	h.matcher.replacements[0].resolve(candidates());
	const result = await pending;
	assert.equal(h.component.dockFinder(), false);
	h.matcher.requests[1].resolve(matchedCats);
	await result.navigationCompletion;
	await tick();
	assert.equal(h.component.dockFinder(), true);
});

test("edge collapse closes More and keeps its hidden controls out of focus", async (t) => {
	const h = mount(t);
	await tick();
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => (item.id === "regex" ? { ...item, placement: "more" } : item));
	h.component.refreshToolbar();
	await tick();
	h.target.querySelector('[aria-label="search.tip.More"]').click();
	await tick();
	assert.ok(h.target.querySelector(".nya-toolbar-menu"));
	h.component.dockFinder();
	await tick();
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), null);
	assert.equal(h.target.querySelector('[aria-label="search.tip.More"]').tabIndex, -1);
	assert.equal(h.target.querySelector(".nya-panel-tools"), null);
	const handle = h.target.querySelector(".nya-dragger");
	assert.ok(document.getElementById(handle.getAttribute("aria-labelledby")));
	assert.equal(handle.getAttribute("aria-label"), null);
	assert.equal(handle.getAttribute("title"), null);
});

test("edge tab delayed focus never overrides a newer open-search intent", async (t) => {
	const h = mount(t);
	await tick();
	h.component.dockFinder();
	await tick();
	h.target.querySelector(".nya-dock-expand").click();
	h.component.setVisible(true);
	await tick();
	assert.equal(document.activeElement, h.target.querySelector("textarea"));
	h.component.dockFinder();
	h.component.setVisible(false);
	h.component.setVisible(true);
	await tick();
	assert.equal(document.activeElement, h.target.querySelector("textarea"));
	assert.equal(h.target.querySelector(".nya-dock-tab"), null);
});

test("More follows moved finder within owner boundaries and flips above near the bottom", async (t) => {
	const h = mount(t);
	await tick();
	h.target.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 400 });
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => (item.id === "regex" ? { ...item, placement: "more" } : item));
	h.component.refreshToolbar();
	await tick();
	h.target.querySelector('[aria-label="search.tip.More"]').click();
	await tick();
	const menu = h.target.querySelector(".nya-toolbar-menu"),
		trigger = h.target.querySelector('[aria-label="search.tip.More"]');
	trigger.getBoundingClientRect = () => ({ top: 330 });
	menu.getBoundingClientRect = () => {
		const [x = 0, y = 0] = (menu.style.translate || "0px 0px").split(" ").map(parseFloat);
		return { left: 500 + x, top: 360 + y, width: 180, height: 100 };
	};
	h.target.querySelector(".nya-finder").dispatchEvent(new window.Event("nya-finder-position"));
	assert.equal(menu.style.translate, "-88px -136px");
	assert.equal(menu.style.maxHeight, "384px");
	h.component.dockFinder();
	await tick();
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), null);
});

test("finder placement handle supports keyboard movement/reset, owner isolation and closes cleanly", async (t) => {
	const h = mount(t),
		other = mount(t);
	await tick();
	const node = h.target.querySelector(".nya-finder");
	h.target.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		right: 800,
		bottom: 600,
		width: 800,
		height: 600,
	});
	node.getBoundingClientRect = () => {
		const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
		return {
			left: 200 + x,
			top: 88 + y,
			right: 648 + x,
			bottom: 126 + y,
			width: 448,
			height: 38,
		};
	};
	window.dispatchEvent(new window.Event("resize"));
	const handle = h.target.querySelector(".nya-dragger"),
		before = other.target.querySelector(".nya-finder").style.translate;
	handle.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
	);
	assert.equal(node.style.translate, "0px 8px");
	assert.equal(other.target.querySelector(".nya-finder").style.translate, before);
	handle.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
	);
	assert.equal(node.style.translate, "0px 0px");
});

test("real mobile branch uses equal row heights, centered top grip and original collapse arrow", async (t) => {
	Platform.isMobile = true;
	document.body.classList.add("is-mobile");
	const h = mount(t, undefined, { finderDockSide: "left" });
	await tick();
	Platform.isMobile = false;
	onTestFinished(() => {
		Platform.isMobile = false;
		document.body.classList.remove("is-mobile");
	});
	assert.ok(h.target.querySelector(".nya-mobile"));
	assert.ok(h.target.querySelector(".nya-float-act"));
	assert.equal(h.target.querySelector(".nya-panel-tools"), null);
	assert.ok(h.target.querySelector(".nya-float-act .nya-move-handle"));
	assert.ok(h.target.querySelector(".nya-toggle"));
	const bar = h.target.querySelector(".nya-float-act"),
		handle = bar.querySelector(".nya-move-handle");
	const barStyle = window.getComputedStyle(bar),
		handleStyle = window.getComputedStyle(handle);
	assert.equal(barStyle.minHeight, "40px");
	assert.equal(barStyle.boxSizing, "border-box");
	assert.equal(barStyle.display, "grid");
	assert.equal(barStyle.gridTemplateColumns, "minmax(0, 1fr) 72px minmax(0, 1fr)");
	assert.equal(handleStyle.gridColumn, "2");
	assert.equal(handleStyle.alignSelf, "start");
	assert.equal(handleStyle.width, "72px");
	assert.equal(handleStyle.height, "30px");
	assert.equal(handle.querySelector(".nya-move-bar").getAttribute("aria-hidden"), "true");
	assert.equal(handle.getAttribute("aria-label"), null);
	assert.equal(handle.getAttribute("title"), null);
	assert.ok(document.getElementById(handle.getAttribute("aria-labelledby")));
	assert.equal(window.getComputedStyle(bar.querySelector(".nya-mobile-actions")).gridColumn, "3");
	const panelStyle = window.getComputedStyle(h.target.querySelector(".nya-finder"));
	const rowStyle = window.getComputedStyle(h.target.querySelector(".finder"));
	assert.equal(panelStyle.height, "auto");
	assert.equal(panelStyle.boxSizing, "border-box");
	// The shared surface adds two 1px outer borders (theme color is unresolved in jsdom).
	assert.equal(parseFloat(rowStyle.minHeight) + 2, parseFloat(barStyle.minHeight));
	h.component.dockFinder();
	await tick();
	assert.equal(window.getComputedStyle(h.target.querySelector(".main-part")).display, "none");
	assert.equal(window.getComputedStyle(h.target.querySelector(".nya-finder")).height, "40px");
	assert.ok(h.target.querySelector(".nya-finder--dock-left"));
	h.target.querySelector(".nya-dock-expand").click();
	await tick();
	assert.notEqual(document.activeElement, h.target.querySelector("textarea"));
	h.component.dockFinder("right");
	await tick();
	assert.equal(h.target.querySelector(".nya-finder--dock-left"), null);
});

test("mobile inputs override host padding and line height without hiding multi-line content", async (t) => {
	Platform.isMobile = true;
	document.body.classList.add("is-mobile");
	onTestFinished(() => {
		Platform.isMobile = false;
		document.body.classList.remove("is-mobile");
	});
	const h = mount(t, undefined, {}, false);
	Platform.isMobile = false;
	await tick();
	h.component.setVisible(true, "");
	h.component.setCollapse(false);
	await tick();
	for (const input of h.target.querySelectorAll("textarea")) {
		const css = window.getComputedStyle(input);
		assert.equal(css.boxSizing, "border-box");
		assert.equal(css.height, "30px");
		assert.equal(css.minHeight, "0");
		assert.equal(css.lineHeight, "20px");
		assert.equal(css.fontSize, "16px");
		assert.equal(css.paddingTop, "4px");
		assert.equal(css.paddingBottom, "4px");
		assert.equal(
			parseFloat(css.height) -
				parseFloat(css.paddingTop) -
				parseFloat(css.paddingBottom) -
				parseFloat(css.borderTopWidth) -
				parseFloat(css.borderBottomWidth),
			parseFloat(css.lineHeight),
			"one empty/single line fits the content box exactly",
		);
		assert.equal(css.overflow, "auto");
		assert.equal(css.overscrollBehavior, "contain");
		assert.equal(input.rows, 1);
		assert.equal(input.getAttribute("wrap"), "off");
		input.value = "cat\ncat";
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
		await tick();
		assert.equal(input.value, "cat\ncat");
		assert.equal(window.getComputedStyle(input).overflow, "auto");
	}
	assert.equal(h.component.getSearchCache().search, "cat\ncat");
	assert.equal(h.component.getSearchCache().replace, "cat\ncat");
	h.component.setCollapse(true);
	await tick();
	assert.equal(window.getComputedStyle(h.target.querySelector(".finder")).minHeight, "38px");
});

test("mobile center grip drags directly and cancels without making counters or close draggable", async (t) => {
	Platform.isMobile = true;
	document.body.classList.add("is-mobile");
	const h = mount(t);
	Platform.isMobile = false;
	await tick();
	onTestFinished(() => {
		Platform.isMobile = false;
		document.body.classList.remove("is-mobile");
	});
	const node = h.target.querySelector(".nya-finder"),
		bar = node.querySelector(".nya-float-act"),
		handle = bar.querySelector(".nya-move-handle");
	h.target.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		right: 400,
		bottom: 650,
		width: 400,
		height: 650,
	});
	Object.defineProperty(bar, "offsetHeight", { configurable: true, get: () => 40 });
	node.getBoundingClientRect = () => {
		const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
		return {
			left: 40 + x,
			top: 100 + y,
			right: 360 + x,
			bottom: 140 + y,
			width: 320,
			height: 40,
		};
	};
	window.dispatchEvent(new window.Event("resize"));
	const before = node.style.translate;
	for (const control of [
		bar.querySelector(".nya-float-tip"),
		bar.querySelector(".nya-mobile-close"),
	]) {
		sendPointer(control, "pointerdown", 200, 100);
		sendPointer(document, "pointermove", 220, 150);
		sendPointer(document, "pointerup", 220, 150);
		assert.equal(node.style.translate, before);
		assert.equal(node.classList.contains("nya-finder--dragging"), false);
	}
	sendPointer(handle.querySelector(".nya-move-bar"), "pointerdown", 200, 70);
	sendPointer(document, "pointermove", 220, 120);
	assert.equal(node.style.translate, "20px 50px");
	assert.equal(window.getComputedStyle(node).opacity, "0.8");
	sendPointer(document, "pointercancel", 220, 120);
	assert.equal(node.style.translate, before);
	assert.equal(node.classList.contains("nya-finder--dragging"), false);
	sendPointer(handle, "pointerdown", 200, 70);
	sendPointer(document, "pointermove", 210, 90);
	sendPointer(document, "pointerup", 210, 90);
	assert.equal(node.style.translate, "10px 20px");
	assert.equal(h.component.isDocked(), false);
	// A taller result bar (wrapped actions) remains inside the reachable footprint.
	Object.defineProperty(bar, "offsetHeight", { configurable: true, get: () => 68 });
	window.dispatchEvent(new window.Event("resize"));
	sendPointer(handle, "pointerdown", 200, 70);
	sendPointer(document, "pointermove", 200, -500);
	sendPointer(document, "pointerup", 200, -500);
	assert.equal(
		node.getBoundingClientRect().top,
		76,
		"68px wrapped result bar stays below the 8px owner inset",
	);
});

test("position controller follows adopted owner documents and releases old window listeners", async (t) => {
	const h = mount(t);
	await tick();
	const popup = new JSDOM("<!doctype html><body></body>");
	onTestFinished(() => popup.window.close());
	popup.window.document.body.append(popup.window.document.adoptNode(h.target));
	h.component.matchAgain(false);
	await tick();
	assert.equal(popup.window.document.querySelectorAll('div[aria-hidden="true"]').length, 1);
	const node = h.target.querySelector(".nya-finder");
	h.target.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		right: 800,
		bottom: 600,
		width: 800,
		height: 600,
	});
	node.getBoundingClientRect = () => {
		const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
		return {
			left: 200 + x,
			top: 88 + y,
			right: 648 + x,
			bottom: 126 + y,
			width: 448,
			height: 38,
		};
	};
	popup.window.dispatchEvent(new popup.window.Event("resize"));
	assert.equal(node.style.translate, "0px 0px");
	h.target.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		right: 700,
		bottom: 600,
		width: 700,
		height: 600,
	});
	window.dispatchEvent(new window.Event("resize"));
	assert.equal(node.style.getPropertyValue("--nya-available-width"), "784px");
	popup.window.dispatchEvent(new popup.window.Event("resize"));
	assert.equal(node.style.getPropertyValue("--nya-available-width"), "684px");
});

const sendPointer = (target, type, x = 0, y = 0) => {
	const event = new window.Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, { clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true });
	target.dispatchEvent(event);
	return event;
};

test("desktop drag uses the accent strip without tooltip labels or delays; arrow only toggles", async (t) => {
	const h = mount(t);
	await tick();
	const arrow = h.target.querySelector(".nya-toggle"),
		node = h.target.querySelector(".nya-finder");
	h.target.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		right: 800,
		bottom: 600,
		width: 800,
		height: 600,
	});
	node.getBoundingClientRect = () => {
		const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
		return {
			left: 200 + x,
			top: 88 + y,
			right: 648 + x,
			bottom: 126 + y,
			width: 448,
			height: 38,
		};
	};
	assert.equal(h.target.querySelector(".nya-panel-tools"), null);
	sendPointer(arrow, "pointerdown");
	sendPointer(document, "pointerup");
	arrow.dispatchEvent(new window.MouseEvent("click", { detail: 1, bubbles: true }));
	await tick();
	assert.equal(h.component.getSearchCache().collapse, false);
	const strip = h.target.querySelector(".nya-dragger");
	sendPointer(strip, "pointerdown");
	sendPointer(document, "pointermove", 8, 0);
	assert.equal(window.getComputedStyle(node).opacity, "0.8");
	sendPointer(document, "pointerup", 8, 0);
	await tick();
	assert.equal(h.component.getSearchCache().collapse, false);
	assert.notEqual(window.getComputedStyle(node).opacity, "0.8");
	assert.equal(strip.getAttribute("aria-label"), null);
	assert.equal(strip.getAttribute("title"), null);
	assert.equal(arrow.getAttribute("aria-describedby"), null);
	arrow.dispatchEvent(
		new window.KeyboardEvent("keydown", { code: "Enter", key: "Enter", bubbles: true }),
	);
	await tick();
	assert.equal(h.component.getSearchCache().collapse, true);
});

test("compact marker drags immediately without accidental expansion, while a click still expands", async (t) => {
	const h = mount(t);
	await tick();
	h.component.dockFinder();
	await tick();
	const node = h.target.querySelector(".nya-finder"),
		marker = h.target.querySelector(".nya-dock-expand");
	h.target.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		right: 800,
		bottom: 600,
		width: 800,
		height: 600,
	});
	node.getBoundingClientRect = () => {
		const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
		const size = node.classList.contains("nya-finder--docked") ? 30 : 448;
		return {
			left: 200 + x,
			top: 88 + y,
			right: 200 + x + size,
			bottom: 118 + y,
			width: size,
			height: 30,
		};
	};
	window.dispatchEvent(new window.Event("resize"));
	assert.equal(window.getComputedStyle(node).height, "30px");
	assert.equal(window.getComputedStyle(node).width, "30px");
	assert.equal(marker.getAttribute("aria-label"), null);
	assert.ok(document.getElementById(marker.getAttribute("aria-labelledby")));
	sendPointer(marker, "pointerdown", 100, 100);
	sendPointer(document, "pointermove", 20, 130);
	sendPointer(document, "pointerup", 20, 130);
	marker.dispatchEvent(new window.MouseEvent("click", { detail: 1, bubbles: true }));
	await tick();
	assert.ok(h.target.querySelector(".nya-finder--docked"));
	const box = node.getBoundingClientRect();
	assert.ok(box.left < 762);
	assert.equal(box.top, 118);
	sendPointer(marker, "pointerdown", 20, 130);
	sendPointer(document, "pointerup", 20, 130);
	marker.dispatchEvent(new window.MouseEvent("click", { detail: 1, bubbles: true }));
	await tick();
	assert.equal(h.target.querySelector(".nya-finder--docked"), null);
	assert.notEqual(document.activeElement, h.target.querySelector("textarea"));
});

test("mobile long press blocks menu and release expansion while held dragging and short taps still work", async (t) => {
	Platform.isMobile = true;
	document.body.classList.add("is-mobile");
	onTestFinished(() => {
		Platform.isMobile = false;
		document.body.classList.remove("is-mobile");
	});
	const h = mount(t, undefined, {}, false);
	Platform.isMobile = false;
	await tick();
	h.component.showFloatingEntry();
	await tick();
	const node = h.target.querySelector(".nya-finder"),
		marker = node.querySelector(".nya-dock-expand");
	h.target.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		right: 400,
		bottom: 650,
		width: 400,
		height: 650,
	});
	node.getBoundingClientRect = () => {
		const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
		return {
			left: 352 + x,
			top: 88 + y,
			right: 392 + x,
			bottom: 128 + y,
			width: 40,
			height: 40,
		};
	};
	window.dispatchEvent(new window.Event("resize"));
	let now = 0;
	vi.spyOn(window.performance, "now").mockImplementation(() => now);
	const menuCount = Menu.shown.length;
	let bubbled = 0;
	const context = () => bubbled++;
	document.addEventListener("contextmenu", context);
	onTestFinished(() => document.removeEventListener("contextmenu", context));
	const releaseClick = () =>
		marker.dispatchEvent(
			new window.MouseEvent("click", { detail: 1, bubbles: true, cancelable: true }),
		);
	for (const emitMenu of [true, false]) {
		sendPointer(marker, "pointerdown", 372, 108);
		now += 600;
		if (emitMenu) {
			const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
			marker.dispatchEvent(event);
			assert.equal(event.defaultPrevented, true);
			assert.equal(bubbled, 0);
		}
		sendPointer(document, "pointerup", 372, 108);
		releaseClick();
		await tick();
		assert.equal(Menu.shown.length, menuCount);
		assert.equal(h.component.isDocked(), true);
	}
	const before = node.style.translate;
	sendPointer(marker, "pointerdown", 372, 108);
	now += 1000;
	marker.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
	sendPointer(document, "pointermove", 212, 138);
	sendPointer(document, "pointercancel", 212, 138);
	releaseClick();
	await tick();
	assert.equal(node.style.translate, before);
	assert.equal(h.component.isDocked(), true);
	sendPointer(marker, "pointerdown", 372, 108);
	now += 1000;
	marker.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
	sendPointer(document, "pointermove", 212, 138);
	sendPointer(document, "pointerup", 212, 138);
	releaseClick();
	await tick();
	assert.equal(node.getBoundingClientRect().left, 192);
	assert.equal(h.component.isDocked(), true);
	assert.equal(Menu.shown.length, menuCount);
	assert.equal(h.scrolls.length, 0);
	sendPointer(marker, "pointerdown", 212, 138);
	now += 100;
	sendPointer(document, "pointerup", 212, 138);
	releaseClick();
	await tick();
	assert.equal(h.component.isDocked(), false, "a new short tap still expands");
	for (const input of node.querySelectorAll("textarea")) {
		const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
		input.dispatchEvent(event);
		assert.equal(event.defaultPrevented, false, "input text-selection menus are untouched");
	}
	const handle = node.querySelector(".nya-move-handle");
	const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
	handle.dispatchEvent(event);
	assert.equal(event.defaultPrevented, true);
	assert.equal(Menu.shown.length, menuCount);
	assert.match(style.textContent, /\.nya-dock-expand[^{}]*\{[^}]*-webkit-touch-callout:\s*none/);
});

test("desktop compact context menu retains close and reset actions", async (t) => {
	const h = mount(t, undefined, {}, false);
	await tick();
	h.component.showFloatingEntry();
	await tick();
	const marker = h.target.querySelector(".nya-dock-expand"),
		before = Menu.shown.length;
	marker.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
	assert.equal(Menu.shown.length, before + 1);
	const menu = Menu.shown.at(-1);
	assert.deepEqual(
		menu.items.map((item) => item.title),
		["search.tip.Close", "search.tip.ResetFinderPosition"],
	);
	menu.items[1].run();
	await tick();
	assert.equal(h.component.isDocked(), true, "passive reset does not activate search");
	menu.items[0].run();
	await tick();
	assert.equal(h.component.isVisible(), false);
});

test("mobile compact gesture isolates host pointer and touch swipes without blocking other touches or taps", async (t) => {
	Platform.isMobile = true;
	document.body.classList.add("is-mobile");
	onTestFinished(() => {
		Platform.isMobile = false;
		document.body.classList.remove("is-mobile");
	});
	const h = mount(t, undefined, {}, false);
	Platform.isMobile = false;
	await tick();
	h.component.showFloatingEntry();
	await tick();
	const node = h.target.querySelector(".nya-finder"),
		marker = node.querySelector(".nya-dock-expand");
	h.target.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		right: 400,
		bottom: 650,
		width: 400,
		height: 650,
	});
	node.getBoundingClientRect = () => {
		const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
		return {
			left: 352 + x,
			top: 88 + y,
			right: 392 + x,
			bottom: 128 + y,
			width: 40,
			height: 40,
		};
	};
	window.dispatchEvent(new window.Event("resize"));
	const seen = [];
	const hostSwipe = (event) => {
		seen.push(event.type);
		event.stopPropagation();
	};
	const types = [
		"pointerdown",
		"pointermove",
		"pointerup",
		"pointercancel",
		"touchstart",
		"touchmove",
		"touchend",
		"touchcancel",
	];
	for (const type of types) h.target.addEventListener(type, hostSwipe);
	onTestFinished(() => {
		for (const type of types) h.target.removeEventListener(type, hostSwipe);
	});
	const touch = (target, type, id = 7, x = 372) => {
		const event = new window.Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, {
			changedTouches: [{ identifier: id, clientX: x, clientY: 108, target: marker }],
		});
		target.dispatchEvent(event);
		return event;
	};
	assert.equal(sendPointer(marker, "pointerdown", 372, 108).defaultPrevented, false);
	assert.equal(touch(marker, "touchstart").defaultPrevented, false);
	assert.equal(touch(marker, "touchmove", 7, 371).defaultPrevented, true);
	assert.equal(node.style.translate, "0px 0px", "Touch Events never duplicate position updates");
	sendPointer(marker, "pointermove", 212, 138);
	sendPointer(marker, "pointerup", 212, 138);
	touch(marker, "touchend", 7, 212);
	marker.dispatchEvent(new window.MouseEvent("click", { detail: 1, bubbles: true }));
	await tick();
	assert.equal(node.getBoundingClientRect().left, 192);
	assert.equal(h.component.isDocked(), true);
	assert.deepEqual(seen, []);
	// Active gesture protects only its own finger, not an unrelated input/body touch.
	sendPointer(marker, "pointerdown", 212, 138);
	touch(marker, "touchstart");
	assert.equal(touch(h.target, "touchmove", 9).defaultPrevented, false);
	assert.deepEqual(seen, ["touchmove"]);
	seen.length = 0;
	sendPointer(marker, "pointermove", 112, 188);
	sendPointer(marker, "pointercancel", 112, 188);
	touch(marker, "touchcancel");
	assert.equal(node.getBoundingClientRect().left, 192);
	assert.deepEqual(seen, []);
	assert.equal(touch(h.target, "touchmove").defaultPrevented, false);
	seen.length = 0;
	// Short tap start/end never cancels defaults, so native synthesized clicks remain possible.
	sendPointer(marker, "pointerdown", 212, 138);
	touch(marker, "touchstart");
	sendPointer(marker, "pointerup", 212, 138);
	assert.equal(touch(marker, "touchend").defaultPrevented, false);
	marker.dispatchEvent(new window.MouseEvent("click", { detail: 1, bubbles: true }));
	await tick();
	assert.equal(h.component.isDocked(), false);
	assert.deepEqual(seen, []);
	for (const input of node.querySelectorAll("textarea")) {
		assert.equal(touch(input, "touchstart", 10).defaultPrevented, false);
		assert.equal(touch(input, "touchmove", 10).defaultPrevented, false);
	}
	assert.ok(seen.includes("touchstart") && seen.includes("touchmove"));
	seen.length = 0;
	// Hiding the complete panel in the middle of a held gesture releases guards.
	const handle = node.querySelector(".nya-move-handle");
	sendPointer(handle, "pointerdown", 200, 80);
	touch(handle, "touchstart");
	h.component.setVisible(false);
	await tick();
	assert.equal(touch(h.target, "touchmove").defaultPrevented, false);
	assert.ok(seen.includes("touchmove"));
});

test("mobile touch guards release on destruction and owner blur without leaking document listeners", async (t) => {
	for (const action of ["destroy", "blur", "pagehide"]) {
		Platform.isMobile = true;
		const h = mount(t, undefined, {}, false);
		Platform.isMobile = false;
		await tick();
		h.component.showFloatingEntry();
		await tick();
		const marker = h.target.querySelector(".nya-dock-expand");
		const event = new window.Event("touchstart", { bubbles: true });
		Object.assign(event, { changedTouches: [{ identifier: 7 }] });
		marker.dispatchEvent(event);
		if (action === "destroy") h.component.destroy();
		else window.dispatchEvent(new window.Event(action));
		const move = new window.Event("touchmove", { bubbles: true, cancelable: true });
		Object.assign(move, { changedTouches: [{ identifier: 7 }] });
		document.dispatchEvent(move);
		assert.equal(move.defaultPrevented, false, action);
	}
});

test("mobile relocates only overflow inline controls without moving More, replacing nodes or changing settings", async (t) => {
	Platform.isMobile = true;
	document.body.classList.add("is-mobile");
	const h = mount(t);
	Platform.isMobile = false;
	await tick();
	onTestFinished(() => document.body.classList.remove("is-mobile"));
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => (item.id === "history" ? { ...item, placement: "more" } : item));
	h.component.refreshToolbar();
	await tick();
	const stored = structuredClone(h.plugin.settings.searchToolbar),
		row = h.target.querySelector(".finder"),
		target = h.target.querySelector(".nya-mobile-inline");
	assert.equal(
		window.getComputedStyle(row).display,
		"flex",
		"custom mobile toolbar has a measurable row, not display:contents",
	);
	let available = 248;
	row.getBoundingClientRect = () => ({ width: available });
	const buttons = [...h.target.querySelectorAll("[data-toolbar-action]")];
	for (const button of buttons) button.getBoundingClientRect = () => ({ width: 24 });
	const more = h.target.querySelector(".nya-toolbar-overflow");
	more.getBoundingClientRect = () => ({ width: 28 });
	const next = h.target.querySelector('[data-toolbar-action="next"]');
	next.focus();
	window.dispatchEvent(new window.Event("resize"));
	await settlePosition();
	assert.deepEqual(
		[...target.children].map((node) => node.dataset.toolbarAction),
		["next"],
	);
	assert.equal(document.activeElement, next);
	assert.equal(more.closest(".finder-act") !== null, true);
	const sameNext = target.querySelector('[data-toolbar-action="next"]');
	sameNext.click();
	await tick();
	assert.equal(h.component.getSearchCache().index, 1);
	available = 220;
	window.dispatchEvent(new window.Event("resize"));
	await settlePosition();
	assert.deepEqual(
		[...target.children].map((node) => node.dataset.toolbarAction),
		["previous", "next"],
	);
	assert.deepEqual(h.plugin.settings.searchToolbar, stored);
	// Keyed settings reorder while elements live outside their original parent.
	h.plugin.settings.searchToolbar = [...h.plugin.settings.searchToolbar].reverse();
	h.component.refreshToolbar();
	await settlePosition();
	assert.equal(h.target.querySelectorAll('[data-toolbar-action="next"]').length, 1);
	available = 500;
	window.dispatchEvent(new window.Event("resize"));
	await settlePosition();
	assert.equal(target.children.length, 0);
	assert.equal(h.target.querySelector('[data-toolbar-action="next"]'), sameNext);
	assert.equal(h.target.querySelectorAll("[data-toolbar-action]").length, buttons.length);
});

test("whole word toolbar toggle filters counts and synchronous replacement against the current document", async (t) => {
	const h = mount(t);
	await tick();
	h.view.editor.cm.state = EditorState.create({ doc: "cat cat2 cat_name xcat cat-dog" });
	h.component.matchAgain(false);
	assert.equal(h.component.getSearchCache().matches.length, 5);
	const button = h.target.querySelector('[aria-label="search.tip.MatchWholeWord"]');
	assert.equal(button.getAttribute("aria-pressed"), "false");
	button.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
	);
	await tick();
	assert.equal(button.getAttribute("aria-pressed"), "true");
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(document.activeElement, h.target.querySelector("textarea"));
	h.component.setVisible(false);
	h.view.editor.cm.dispatch({ changes: { from: 0, insert: "cat2 " } });
	const result = h.component.replaceAllMatchedText("dog");
	assert.equal(result.changeCount, 2);
	assert.equal(result.changed, true);
	assert.equal(h.view.editor.getValue(), "cat2 dog cat2 cat_name xcat dog-dog");
	assert.equal(h.specs.filter((spec) => spec instanceof stateModule.Transaction).length, 1);
});

test("whole word uses a pressed More button and hiding it does not reset the query option", async (t) => {
	const h = mount(t);
	await tick();
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => (item.id === "wholeWord" ? { ...item, placement: "more" } : item));
	h.component.refreshToolbar();
	await tick();
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	more.click();
	await tick();
	const option = h.target.querySelector('[data-overflow-action="wholeWord"]');
	assert.equal(option.getAttribute("aria-label"), "search.tip.MatchWholeWord");
	assert.equal(option.getAttribute("aria-pressed"), "false");
	option.click();
	await tick();
	assert.equal(h.component.getSearchCache().options.wholeWord, true);
	assert.equal(option.getAttribute("aria-pressed"), "true");
	assert.ok(h.target.querySelector(".nya-toolbar-menu"));
	h.plugin.settings.searchToolbar = h.plugin.settings.searchToolbar.map((item) =>
		item.id === "wholeWord" ? { ...item, placement: "hidden" } : item,
	);
	h.component.refreshToolbar();
	await tick();
	assert.equal(h.target.querySelector('[aria-label="search.tip.MatchWholeWord"]'), null);
	assert.equal(h.component.getSearchCache().options.wholeWord, true);
	h.component.resetAll();
	assert.equal(h.component.getSearchCache().options.wholeWord, false);
});

test("whole word changes replace pending editor queries and late results cannot publish", async (t) => {
	const matcher = delayedMatcher(),
		h = mount(t, matcher);
	await tick();
	h.component.toggleWholeWordMode();
	assert.equal(matcher.requests.length, 2);
	assert.equal(matcher.requests[1].options.wholeWord, true);
	matcher.requests[1].resolve({ ...matchedCats, matches: [matchedCats.matches[0]] });
	await settlePosition();
	const count = h.specs.length,
		scrolls = h.scrolls.length;
	matcher.requests[0].resolve(matchedCats);
	await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 1);
	assert.equal(h.specs.length, count);
	assert.equal(h.scrolls.length, scrolls);
});

test("finder initializes global default options once and keeps manual choices across close, file and mode changes", async (t) => {
	const h = mount(t, undefined, {
		defaultRegexMode: true,
		defaultCaseSensitive: true,
		defaultWholeWord: true,
	});
	assert.deepEqual(h.component.getSearchCache().options, {
		regexMode: true,
		caseSensitive: true,
		wholeWord: true,
	});
	await tick();
	h.target.querySelector('[aria-label="search.tip.UseRegularExpression"]').click();
	h.target.querySelector('[aria-label="search.tip.MatchCase"]').click();
	h.target.querySelector('[aria-label="search.tip.MatchWholeWord"]').click();
	assert.deepEqual(h.component.getSearchCache().options, {
		regexMode: false,
		caseSensitive: false,
		wholeWord: false,
	});
	h.component.setVisible(false);
	h.component.setVisible(true);
	h.view.file = { path: "b.md" };
	h.component.matchAgain(false);
	h.view.getMode = () => "preview";
	h.component.setCollapse(false);
	h.view.getMode = () => "source";
	h.component.matchAgain(false);
	h.component.refreshToolbar();
	assert.deepEqual(h.component.getSearchCache().options, {
		regexMode: false,
		caseSensitive: false,
		wholeWord: false,
	});
	h.plugin.settings.defaultRegexMode = false;
	h.plugin.settings.defaultCaseSensitive = false;
	h.plugin.settings.defaultWholeWord = false;
	h.component.toggleRegexMode();
	h.component.toggleMatchCaseMode();
	h.component.toggleWholeWordMode();
	h.component.refreshToolbar();
	assert.deepEqual(h.component.getSearchCache().options, {
		regexMode: true,
		caseSensitive: true,
		wholeWord: true,
	});
	const fresh = mount(t, undefined, h.plugin.settings);
	assert.deepEqual(fresh.component.getSearchCache().options, {
		regexMode: false,
		caseSensitive: false,
		wholeWord: false,
	});
	assert.deepEqual(
		h.component.getSearchCache().options,
		{ regexMode: true, caseSensitive: true, wholeWord: true },
		"same-file owners stay independent",
	);
});

function delayedMatcher() {
	const requests = [];
	return {
		requests,
		cancel() {
			this.cancels = (this.cancels ?? 0) + 1;
		},
		destroy() {},
		match(source, query, options, ranges) {
			const pending = deferred();
			requests.push({ source, query, options, ranges, ...pending });
			return pending.promise;
		},
	};
}
const matchedCats = {
	status: "completed",
	synchronous: false,
	matches: [
		{ from: 0, to: 3, index: 0 },
		{ from: 4, to: 7, index: 1 },
	],
};

function replacementMatcher() {
	const matcher = delayedMatcher();
	matcher.replacements = [];
	matcher.replace = (source, query, replacement, options, index, all, ranges) => {
		const pending = deferred();
		matcher.replacements.push({
			source,
			query,
			replacement,
			options,
			index,
			all,
			ranges,
			...pending,
		});
		return pending.promise;
	};
	return matcher;
}
const candidates = (insert = "cat!", all = false) => ({
	...matchedCats,
	changes: all
		? [
				{ from: 0, to: 3, insert },
				{ from: 4, to: 7, insert },
			]
		: [{ from: 0, to: 3, insert }],
});
async function mountReplacement(t) {
	const matcher = replacementMatcher(),
		h = mount(t, matcher);
	matcher.requests[0].resolve(matchedCats);
	await settlePosition();
	setReplacement(h, "cat!");
	return { ...h, matcher };
}

test("global escape changes cancel pending replacements even after applying a legacy preset", async (t) => {
	const h = await mountReplacement(t);
	h.plugin.settings.useEscapeCharInReplace = false;
	h.component.applyRecipe({
		search: "cat",
		options: { regexMode: true, caseSensitive: false, wholeWord: false },
		replacement: { text: "\\n", interpretEscapes: false },
	});
	const pending = h.component.replaceOnce();
	assert.equal(h.matcher.replacements[0].replacement, "\\n");
	h.plugin.settings.useEscapeCharInReplace = true;
	h.matcher.replacements[0].resolve(candidates("\\n"));
	const result = await pending;
	assert.equal(result.status, "cancelled");
	assert.equal(result.changed, false);
	assert.equal(h.view.editor.getValue(), "cat cat");
	assert.equal(h.specs.filter((spec) => spec.changes).length, 0);
});

test("escape preference notifications immediately cancel candidates and changing back cannot revive them", async (t) => {
	const h = await mountReplacement(t);
	h.plugin.settings.useEscapeCharInReplace = false;
	h.component.applyRecipe({
		search: "cat",
		options: { regexMode: true, caseSensitive: false, wholeWord: false },
		replacement: { text: "\\n", interpretEscapes: false },
	});
	const pending = h.component.replaceOnce();
	let cancels = 0;
	const cancel = h.matcher.cancel.bind(h.matcher);
	h.matcher.cancel = () => {
		cancels++;
		cancel();
	};
	h.plugin.settings.useEscapeCharInReplace = true;
	h.component.replacementPreferencesChanged();
	assert.equal(cancels, 1);
	h.plugin.settings.useEscapeCharInReplace = false;
	h.component.replacementPreferencesChanged();
	h.matcher.replacements[0].resolve(candidates("\\n"));
	assert.equal((await pending).changed, false);
	assert.equal(h.view.editor.getValue(), "cat cat");
});

for (const action of ["reselect", "clear", "close", "edit"]) {
	test(`pending scoped replacement cannot commit after ${action}`, async (t) => {
		const h = await mountReplacement(t);
		selectScope(h, [{ from: 4, to: 7 }]);
		h.component.findInSelection();
		const pending = h.component.replaceOnce();
		assert.deepEqual(h.matcher.replacements[0].ranges, [{ from: 4, to: 7 }]);
		if (action === "reselect") {
			selectScope(h, [{ from: 0, to: 3 }]);
			h.component.findInSelection();
		}
		if (action === "clear") h.component.toggleFindInSelection();
		if (action === "close") h.component.setVisible(false);
		if (action === "edit") h.view.editor.cm.dispatch({ changes: { from: 0, insert: "x" } });
		h.matcher.replacements[0].resolve({
			...matchedCats,
			matches: [{ from: 4, to: 7, index: 0 }],
			changes: [{ from: 4, to: 7, insert: "dog" }],
		});
		assert.equal((await pending).changed, false);
		assert.equal(h.view.editor.getValue(), action === "edit" ? "xcat cat" : "cat cat");
	});
}

test("pending scoped query cannot publish after the same range is captured again", async (t) => {
	const matcher = delayedMatcher(),
		h = mount(t, matcher, {}, false);
	await tick();
	h.component.setFindText("cat", false);
	const unscoped = matcher.requests.length;
	selectScope(h, [{ from: 4, to: 7 }]);
	h.component.findInSelection();
	const old = matcher.requests[unscoped];
	h.component.findInSelection();
	old.resolve(matchedCats);
	await settlePosition();
	assert.deepEqual(h.component.getSearchCache().matches, []);
	matcher.requests[unscoped + 1].resolve({
		...matchedCats,
		matches: [{ from: 4, to: 7, index: 0 }],
	});
	await settlePosition();
	assert.deepEqual(h.component.getSearchCache().matches, [{ from: 4, to: 7, index: 0 }]);
});

test("scoped replacement rejects out-of-range candidates even from a custom executor", async (t) => {
	const h = await mountReplacement(t);
	selectScope(h, [{ from: 4, to: 7 }]);
	h.component.findInSelection();
	const pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates("dog"));
	const result = await pending;
	assert.equal(result.changed, false);
	assert.equal(result.status, "failed");
	assert.equal(h.view.editor.getValue(), "cat cat");
});

test("same-file owners retain independent scopes and destroying one releases only its scope", async (t) => {
	const a = mount(t),
		b = mount(t);
	await tick();
	b.view.file = a.view.file;
	selectScope(a, [{ from: 0, to: 3 }]);
	selectScope(b, [{ from: 4, to: 7 }]);
	a.component.findInSelection();
	b.component.findInSelection();
	a.component.destroy();
	assert.equal(a.view.editor.cm.state.field(searchScopeField).ranges, null);
	b.component.replaceAllMatchedText("dog");
	assert.equal(b.view.editor.getValue(), "cat dog");
});

test("async replacement commits once, tolerates own editor events, then waits for rematch and positioning before advance", async (t) => {
	const h = await mountReplacement(t),
		mode = deferred();
	h.view.setState = () => mode.promise;
	const original = h.view.editor.cm.dispatch;
	h.view.editor.cm.dispatch = function (spec) {
		original.call(this, spec);
		if (spec.changes) h.component.matchAgain(false);
	};
	const pending = h.component.replaceOnce();
	assert.equal(h.view.editor.getValue(), "cat cat");
	h.component.matchAgain(false);
	assert.equal(h.matcher.replacements.length, 1);
	h.matcher.replacements[0].resolve(candidates());
	const result = await pending;
	assert.equal(result.changed, true);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.matcher.requests.length, 2);
	assert.equal(h.component.getSearchCache().index, 0);
	h.matcher.requests[1].resolve({
		...matchedCats,
		matches: [
			{ from: 0, to: 3, index: 0 },
			{ from: 5, to: 8, index: 1 },
		],
	});
	await settlePosition();
	assert.equal(h.component.getSearchCache().index, 0);
	mode.resolve();
	assert.equal(await result.navigationCompletion, true);
	await settlePosition();
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
	assert.equal(result.afterCount, 2);
});

test("all replacement is one immutable CodeMirror transaction with inverse undo/redo", async (t) => {
	const h = await mountReplacement(t),
		before = h.view.editor.cm.state.doc;
	const pending = h.component.replaceAllMatchedText("dog");
	h.matcher.replacements[0].resolve(candidates("dog", true));
	const result = await pending;
	assert.equal(result.changeCount, 2);
	assert.equal(h.view.editor.getValue(), "dog dog");
	const changes = h.specs.filter((spec) => spec.changes);
	assert.equal(changes.length, 1);
	const transaction = EditorState.create({ doc: before }).update(changes[0]);
	const undone = transaction.state.update({ changes: transaction.changes.invert(before) }).state;
	assert.equal(undone.doc.toString(), "cat cat");
	assert.equal(undone.update({ changes: transaction.changes }).state.doc.toString(), "dog dog");
	h.matcher.requests[1].resolve({ ...matchedCats, matches: [] });
	await result.navigationCompletion;
	assert.equal(result.afterCount, 0);
	assert.equal(h.component.getSearchCache().index, 0);
});

for (const [name, invalidate] of [
	[
		"query away and back",
		(h) => {
			h.component.setFindText("dog", false);
			h.component.setFindText("cat", false);
		},
	],
	[
		"option change",
		(h) => {
			h.component.toggleRegexMode(false);
		},
	],
	[
		"whole word identity change",
		(h) => {
			h.component.toggleWholeWordMode(false);
		},
	],
	[
		"whole word toggle away and back",
		(h) => {
			h.component.toggleWholeWordMode();
			h.component.toggleWholeWordMode();
		},
	],
	[
		"document edit",
		(h) => {
			h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } });
			h.component.matchAgain(false);
		},
	],
	[
		"equal-text new doc",
		(h) => {
			h.view.editor.cm.state = EditorState.create({ doc: "cat cat" });
		},
	],
	[
		"file identity",
		(h) => {
			h.view.file = { path: "a.md" };
		},
	],
	[
		"file rename",
		(h) => {
			h.view.file.path = "renamed.md";
		},
	],
	["navigation", (h) => h.component.toNextMatch()],
	[
		"editor rebuild",
		(h) => {
			h.view.editor.cm = {
				state: EditorState.create({ doc: "cat cat" }),
				dispatch() {
					throw new Error("must not commit");
				},
			};
		},
	],
	[
		"mode switch",
		(h) => {
			h.view.getMode = () => "preview";
		},
	],
	[
		"close reopen",
		(h) => {
			h.component.setVisible(false);
			h.component.setVisible(true);
		},
	],
	[
		"replace input",
		(h) => {
			setReplacement(h, "different");
		},
	],
	[
		"escape setting",
		(h) => {
			h.plugin.settings.useEscapeCharInReplace = true;
		},
	],
	["dispose", (h) => h.component.destroy()],
]) {
	test(`replacement candidates never commit after ${name}`, async (t) => {
		const h = await mountReplacement(t);
		const pending = h.component.replaceOnce();
		invalidate(h);
		const count = h.specs.filter((spec) => spec.changes).length;
		h.matcher.replacements[0].resolve(candidates());
		const result = await pending;
		assert.equal(result.changed, false);
		assert.equal(result.status, "cancelled");
		assert.equal(h.specs.filter((spec) => spec.changes).length, count);
	});
}

test("latest replacement request wins; repeated input cannot commit two stale writes", async (t) => {
	const h = await mountReplacement(t),
		first = h.component.replaceOnce(),
		second = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates());
	assert.equal((await first).changed, false);
	h.matcher.replacements[1].resolve(candidates());
	const result = await second;
	assert.equal(result.changed, true);
	assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
	h.matcher.requests[1].resolve(matchedCats);
	await result.navigationCompletion;
});

test("pre-commit replacement failure can be explicitly sync retried without an automatic write", async (t) => {
	const h = await mountReplacement(t);
	const pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve({ status: "failed", error: new Error("Worker failed") });
	const result = await pending;
	await settlePosition();
	assert.equal(result.changed, false);
	assert.equal(h.view.editor.getValue(), "cat cat");
	const sync = [...h.target.querySelectorAll(".nya-search-status button")].find(
		(button) => button.textContent === "search.SynchronousRetry",
	);
	assert.ok(sync);
	sync.click();
	await settlePosition();
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
});

test("post-commit Worker failure reports applied edit and retry only searches, never replays replacement", async (t) => {
	const h = await mountReplacement(t),
		errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	const pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates());
	const result = await pending;
	h.matcher.requests[1].resolve({ status: "failed", error: new Error("post-commit crash") });
	assert.equal(await result.navigationCompletion, false);
	await settlePosition();
	assert.equal(result.changed, true);
	assert.equal(result.navigationFailed, true);
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
	assert.equal(
		h.target.querySelector(".nya-search-status span").textContent,
		"search.ReplacedNavigationFailed",
	);
	const retry = [...h.target.querySelectorAll(".nya-search-status button")].find(
		(button) => button.textContent === "search.Retry",
	);
	retry.click();
	await settlePosition();
	assert.equal(h.matcher.replacements.length, 1);
	assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
});

test("escape preference changes after commit preserve rematching without replaying the edit", async (t) => {
	const h = await mountReplacement(t);
	const pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates());
	const result = await pending;
	h.plugin.settings.useEscapeCharInReplace = !h.plugin.settings.useEscapeCharInReplace;
	h.component.replacementPreferencesChanged();
	h.matcher.requests[1].resolve({
		...matchedCats,
		matches: [
			{ from: 0, to: 3, index: 0 },
			{ from: 5, to: 8, index: 1 },
		],
	});
	assert.equal(await result.navigationCompletion, true);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.matcher.replacements.length, 1);
	assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
});

test("closing after commit cancels rematch navigation but retains exactly one applied change", async (t) => {
	const h = await mountReplacement(t),
		pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates());
	const result = await pending;
	h.component.setVisible(false);
	const count = h.specs.length;
	h.matcher.requests[1].resolve(matchedCats);
	assert.equal(await result.navigationCompletion, false);
	await settlePosition();
	assert.equal(h.specs.length, count);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.component.getSearchCache().index, 0);
});

test("hidden replacement recomputes doc through Worker and preserves hidden next-match behavior", async (t) => {
	const h = await mountReplacement(t);
	h.component.setVisible(false);
	const pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates());
	const result = await pending;
	h.matcher.requests[1].resolve({
		...matchedCats,
		matches: [
			{ from: 0, to: 3, index: 0 },
			{ from: 5, to: 8, index: 1 },
		],
	});
	assert.equal(await result.navigationCompletion, true);
	assert.equal(h.component.isVisible(), false);
	assert.equal(h.component.getSearchCache().index, 1);
});

test("replace textarea input cancels pending Worker candidates even if user changes away and back", async (t) => {
	const h = await mountReplacement(t),
		pending = h.component.replaceOnce();
	const input = h.target.querySelector(".replacer textarea");
	input.value = "other";
	input.dispatchEvent(new window.Event("input"));
	input.value = "cat!";
	input.dispatchEvent(new window.Event("input"));
	h.matcher.replacements[0].resolve(candidates());
	assert.equal((await pending).changed, false);
	assert.equal(h.view.editor.getValue(), "cat cat");
});

test("production Worker drives single and all component replacements including post-commit rematch", async (t) => {
	const host = installWorkerHost(window),
		engine = new MatchEngine(() => window);
	onTestFinished(async () => {
		engine.destroy();
		await host.dispose();
		delete window.Worker;
	});
	const h = mount(t, engine),
		initial = engine.pending;
	await new Promise((resolve) => {
		const original = initial.resolve;
		initial.resolve = (value) => {
			original(value);
			resolve();
		};
	});
	await settlePosition();
	setReplacement(h, "cat!");
	const one = await h.component.replaceOnce();
	assert.equal(one.changed, true);
	assert.equal(await one.navigationCompletion, true);
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	const all = await h.component.replaceAllMatchedText("dog");
	assert.equal(all.changeCount, 2);
	assert.equal(await all.navigationCompletion, true);
	assert.equal(h.view.editor.getValue(), "dog! dog");
	assert.equal(all.afterCount, 0);
	assert.equal(host.workers.length, 1, "idle Worker reused across match/replace/rematch");
	assert.equal(h.specs.filter((spec) => spec.changes).length, 2);
	h.component.setVisible(false);
	assert.equal(host.blobs.size, 0);
});

test("production Worker whole word filters both single and all replacements and post-commit counts", async (t) => {
	const host = installWorkerHost(window),
		engine = new MatchEngine(() => window);
	onTestFinished(async () => {
		engine.destroy();
		await host.dispose();
		delete window.Worker;
	});
	const h = mount(t, engine, { defaultWholeWord: true }),
		initial = engine.pending;
	await new Promise((resolve) => {
		const original = initial.resolve;
		initial.resolve = (value) => {
			original(value);
			resolve();
		};
	});
	await settlePosition();
	h.view.editor.cm.state = EditorState.create({ doc: "cat2 cat cat_name cat" });
	setReplacement(h, "dog");
	const one = await h.component.replaceOnce();
	assert.equal(one.changeCount, 1);
	assert.equal(one.beforeCount, 2);
	await one.navigationCompletion;
	assert.equal(one.afterCount, 1);
	assert.equal(h.view.editor.getValue(), "cat2 dog cat_name cat");
	const all = await h.component.replaceAllMatchedText("dog");
	await all.navigationCompletion;
	assert.equal(all.changeCount, 1);
	assert.equal(all.afterCount, 0);
	assert.equal(h.view.editor.getValue(), "cat2 dog cat_name dog");
});

test("post-commit host positioning rejection never advances and keeps applied write", async (t) => {
	const h = await mountReplacement(t),
		position = deferred(),
		errors = [];
	h.view.setState = () => position.promise;
	h.plugin.reportError = (key) => errors.push(key);
	const pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates());
	const result = await pending;
	h.matcher.requests[1].resolve(matchedCats);
	await settlePosition();
	position.reject(new Error("host rejected"));
	assert.equal(await result.navigationCompletion, false);
	assert.equal(result.changed, true);
	assert.equal(h.component.getSearchCache().index, 0);
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
});

test("normal replacement retry recomputes candidates in Worker and does not silently become find-only", async (t) => {
	const h = await mountReplacement(t),
		pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve({ status: "failed", error: "crash" });
	await pending;
	await settlePosition();
	const button = [...h.target.querySelectorAll(".nya-search-status button")].find(
		(button) => button.textContent === "search.Retry",
	);
	button.click();
	assert.equal(h.matcher.replacements.length, 2);
	assert.equal(h.view.editor.getValue(), "cat cat");
	h.matcher.replacements[1].resolve(candidates());
	await settlePosition();
	assert.equal(h.view.editor.getValue(), "cat! cat");
	h.matcher.requests[1].resolve(matchedCats);
	await settlePosition();
});

for (const [name, invalidate] of [
	[
		"document edit",
		(h) => {
			h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } });
			h.component.matchAgain(false);
		},
	],
	["query change", (h) => h.component.setFindText("dog", false)],
	["whole word toggle", (h) => h.component.toggleWholeWordMode()],
	[
		"file change",
		(h) => {
			h.view.file = { path: "b.md" };
			h.component.matchAgain(false);
		},
	],
	[
		"editor rebuild",
		(h) => {
			h.view.editor.cm = { state: EditorState.create({ doc: "cat! cat" }), dispatch() {} };
			h.component.matchAgain(false);
		},
	],
	["destroy", (h) => h.component.destroy()],
]) {
	test(`post-commit rematch completion is inert after ${name}`, async (t) => {
		const h = await mountReplacement(t),
			pending = h.component.replaceOnce();
		h.matcher.replacements[0].resolve(candidates());
		const result = await pending;
		invalidate(h);
		const specs = h.specs.length,
			scrolls = h.scrolls.length;
		h.matcher.requests[1].resolve(matchedCats);
		assert.equal(await result.navigationCompletion, false);
		await settlePosition();
		assert.equal(result.changed, true);
		assert.equal(h.specs.length, specs);
		assert.equal(h.scrolls.length, scrolls);
	});
}

test("same-file split owners calculate and commit independent replacement requests", async (t) => {
	const a = await mountReplacement(t),
		b = await mountReplacement(t);
	b.view.file = a.view.file;
	const first = a.component.replaceOnce(),
		second = b.component.replaceAllMatchedText("dog");
	b.matcher.replacements[0].resolve(candidates("dog", true));
	const secondResult = await second;
	a.matcher.replacements[0].resolve(candidates());
	const firstResult = await first;
	assert.equal(a.view.editor.getValue(), "cat! cat");
	assert.equal(b.view.editor.getValue(), "dog dog");
	a.matcher.requests[1].resolve(matchedCats);
	b.matcher.requests[1].resolve({ ...matchedCats, matches: [] });
	assert.equal(await firstResult.navigationCompletion, true);
	assert.equal(await secondResult.navigationCompletion, true);
	assert.equal(a.specs.filter((spec) => spec.changes).length, 1);
	assert.equal(b.specs.filter((spec) => spec.changes).length, 1);
});

test("host exception after commit is reported as an applied edit and never offers write replay", async (t) => {
	const h = await mountReplacement(t),
		original = h.view.editor.cm.dispatch,
		errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.view.editor.cm.dispatch = function (spec) {
		original.call(this, spec);
		if (spec.changes) throw new Error("post-commit host event failed");
	};
	const pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates());
	const result = await pending;
	assert.equal(result.changed, true);
	assert.equal(result.changeCount, 1);
	assert.equal(result.status, "failed");
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
	await settlePosition();
	const retry = [...h.target.querySelectorAll(".nya-search-status button")].find(
		(button) => button.textContent === "search.Retry",
	);
	retry.click();
	assert.equal(h.matcher.replacements.length, 1);
});

test("post-commit effect failure cannot masquerade as an uncommitted replacement", async (t) => {
	const h = await mountReplacement(t),
		original = h.view.editor.cm.dispatch,
		errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.view.editor.cm.dispatch = function (spec) {
		if (!spec.changes) throw new Error("effect failed");
		original.call(this, spec);
	};
	const pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates());
	const result = await pending;
	assert.equal(result.changed, true);
	assert.equal(result.status, "failed");
	assert.equal(result.navigationFailed, true);
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
	assert.equal(h.view.editor.getValue(), "cat! cat");
});

test("production controller sync compatibility preserves single-replace advancement and all-replace semantics", async (t) => {
	const engine = new MatchEngine(() => window);
	onTestFinished(() => engine.destroy());
	const h = mount(t, engine);
	setReplacement(h, "cat!");
	const one = h.component.replaceOnce();
	assert.ok(!(one instanceof Promise));
	assert.equal(one.changed, true);
	assert.equal(one.afterCount, 2);
	assert.equal(h.component.getSearchCache().index, 1);
	const all = h.component.replaceAllMatchedText("dog");
	assert.equal(all.changed, true);
	assert.equal(h.view.editor.getValue(), "dog! dog");
	assert.equal(all.afterCount, 0);
});

test("regex replacement input escapes are decoded once before candidate transport", async (t) => {
	const h = await mountReplacement(t);
	h.plugin.settings.useEscapeCharInReplace = true;
	h.component.toggleRegexMode(false);
	const pending = h.component.replaceAllMatchedText("$&\\n\\t\\\\n\0");
	assert.equal(h.matcher.replacements[0].replacement, "$&\n\t\\n\0");
	h.matcher.replacements[0].resolve({ status: "cancelled" });
	assert.equal((await pending).changed, false);
});

test("asynchronous editor find preserves queued user navigation across background refresh", async (t) => {
	const matcher = delayedMatcher(),
		h = mount(t, matcher);
	await tick();
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "…");
	h.component.toNextMatch();
	h.component.matchAgain(false);
	h.component.toNextMatch();
	h.component.toPreviousMatch();
	assert.equal(matcher.requests.length, 1);
	matcher.requests[0].resolve(matchedCats);
	await settlePosition();
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.scrolls.at(-1).from, 4);
	assert.equal(h.component.getSearchCache().matches.length, 2);
});

for (const [name, invalidate] of [
	[
		"query away and back",
		(h) => {
			h.component.setFindText("dog", false);
			h.component.setFindText("cat", false);
		},
	],
	[
		"document identity",
		(h) => h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } }),
	],
	[
		"file identity",
		(h) => {
			h.view.file = { path: "other.md" };
		},
	],
	[
		"editor rebuild",
		(h) => {
			h.view.editor.cm = {
				state: EditorState.create({ doc: "cat cat" }),
				dispatch() {
					throw new Error("old result dispatched");
				},
			};
		},
	],
	[
		"close/reopen",
		(h) => {
			h.component.setVisible(false);
			h.component.setVisible(true, "cat");
		},
	],
	["destroy", (h) => h.component.destroy()],
]) {
	test(`asynchronous editor result is rejected after ${name}`, async (t) => {
		const matcher = delayedMatcher(),
			h = mount(t, matcher);
		await tick();
		invalidate(h);
		const before = h.specs.length,
			scrolls = h.scrolls.length;
		matcher.requests[0].resolve(matchedCats);
		await settlePosition();
		assert.equal(h.specs.length, before);
		assert.equal(h.scrolls.length, scrolls);
	});
}

test("Worker execution failure is visible and sync retry requires explicit user action", async (t) => {
	const matcher = delayedMatcher(),
		h = mount(t, matcher);
	matcher.requests[0].resolve({ status: "failed", error: new Error("Worker crash") });
	await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 0);
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "!");
	assert.equal(
		h.target.querySelector(".nya-search-status span").textContent,
		"search.WorkerFailed",
	);
	const retry = [...h.target.querySelectorAll(".nya-search-status button")].find(
		(button) => button.textContent === "search.SynchronousRetry",
	);
	assert.ok(retry);
	assert.equal(matcher.requests.length, 1);
	retry.click();
	await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(matcher.requests.length, 1);
});

test("production Worker computes actual component matches and closing terminates owned resources", async (t) => {
	const host = installWorkerHost(window),
		engine = new MatchEngine(() => window);
	onTestFinished(async () => {
		engine.destroy();
		await host.dispose();
		delete window.Worker;
	});
	const h = mount(t, engine);
	// Await the exact controller result without introducing a sleep-based test.
	const result = engine.pending;
	assert.ok(result);
	await new Promise((resolve) => {
		const original = result.resolve;
		result.resolve = (value) => {
			original(value);
			resolve();
		};
	});
	await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	h.component.setVisible(false);
	assert.equal(host.blobs.size, 0);
	assert.equal(host.workers[0].terminated, true);
});

test("reading async match retains navigation, caches offsets and maps detached endpoints", async (t) => {
	const matcher = delayedMatcher(),
		h = mountReading(t, matcher);
	await tick();
	assert.equal(matcher.requests.length, 1);
	h.component.toNextMatch();
	h.component.matchAgain(false);
	h.component.toNextMatch();
	const source = matcher.requests[0].source;
	matcher.requests[0].resolve({
		status: "completed",
		synchronous: false,
		matches: helper.findTextOffsets(source, "cat", false, false),
	});
	await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 3);
	assert.equal(h.component.getSearchCache().index, 2);
	assert.equal(h.scrolls.at(-1), h.sections[1]);
	h.component.toPreviousMatch();
	await settlePosition();
	assert.equal(matcher.requests.length, 1);
});

test("reading async result cannot paint or scroll a mutated DOM index", async (t) => {
	const matcher = delayedMatcher(),
		h = mountReading(t, matcher);
	await tick();
	h.sections[0].el.querySelector("p").textContent = "dog";
	matcher.requests[0].resolve(matchedCats);
	await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 0);
	assert.equal(h.scrolls.length, 0);
	assert.equal(window.CSS.highlights.has("nya-reading-current"), false);
});

test("reading Worker execution error offers explicit synchronous retry without automatic replay", async (t) => {
	const matcher = delayedMatcher(),
		h = mountReading(t, matcher);
	matcher.requests[0].resolve({ status: "failed", error: new Error("Worker crash") });
	await settlePosition();
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "!");
	const retry = [...h.target.querySelectorAll(".nya-search-status button")].find(
		(button) => button.textContent === "search.SynchronousRetry",
	);
	assert.ok(retry);
	retry.click();
	await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 3);
	assert.equal(matcher.requests.length, 1);
});

test("reading query supersession and close refuse old worker offsets and endpoint mapping", async (t) => {
	const matcher = delayedMatcher(),
		h = mountReading(t, matcher);
	await tick();
	h.component.setFindText("tail", false);
	const old = matcher.requests[0];
	old.resolve(matchedCats);
	await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 0);
	h.component.setVisible(false);
	matcher.requests[1].resolve(matchedCats);
	await settlePosition();
	assert.equal(window.CSS.highlights.has("nya-reading-matches"), false);
	assert.equal(h.scrolls.length, 0);
});

test("async replacement positioning commits once and advances only after success", async (t) => {
	const h = mount(t);
	await tick();
	const position = deferred();
	setReplacement(h, "cat!");
	h.view.setState = () => position.promise;
	const result = h.component.replaceOnce();
	assert.equal(result.changed, true);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.component.getSearchCache().index, 0);
	position.resolve();
	assert.equal(await result.navigationCompletion, true);
	await settlePosition();
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
});

test("async replacement mode rejection prevents additional navigation and reports committed edit", async (t) => {
	const h = mount(t);
	await tick();
	const position = deferred();
	const errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	setReplacement(h, "cat!");
	h.view.setState = () => position.promise;
	const result = h.component.replaceOnce();
	position.reject(new Error("host rejected"));
	assert.equal(await result.navigationCompletion, false);
	await settlePosition();
	assert.equal(result.changed, true);
	assert.equal(result.navigationFailed, true);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.component.getSearchCache().index, 0);
	assert.equal(h.scrolls.length, 1);
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
});

for (const [name, invalidate] of [
	[
		"close and reopen",
		(h) => {
			h.component.setVisible(false);
			h.view.setState = () => {};
			h.component.setVisible(true, "cat");
		},
	],
	[
		"query changes away and back",
		(h) => {
			h.component.setFindText("dog", false);
			h.component.setFindText("cat", false);
		},
	],
	[
		"document edit",
		(h) => h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } }),
	],
	[
		"file switch",
		(h) => {
			h.view.file = { path: "b.md" };
		},
	],
	["unload", (h) => h.component.destroy()],
]) {
	test(`late async replacement position is inert after ${name}`, async (t) => {
		const h = mount(t);
		await tick();
		const position = deferred();
		setReplacement(h, "cat!");
		h.view.setState = () => position.promise;
		const result = h.component.replaceOnce();
		invalidate(h);
		const count = h.specs.length;
		const scrolls = h.scrolls.length;
		position.resolve();
		assert.equal(await result.navigationCompletion, false);
		await settlePosition();
		assert.equal(h.specs.length, count);
		assert.equal(h.scrolls.length, scrolls);
		assert.equal(
			h.specs.filter(
				(spec) =>
					spec instanceof stateModule.Transaction &&
					spec.newDoc.toString().includes("cat!"),
			).length,
			1,
		);
	});
}

test("out-of-order same-query navigation only selects the newest requested match", async (t) => {
	const h = mount(t);
	await tick();
	const first = deferred(),
		second = deferred();
	let calls = 0;
	h.view.setState = () => (++calls === 1 ? first : second).promise;
	h.component.toNextMatch();
	h.component.toPreviousMatch();
	const count = h.specs.length;
	second.resolve();
	await settlePosition();
	assert.equal(h.specs.at(-1).selection.anchor, 0);
	const selected = h.specs.length;
	assert.equal(selected, count + 1);
	first.resolve();
	await settlePosition();
	assert.equal(h.specs.length, selected);
});

test("async mode rebuild refreshes matches without dispatching old coordinates or advancing", async (t) => {
	const h = mount(t);
	await tick();
	const position = deferred();
	setReplacement(h, "cat!");
	h.view.setState = () => position.promise;
	const result = h.component.replaceOnce();
	const old = h.view.editor.cm;
	let lateOldDispatch = 0;
	old.dispatch = () => lateOldDispatch++;
	h.view.editor.cm = {
		state: EditorState.create({ doc: "prefix cat! cat" }),
		dispatch(spec) {
			h.specs.push(spec);
			this.state = this.state.update({
				changes: spec.changes,
				selection: spec.selection,
			}).state;
		},
	};
	position.resolve();
	assert.equal(await result.navigationCompletion, false);
	await settlePosition();
	assert.equal(lateOldDispatch, 0);
	assert.equal(h.component.getSearchCache().index, 0);
	assert.equal(h.component.getSearchCache().matches[0].from, 7);
	assert.equal(h.specs.at(-1).selection, undefined);
});

test("late positioning rejection after destruction has no notice or editor effects", async (t) => {
	const h = mount(t);
	await tick();
	const position = deferred();
	const errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.view.setState = () => position.promise;
	setReplacement(h, "cat!");
	const result = h.component.replaceOnce();
	h.component.destroy();
	const count = h.specs.length;
	position.reject(new Error("late rejection"));
	assert.equal(await result.navigationCompletion, false);
	await settlePosition();
	assert.deepEqual(errors, []);
	assert.equal(h.specs.length, count);
});

test("hidden replacement retains safe async next-match behavior while the finder stays hidden", async (t) => {
	const h = mount(t);
	await tick();
	h.component.setVisible(false);
	const position = deferred();
	h.view.setState = () => position.promise;
	setReplacement(h, "cat!");
	const result = h.component.replaceOnce();
	assert.equal(h.view.editor.getValue(), "cat! cat");
	position.resolve();
	assert.equal(await result.navigationCompletion, true);
	await settlePosition();
	assert.equal(h.component.isVisible(), false);
	assert.equal(h.component.getSearchCache().index, 1);
});

function mountReading(t, matcher, settings = {}) {
	window.CSS = { highlights: new Map() };
	window.Highlight = class extends Set {
		priority = 0;
	};
	const target = document.createElement("div");
	const preview = document.createElement("div");
	target.append(preview);
	document.body.append(target);
	const sections = ["<p>cat <strong>CAT</strong></p>", "<p>tail cat</p>"].map((html) => {
		const el = document.createElement("div");
		el.innerHTML = html;
		return { el, rendered: true };
	});
	preview.append(sections[0].el);
	const scrolls = [];
	const renderer = {
		sections,
		previewEl: preview,
		text: "markdown",
		lastText: "markdown",
		parsing: false,
		rendered: null,
		showSection(section) {
			scrolls.push(section);
		},
		applyScrollSection(section) {
			this.target = section;
			return true;
		},
		updateVirtualDisplay() {
			if (this.target) preview.append(this.target.el);
		},
		onRendered() {},
	};
	const view = {
		containerEl: target,
		file: { path: "a.md" },
		getMode: () => "preview",
		previewMode: { renderer, containerEl: preview },
	};
	const plugin = {
		settings: {
			enableInputHotkeys: true,
			enableHistory: true,
			historyMaxCount: 10,
			searchHistory: [],
			...settings,
		},
		saveSettings: async () => {},
	};
	attachHistory(plugin);
	let component;
	const search = new ReadingSearch(
		view,
		() => true,
		() => component.matchAgain(false),
		5000,
		matcher,
	);
	component = createPanel(
		target,
		view,
		{
			plugin,
			getEditorContext: () => null,
			canSearchReading: () => true,
			getReadingSearch: () => search,
			clearReadingSearch: () => search.clear(),
		},
		"reading",
	);
	onTestFinished(() => {
		search.destroy();
		component.destroy();
		target.remove();
	});
	component.setVisible(true, "cat");
	scrolls.length = 0;
	return { component, target, preview, view, sections, plugin, scrolls, renderer, search };
}

test("reading edge collapse retains pending computation and highlights without late navigation", async (t) => {
	const matcher = delayedMatcher(),
		h = mountReading(t, matcher);
	await tick();
	h.component.toNextMatch();
	h.component.dockFinder();
	await tick();
	matcher.requests[0].resolve({
		...matchedCats,
		matches: [
			{ from: 0, to: 3, index: 0 },
			{ from: 4, to: 7, index: 1 },
			{ from: 13, to: 16, index: 2 },
		],
	});
	await settlePosition();
	assert.equal(h.scrolls.length, 0);
	assert.equal(h.component.getSearchCache().matches.length, 3);
	assert.equal(h.component.getSearchCache().index, 0);
	assert.ok(window.CSS.highlights.get("nya-reading-matches").size > 0);
	h.component.expandFinder();
	await tick();
	assert.notEqual(document.activeElement, h.target.querySelector("textarea"));
});

test("reading whole word control uses logical boundaries, not inline formatting boundaries", async (t) => {
	const h = mountReading(t);
	await tick();
	h.sections[0].el.innerHTML = "<p>ca<strong>t</strong> cat<span>2</span> xcat cat_name</p>";
	h.component.matchAgain(false);
	assert.equal(h.component.getSearchCache().matches.length, 5);
	h.target.querySelector('[aria-label="search.tip.MatchWholeWord"]').click();
	await tick();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(h.component.getSearchCache().options.wholeWord, true);
	h.component.toNextMatch();
	await tick();
	assert.equal(h.scrolls.at(-1), h.sections[1]);
});

test("reading finder initializes defaults and preserves manual options across actual mode changes", async (t) => {
	const h = mountReading(t, undefined, {
		defaultRegexMode: true,
		defaultCaseSensitive: true,
		defaultWholeWord: true,
	});
	await tick();
	assert.deepEqual(h.component.getSearchCache().options, {
		regexMode: true,
		caseSensitive: true,
		wholeWord: true,
	});
	assert.equal(h.component.getSearchCache().matches.length, 2);
	h.component.setFindText("c.t", false);
	await tick();
	assert.equal(
		h.component.getSearchCache().matches.length,
		2,
		"default regex is used by the reading matcher",
	);
	h.target.querySelector('[aria-label="search.tip.MatchCase"]').click();
	await tick();
	h.view.getMode = () => "source";
	h.component.matchAgain(false);
	await tick();
	h.view.getMode = () => "preview";
	h.component.matchAgain(false);
	await tick();
	h.component.setVisible(false);
	h.component.setVisible(true);
	await tick();
	assert.deepEqual(h.component.getSearchCache().options, {
		regexMode: true,
		caseSensitive: false,
		wholeWord: true,
	});
	assert.equal(h.component.getSearchCache().matches.length, 3);
});

test("reading SearchBox uses the same case/regex controls and navigates detached results", async (t) => {
	const h = mountReading(t);
	await tick();
	assert.equal(h.component.getSearchCache().matches.length, 3);
	assert.ok(h.target.querySelector(".nya-finder--reading"));
	assert.equal(window.getComputedStyle(h.target.querySelector(".main-part")).paddingLeft, "8px");
	assert.equal(h.target.querySelector('[aria-label="search.tip.ToggleReplace"]'), null);
	h.target.querySelector('[aria-label="search.tip.MatchCase"]').click();
	await tick();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	h.target.querySelector('[aria-label="search.tip.NextMatch"]').click();
	await tick();
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.scrolls.at(-1), h.sections[1]);
	assert.equal(h.sections[1].el.isConnected, true);
	h.component.setFindText("c.t", false);
	h.target.querySelector('[aria-label="search.tip.UseRegularExpression"]').click();
	await tick();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(h.plugin.settings.searchHistory[0].text, "cat");
});

test("reading history reuse counts once; hidden and replacement actions are safe", async (t) => {
	const h = mountReading(t);
	await tick();
	assert.equal(h.component.setVisibleFromHistory("CAT"), true);
	h.component.toNextMatch();
	assert.equal(h.plugin.settings.searchHistory[0].count, 1);
	const before = h.preview.innerHTML;
	const matches = h.component.getSearchCache().matches.length;
	assert.equal(h.component.replaceAllMatchedText("dog").changed, false);
	assert.equal(h.component.replaceOnce().changed, false);
	assert.equal(h.component.getSearchCache().matches.length, matches);
	assert.equal(h.preview.innerHTML, before);
	h.component.setVisible(false);
	assert.equal(window.CSS.highlights.has("nya-reading-matches"), false);
});

test("mode changes preserve the reading query/options, discard old results and clear highlights", async (t) => {
	const h = mountReading(t);
	await tick();
	assert.ok(h.target.querySelector(".nya-finder--reading"));
	assert.equal(window.getComputedStyle(h.target.querySelector(".main-part")).paddingLeft, "8px");
	h.target.querySelector('[aria-label="search.tip.MatchCase"]').click();
	h.view.getMode = () => "source";
	h.component.matchAgain(false);
	await tick();
	assert.equal(h.target.querySelector(".nya-finder--reading"), null);
	assert.equal(window.getComputedStyle(h.target.querySelector(".main-part")).paddingLeft, "0px");
	assert.ok(h.target.querySelector('[aria-label="search.tip.ToggleReplace"]'));
	assert.equal(h.component.getSearchCache().search, "cat");
	assert.equal(h.component.getSearchCache().options.caseSensitive, true);
	assert.equal(h.component.getSearchCache().matches.length, 0);
	assert.equal(window.CSS.highlights.has("nya-reading-matches"), false);
	h.view.getMode = () => "preview";
	h.component.matchAgain(false);
	await tick();
	assert.ok(h.target.querySelector(".nya-finder--reading"));
	assert.equal(window.getComputedStyle(h.target.querySelector(".main-part")).paddingLeft, "8px");
	assert.equal(h.target.querySelector('[aria-label="search.tip.ToggleReplace"]'), null);
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(h.component.getSearchCache().index, 0);
	assert.equal(
		h.scrolls.length,
		1,
		"background mode refresh adds no scroll beyond the case-toggle action",
	);
});

test("reading navigation keeps its direction while a background refresh waits for rendering", async (t) => {
	const h = mountReading(t);
	await tick();
	h.renderer.rendered = [];
	const callbacks = [];
	h.renderer.onRendered = (callback) => callbacks.push(callback);
	h.component.toNextMatch();
	h.component.matchAgain(false);
	h.renderer.rendered = null;
	callbacks.forEach((callback) => callback());
	await Promise.resolve();
	await tick();
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.scrolls.length, 1);
});

test("reading failures show an error and offer native fallback instead of no-results", async (t) => {
	const h = mountReading(t);
	await tick();
	h.renderer.showSection = () => {
		throw new Error("broken bridge");
	};
	h.component.toNextMatch();
	await tick();
	assert.ok(h.target.textContent.includes("search.ReadingFailed"));
	assert.ok(h.target.textContent.includes("search.UseNativeFind"));
	assert.equal(window.CSS.highlights.has("nya-reading-matches"), false);
});

test("actual SearchBox Enter binding navigates immediately and records exactly once", async (t) => {
	const h = mount(t);
	const input = h.target.querySelector("textarea");
	input.dispatchEvent(
		new window.KeyboardEvent("keydown", {
			key: "Enter",
			code: "Enter",
			bubbles: true,
			cancelable: true,
		}),
	);
	await tick();
	assert.equal(h.scrolls.length, 1);
	assert.deepEqual(h.scrolls[0], { from: 4, to: 7 });
	assert.equal(h.saves(), 1);
	assert.equal(h.plugin.settings.searchHistory.length, 1);
	assert.equal(h.plugin.settings.searchHistory[0].count, 1);
	assert.equal(h.component.getSearchCache().index, 1);
	h.resolve();
	await tick();
	assert.equal(h.scrolls.length, 1);
	assert.equal(h.saves(), 1);
});

test("actual SearchBox navigation buttons use the owner context and update result UI", async (t) => {
	const h = mount(t);
	h.target.querySelector('[aria-label="search.tip.NextMatch"]').click();
	await tick();
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.scrolls.length, 1);
	h.target.querySelector('[aria-label="search.tip.PreviousMatch"]').click();
	await tick();
	assert.equal(h.component.getSearchCache().index, 0);
	assert.equal(h.scrolls.length, 2);
});

for (const signal of ["isComposing", "composition events", "legacy 229"]) {
	for (const code of ["Enter", "NumpadEnter", "ArrowUp", "ArrowDown"]) {
		test(`IME ${signal}: search ${code} does not navigate or change history`, async (t) => {
			const h = mount(t);
			await tick();
			h.plugin.history.record("dog");
			const input = h.target.querySelector("textarea");
			input.selectionStart = 0;
			if (signal === "composition events")
				input.dispatchEvent(
					new window.CompositionEvent("compositionstart", { bubbles: true }),
				);
			const event = new window.KeyboardEvent("keydown", {
				key: code === "NumpadEnter" ? "Enter" : code,
				code,
				bubbles: true,
				cancelable: true,
				isComposing: signal === "isComposing",
				keyCode: signal === "legacy 229" ? 229 : 0,
			});
			const saves = h.saves();
			input.dispatchEvent(event);
			await tick();
			assert.equal(event.defaultPrevented, false);
			assert.equal(h.component.getSearchCache().search, "cat");
			assert.equal(h.component.getSearchCache().index, 0);
			assert.equal(h.scrolls.length, 0);
			assert.equal(h.saves(), saves);
			input.dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true }));
			input.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
			);
			await tick();
			assert.equal(h.component.getSearchCache().index, 1);
		});
	}
	for (const code of ["Enter", "NumpadEnter"]) {
		test(`IME ${signal}: replacement ${code} does not write until composition ends`, async (t) => {
			const h = mount(t);
			h.component.setCollapse(false);
			await tick();
			const input = h.target.querySelector(".replacer textarea");
			input.value = "DOG";
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
			if (signal === "composition events")
				input.dispatchEvent(
					new window.CompositionEvent("compositionstart", { bubbles: true }),
				);
			const event = new window.KeyboardEvent("keydown", {
				key: "Enter",
				code,
				bubbles: true,
				cancelable: true,
				isComposing: signal === "isComposing",
				keyCode: signal === "legacy 229" ? 229 : 0,
			});
			input.dispatchEvent(event);
			await tick();
			assert.equal(event.defaultPrevented, false);
			assert.equal(h.view.editor.getValue(), "cat cat");
			assert.equal(h.specs.filter((spec) => spec.changes).length, 0);
			input.dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true }));
			input.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Enter", code, bubbles: true }),
			);
			await tick();
			assert.equal(h.view.editor.getValue(), "DOG cat");
			assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
		});
	}
}

function replacementCommand(h) {
	const commands = new Map();
	h.plugin.addCommand = (command) => commands.set(command.id, command);
	h.plugin.registerEvent = () => {};
	h.plugin.app = { workspace: { on: () => {} } };
	const search = new EditorSearch(h.plugin);
	search.getCommandFinder = () => h.component;
	return () => commands.get("text-finder-replace").editorCallback(h.view.editor, h.view);
}

for (const { replacement, index = 0, query = "cat", content, next, scrollCount, range } of [
	{
		replacement: "cat!",
		content: "cat! cat",
		next: 1,
		scrollCount: 2,
		range: { from: 5, to: 8 },
	},
	{ replacement: "cat", content: "cat cat", next: 1, scrollCount: 2, range: { from: 4, to: 7 } },
	{ replacement: "DOG", content: "DOG cat", next: 0, scrollCount: 1, range: { from: 4, to: 7 } },
	{
		replacement: "cat!",
		index: 1,
		content: "cat cat!",
		next: 0,
		scrollCount: 2,
		range: { from: 0, to: 3 },
	},
	{ replacement: "DOG", query: "fox", content: "cat cat", next: 0, scrollCount: 0 },
]) {
	for (const entry of ["button", "Enter", "command"]) {
		test(`single replacement ${entry}: ${query} → ${replacement}, starting index ${index}`, async (t) => {
			const h = mount(t);
			h.component.setCollapse(false);
			await tick();
			h.component.setFindText(query, false);
			for (let step = 0; step < index; step++) h.component.toNextMatch();
			const input = h.target.querySelector(".replacer textarea");
			input.value = replacement;
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
			h.scrolls.length = 0;
			h.specs.length = 0;
			if (entry === "command") replacementCommand(h)();
			else if (entry === "Enter")
				input.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "Enter",
						code: "Enter",
						bubbles: true,
					}),
				);
			else h.target.querySelector('[aria-label="search.tip.Replace"]').click();
			await tick();
			assert.equal(h.view.editor.getValue(), content);
			assert.equal(h.component.getSearchCache().index, next);
			assert.equal(h.scrolls.length, scrollCount);
			assert.equal(h.specs.filter((spec) => spec.changes).length, query === "fox" ? 0 : 1);
			assert.deepEqual(h.scrolls.at(-1), range);
		});
	}
}

test("hidden Finder removes every control from tab order, rejects focus and restores selection on open", async (t) => {
	const h = mount(t);
	h.component.setCollapse(false);
	await tick();
	const root = h.target.querySelector(".nya-finder");
	const input = root.querySelector("textarea");
	input.focus();
	assert.equal(document.activeElement, input);
	h.component.setVisible(false);
	await tick();
	assert.equal(root.getAttribute("aria-hidden"), "true");
	assert.equal(window.getComputedStyle(root).visibility, "hidden");
	assert.ok(!root.contains(document.activeElement));
	for (const control of root.querySelectorAll('textarea, [role="button"], button')) {
		assert.equal(control.tabIndex, -1);
		control.focus();
		assert.ok(!root.contains(document.activeElement));
	}
	h.component.setVisible(true, "cat");
	assert.equal(document.activeElement, input, "opening must focus before the next Vue flush");
	await tick();
	assert.equal(root.getAttribute("aria-hidden"), "false");
	assert.equal(window.getComputedStyle(root).visibility, "visible");
	assert.equal(input.selectionStart, 0);
	assert.equal(input.selectionEnd, 3);
	assert.equal(input.tabIndex, 0);
	h.component.setCollapse(false);
	await tick();
	assert.equal(root.querySelector(".replacer textarea").tabIndex, 1);
	h.component.resetAll();
	await tick();
	assert.ok(!root.contains(document.activeElement));
	assert.equal(input.tabIndex, -1);
});

test("hiding Finder closes More without restoring focus into hidden controls", async (t) => {
	const h = mount(t);
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => ({ ...item, placement: "more" }));
	h.component.refreshToolbar();
	await tick();
	h.target.querySelector('[aria-label="search.tip.More"]').click();
	await tick();
	assert.ok(h.target.querySelector(".nya-toolbar-menu"));
	const menu = h.target.querySelector(".nya-toolbar-menu");
	assert.equal(menu.getAttribute("role"), "group");
	assert.equal(
		menu.hasAttribute("aria-label"),
		false,
		"panel container does not create a hover tooltip",
	);
	assert.equal(
		h.target.ownerDocument.getElementById(menu.getAttribute("aria-labelledby")),
		h.target.querySelector('[aria-label="search.tip.More"]'),
	);
	assert.ok(h.target.contains(document.activeElement));
	h.component.setVisible(false);
	await tick();
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), null);
	assert.ok(!h.target.contains(document.activeElement));
	assert.equal(h.target.querySelector('[aria-label="search.tip.More"]').tabIndex, -1);
});

test("reading Finder has no focusable hidden controls and reopens with the query selected", async (t) => {
	const h = mountReading(t);
	await tick();
	h.component.setVisible(false);
	await tick();
	const root = h.target.querySelector(".nya-finder");
	for (const control of root.querySelectorAll('textarea, [role="button"], button'))
		assert.equal(control.tabIndex, -1);
	h.component.setVisible(true, "cat");
	await tick();
	assert.equal(document.activeElement, root.querySelector("textarea"));
	assert.equal(root.querySelector("textarea").selectionEnd, 3);
});

test("exact query and whitespace queries are retained in actual input history", async (t) => {
	const h = mount(t);
	for (const query of [" cat ", "cat", " \n\t"]) {
		h.component.setFindText(query, false);
		h.component.toNextMatch();
	}
	assert.deepEqual(
		h.plugin.settings.searchHistory.map((i) => i.text).sort(),
		[" cat ", "cat", " \n\t"].sort(),
	);
});

test("A to B to A input cycle increments again with input-bound query state", async (t) => {
	const h = mount(t);
	const input = h.target.querySelector("textarea");
	const navigate = async (query) => {
		input.value = query;
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
		input.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
		);
		await tick();
	};
	await navigate("cat");
	await navigate("cat");
	assert.equal(h.plugin.settings.searchHistory.find((i) => i.text === "cat").count, 1);
	await navigate("dog");
	await navigate("cat");
	assert.equal(h.plugin.settings.searchHistory.find((i) => i.text === "cat").count, 2);
});

test("successful history reuse counts once and first navigation only updates time", async (t) => {
	const h = mount(t);
	h.plugin.history.record("cat");
	assert.equal(h.component.setVisibleFromHistory("cat"), true);
	assert.equal(h.plugin.settings.searchHistory[0].count, 2);
	h.component.toNextMatch();
	assert.equal(h.plugin.settings.searchHistory[0].count, 2);
	h.component.setVisibleFromHistory("cat");
	assert.equal(h.plugin.settings.searchHistory[0].count, 3);
});

test("programmatic selection query change resets usage cycle", async (t) => {
	const h = mount(t);
	h.component.toNextMatch();
	h.component.setVisible(true, "dog");
	h.component.toNextMatch();
	h.component.setVisible(true, "cat");
	h.component.toNextMatch();
	assert.equal(h.plugin.settings.searchHistory.find((i) => i.text === "cat").count, 2);
});

test("history reuse navigates from its new sorted position after usage reorders", async (t) => {
	const h = mount(t);
	h.plugin.settings.searchHistory = [
		{ text: "cat", count: 1, createdAt: 1, lastUsedAt: 1 },
		{ text: "dog", count: 1, createdAt: 2, lastUsedAt: 2 },
	];
	h.component.setVisibleFromHistory("cat");
	const input = h.target.querySelector("textarea");
	input.selectionStart = 0;
	input.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", bubbles: true }),
	);
	await tick();
	assert.equal(h.component.getSearchCache().search, "dog");
});

test("default toolbar keeps inline order and geometry with selection in More", async (t) => {
	const h = mount(t);
	await tick();
	assert.deepEqual(
		[...h.target.querySelectorAll('.finder-act [role="button"]')].map((el) =>
			el.getAttribute("aria-label"),
		),
		[
			"search.tip.UseRegularExpression",
			"search.tip.MatchCase",
			"search.tip.MatchWholeWord",
			"search.tip.PreviousMatch",
			"search.tip.NextMatch",
			"search.tip.More",
			"search.tip.Close",
		],
	);
	assert.ok(h.target.querySelector('[aria-label="search.tip.More"]'));
	const button = h.target.querySelector('[aria-label="search.tip.UseRegularExpression"]');
	const style = window.getComputedStyle(button);
	assert.equal(style.width, "24px");
	assert.equal(style.height, "24px");
	assert.equal(style.margin, "2px");
	assert.equal(style.padding, "4px");
	button.click();
	await tick();
	assert.ok(button.classList.contains("nya-btn--active"));
	assert.equal(button.getAttribute("aria-pressed"), "true");
	assert.equal(window.getComputedStyle(button).backgroundColor, "rgba(36, 137, 219, 0.51)");
	button.click();
	await tick();
	assert.ok(!button.classList.contains("nya-btn--active"));
});

test("mobile search actions size to their buttons rather than the old four-button width", async (t) => {
	const h = mount(t);
	await tick();
	document.body.classList.add("is-mobile");
	h.target.querySelector(".nya-finder").classList.add("nya-mobile");
	onTestFinished(() => document.body.classList.remove("is-mobile"));
	const style = window.getComputedStyle(h.target.querySelector(".finder-act"));
	assert.equal(style.width, "auto");
	assert.equal(style.flexShrink, "0");
	assert.equal(window.getComputedStyle(h.target.querySelector(".replacer-act")).width, "112px");
});

test("configured toolbars update immediately, More toggles preserve state and Escape does not close Finder", async (t) => {
	const h = mount(t);
	await tick();
	h.plugin.settings.searchToolbar = [
		{ id: "case", placement: "inline" },
		{ id: "regex", placement: "more" },
		{ id: "previous", placement: "hidden" },
		{ id: "next", placement: "inline" },
		{ id: "history", placement: "more" },
	];
	h.plugin.settings.replaceToolbar = toolbarSource.defaultToolbar("replace");
	h.component.refreshToolbar();
	await tick();
	assert.equal(h.target.querySelector('[aria-label="search.tip.PreviousMatch"]'), null);
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	more.click();
	await tick();
	const regex = h.target.querySelector('[data-overflow-action="regex"]');
	assert.equal(regex.getAttribute("aria-pressed"), "false");
	regex.click();
	await tick();
	assert.equal(h.component.getSearchCache().options.regexMode, true);
	assert.equal(regex.getAttribute("aria-pressed"), "true");
	assert.equal(document.activeElement, regex);
	regex.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	await tick();
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), null);
	assert.equal(h.component.isVisible(), true);
	h.plugin.settings.enableHistory = false;
	h.component.refreshToolbar();
	more.click();
	await tick();
	assert.equal(
		h.target.querySelector('[data-overflow-action="history"]').getAttribute("aria-disabled"),
		"true",
	);
	document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
	await tick();
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), null);
});

test("More is a compact icon button group with the same geometry and states as inline actions", async (t) => {
	const h = mount(t);
	await tick();
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) =>
			["regex", "case", "wholeWord"].includes(item.id)
				? { ...item, placement: "more" }
				: item,
		);
	h.component.refreshToolbar();
	await tick();
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	more.click();
	await tick();
	const panel = h.target.querySelector(".nya-toolbar-menu");
	assert.equal(panel.getAttribute("role"), "group");
	assert.equal(panel.getAttribute("aria-label"), null);
	assert.equal(panel.getAttribute("title"), null);
	assert.equal(document.getElementById(panel.getAttribute("aria-labelledby")), more);
	assert.equal(document.getElementById(more.getAttribute("aria-controls")), panel);
	assert.equal(more.hasAttribute("aria-haspopup"), false);
	assert.equal(
		panel.querySelector('[role="menuitem"], [role="menuitemcheckbox"], .nya-menu-check'),
		null,
	);
	const panelStyle = window.getComputedStyle(panel);
	assert.equal(panelStyle.display, "flex");
	assert.equal(panelStyle.flexWrap, "wrap");
	assert.equal(panel.style.minWidth, "");
	const inline = h.target.querySelector('[data-toolbar-action="next"]'),
		reference = window.getComputedStyle(inline);
	for (const button of panel.querySelectorAll('[role="button"]')) {
		assert.equal(button.textContent.trim(), "", "icon buttons have no visible menu text");
		assert.ok(button.getAttribute("aria-label"));
		assert.equal(button.hasAttribute("title"), false);
		for (const property of ["width", "height", "padding", "margin"])
			assert.equal(window.getComputedStyle(button)[property], reference[property]);
	}
	const regex = panel.querySelector('[data-overflow-action="regex"]');
	let queryFocus = 0;
	vi.spyOn(h.target.querySelector("textarea"), "focus").mockImplementation(() => {
		queryFocus++;
	});
	regex.click();
	await tick();
	assert.equal(regex.getAttribute("aria-pressed"), "true");
	assert.ok(regex.classList.contains("nya-btn--active"));
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), panel);
	assert.equal(document.activeElement, regex);
	panel.querySelector('[data-overflow-action="case"]').click();
	await tick();
	assert.equal(h.component.getSearchCache().options.caseSensitive, true);
	assert.equal(
		queryFocus,
		0,
		"mode toggles must not briefly focus the query or summon a mobile keyboard",
	);
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), panel);
	more.click();
	await tick();
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), null);
});

test("More indicates only its own enabled modes with a collapsed dot, never a mode activation style", async (t) => {
	const h = mount(t);
	await tick();
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	h.component.toggleRegexMode();
	await tick();
	assert.equal(
		more.classList.contains("nya-btn--active"),
		false,
		"inline activation is not aggregated",
	);
	assert.equal(more.querySelector(".nya-toolbar-indicator"), null);
	more.click();
	await tick();
	assert.ok(more.classList.contains("nya-btn--open"));
	assert.equal(more.classList.contains("nya-btn--active"), false);
	selectScope(h, [{ from: 4, to: 7 }]);
	h.target.querySelector('[data-overflow-action="selection"]').click();
	await tick();
	assert.equal(more.classList.contains("nya-btn--active"), false);
	assert.equal(
		more.querySelector(".nya-toolbar-indicator"),
		null,
		"expanded buttons already expose their state",
	);
	const description = document.getElementById(more.getAttribute("aria-describedby"));
	assert.ok(description);
	assert.equal(description.className.includes("nya-toolbar-help"), true);
	assert.equal(
		more.getAttribute("aria-pressed"),
		null,
		"aggregate state is not a separate mode toggle",
	);
	more.click();
	await tick();
	assert.equal(more.classList.contains("nya-btn--open"), false);
	assert.equal(more.classList.contains("nya-btn--active"), false);
	const dot = more.querySelector(".nya-toolbar-indicator");
	assert.ok(dot);
	assert.equal(dot.getAttribute("aria-hidden"), "true");
	assert.equal(dot.hasAttribute("tabindex"), false);
	const css = window.getComputedStyle(dot);
	assert.equal(css.position, "absolute");
	assert.equal(css.width, "5px");
	assert.equal(css.height, "5px");
	assert.equal(css.pointerEvents, "none");
	more.click();
	await tick();
	assert.equal(more.querySelector(".nya-toolbar-indicator"), null);
	assert.equal(
		document.getElementById(more.getAttribute("aria-describedby")),
		description,
		"accessible description survives expansion",
	);
	const selection = h.target.querySelector('[data-overflow-action="selection"]');
	selection.click();
	await tick();
	assert.equal(selection.getAttribute("aria-pressed"), "false");
	more.click();
	await tick();
	assert.equal(
		more.querySelector(".nya-toolbar-indicator"),
		null,
		"all modes disabled while open",
	);
	h.component.findInSelection();
	await tick();
	assert.ok(more.querySelector(".nya-toolbar-indicator"));
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) =>
			item.id === "selection"
				? { ...item, placement: "hidden" }
				: item.id === "history"
					? { ...item, placement: "more" }
					: item,
		);
	h.component.refreshToolbar();
	await tick();
	assert.equal(
		more.classList.contains("nya-btn--active"),
		false,
		"hidden modes and available history are not aggregated",
	);
	assert.equal(more.querySelector(".nya-toolbar-indicator"), null);
	assert.equal(more.hasAttribute("aria-describedby"), false);
	assert.equal(h.component.hasSelectionScope(), true);
});

test("More keyboard navigation skips disabled actions and Escape returns focus without closing Finder", async (t) => {
	const h = mount(t, undefined, { enableHistory: false });
	await tick();
	h.plugin.settings.searchToolbar = ["regex", "history", "case", "selection"].map((id) => ({
		id,
		placement: "more",
	}));
	h.component.refreshToolbar();
	await tick();
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	const key = (node, value) =>
		node.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
		);
	key(more, "Enter");
	await tick();
	const regex = h.target.querySelector('[data-overflow-action="regex"]'),
		caseButton = h.target.querySelector('[data-overflow-action="case"]');
	const selection = h.target.querySelector('[data-overflow-action="selection"]'),
		history = h.target.querySelector('[data-overflow-action="history"]');
	assert.equal(document.activeElement, regex);
	assert.equal(history.tabIndex, -1);
	key(regex, "ArrowRight");
	assert.equal(document.activeElement, caseButton);
	key(caseButton, " ");
	await tick();
	assert.equal(caseButton.getAttribute("aria-pressed"), "true");
	assert.equal(document.activeElement, caseButton);
	key(caseButton, "End");
	assert.equal(document.activeElement, selection);
	key(selection, "Home");
	assert.equal(document.activeElement, regex);
	key(regex, "ArrowLeft");
	assert.equal(document.activeElement, selection);
	key(selection, "Escape");
	await tick();
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), null);
	assert.equal(document.activeElement, more);
	assert.equal(h.component.isVisible(), true);
});

test("More allows native Tab focus traversal and closes after focus leaves the panel", async (t) => {
	const h = mount(t);
	await tick();
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	more.click();
	await tick();
	const selection = h.target.querySelector('[data-overflow-action="selection"]');
	const event = new window.KeyboardEvent("keydown", {
		key: "Tab",
		bubbles: true,
		cancelable: true,
	});
	selection.dispatchEvent(event);
	assert.equal(event.defaultPrevented, false);
	h.target.querySelector("textarea").focus();
	await tick();
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), null);
	assert.equal(document.activeElement, h.target.querySelector("textarea"));
});

test("More ordinary actions close the panel and disabled actions do not execute", async (t) => {
	const h = mount(t, undefined, { enableHistory: false });
	await tick();
	h.plugin.settings.searchToolbar = [
		{ id: "next", placement: "more" },
		{ id: "history", placement: "more" },
	];
	h.component.refreshToolbar();
	await tick();
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	more.click();
	await tick();
	const panel = h.target.querySelector(".nya-toolbar-menu");
	panel.querySelector('[data-overflow-action="history"]').click();
	await tick();
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), panel);
	assert.equal(h.component.getSearchCache().index, 0);
	panel.querySelector('[data-overflow-action="next"]').click();
	await tick();
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.target.querySelector(".nya-toolbar-menu"), null);
	assert.equal(more.classList.contains("nya-btn--active"), false);
});

test("reading mode keeps invalid source scope visible in More until the user explicitly clears it", async (t) => {
	const h = mount(t);
	await tick();
	selectScope(h, [{ from: 4, to: 7 }]);
	h.component.findInSelection();
	await tick();
	const reading = new ReadingSearch(
		h.view,
		() => true,
		() => h.component.matchAgain(false),
	);
	h.editorSearch.getReadingSearch = () => reading;
	h.editorSearch.clearReadingSearch = () => reading.clear();
	onTestFinished(() => reading.destroy());
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => (item.id === "wholeWord" ? { ...item, placement: "more" } : item));
	h.component.refreshToolbar();
	await tick();
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	assert.ok(more.querySelector(".nya-toolbar-indicator"));
	h.view.getMode = () => "preview";
	h.component.matchAgain(false);
	await tick();
	assert.equal(more.classList.contains("nya-btn--active"), false);
	assert.ok(more.querySelector(".nya-toolbar-indicator"));
	more.click();
	await tick();
	const scope = h.target.querySelector('[data-overflow-action="selection"]');
	assert.equal(scope.getAttribute("aria-pressed"), "true");
	assert.equal(scope.getAttribute("aria-label"), "search.tip.FindInSelectionUnavailable");
	assert.ok(h.target.querySelector('[data-overflow-action="wholeWord"]'));
});

test("More panel placement listeners are released on dismissal and destruction", async (t) => {
	const resize = new Set(),
		position = new Set();
	const add = window.addEventListener.bind(window),
		remove = window.removeEventListener.bind(window);
	vi.spyOn(window, "addEventListener").mockImplementation((type, handler, ...rest) => {
		if (type === "resize") resize.add(handler);
		return add(type, handler, ...rest);
	});
	vi.spyOn(window, "removeEventListener").mockImplementation((type, handler, ...rest) => {
		if (type === "resize") resize.delete(handler);
		return remove(type, handler, ...rest);
	});
	const h = mount(t);
	await tick();
	const finder = h.target.querySelector(".nya-finder"),
		before = resize.size;
	const addPosition = finder.addEventListener.bind(finder),
		removePosition = finder.removeEventListener.bind(finder);
	vi.spyOn(finder, "addEventListener").mockImplementation((type, handler, ...rest) => {
		if (type === "nya-finder-position") position.add(handler);
		return addPosition(type, handler, ...rest);
	});
	vi.spyOn(finder, "removeEventListener").mockImplementation((type, handler, ...rest) => {
		if (type === "nya-finder-position") position.delete(handler);
		return removePosition(type, handler, ...rest);
	});
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	more.click();
	await tick();
	assert.equal(resize.size, before + 1);
	assert.equal(position.size, 1);
	more.click();
	await tick();
	assert.equal(resize.size, before);
	assert.equal(position.size, 0);
	more.click();
	await tick();
	h.component.destroy();
	assert.equal(resize.size, 0);
	assert.equal(position.size, 0);
});

test("failed selection activation keeps More open but not active, and invalid scope stays pressed until cleared", async (t) => {
	const h = mount(t);
	await tick();
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	more.click();
	await tick();
	const selection = h.target.querySelector('[data-overflow-action="selection"]');
	selection.click();
	await tick();
	assert.equal(selection.getAttribute("aria-pressed"), "false");
	assert.equal(more.classList.contains("nya-btn--active"), false);
	assert.equal(document.activeElement, selection);
	selectScope(h, [{ from: 4, to: 7 }]);
	selection.click();
	await tick();
	h.view.file = { path: "different.md" };
	h.component.matchAgain(false);
	await tick();
	assert.equal(selection.getAttribute("aria-pressed"), "true");
	assert.equal(selection.getAttribute("aria-label"), "search.tip.FindInSelectionUnavailable");
	assert.equal(more.classList.contains("nya-btn--active"), false);
	assert.equal(more.querySelector(".nya-toolbar-indicator"), null);
	more.click();
	await tick();
	assert.ok(
		more.querySelector(".nya-toolbar-indicator"),
		"invalid restricted scope is still indicated when collapsed",
	);
	more.click();
	await tick();
	h.component.replaceAllMatchedText("dog");
	assert.equal(h.view.editor.getValue(), "cat cat");
	const reopened = h.target.querySelector('[data-overflow-action="selection"]');
	reopened.click();
	await tick();
	assert.equal(reopened.getAttribute("aria-pressed"), "false");
	assert.equal(more.classList.contains("nya-btn--active"), false);
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(h.target.querySelector(".nya-scope-status"), null);
});

test("scope text marks keep background-only styling and separate outlines never override match colors", () => {
	const styles = compileString(readFileSync("src/styles/index.scss", "utf8"), {
		loadPaths: ["src/styles"],
	}).css;
	const scopeRules = styles.match(/\.nya-text-finder-scope[^{}]*\{[^}]*\}/g);
	assert.ok(scopeRules?.length);
	assert.ok(scopeRules.every((rule) => !/box-shadow|text-decoration|border-bottom/.test(rule)));
	assert.ok(
		scopeRules.some(
			(rule) =>
				rule.includes(":not(.nya-text-finder-match)") &&
				rule.includes("var(--nya-scope-background)"),
		),
	);
});

test("toolbar focus rings use focus-visible without changing mode activation or expanded feedback", () => {
	// Vite emits a shared CSS asset, not one string per component. Restrict this
	// assertion to the toolbar's own scope rather than Finder input focus rules.
	const styles = componentStyles.join("\n");
	assert.ok(styles);
	const rules = Array.from(styles.matchAll(/([^{}]+)\{([^{}]*)\}/g), ([, selector, body]) => ({
		selector,
		body,
	}));
	const toolbarScope = styles.match(/\.nya-toolbar(\[data-v-[\w-]+\])/)[1];
	const focus = rules.filter(
		({ selector }) =>
			selector.includes(toolbarScope) &&
			selector.includes(".nya-focus") &&
			selector.includes(":focus"),
	);
	assert.ok(
		focus.some(
			({ selector, body }) =>
				selector.includes(":focus-visible") &&
				/outline:\s*2px solid var\(--nya-focus-border-color\)/.test(body),
		),
	);
	assert.ok(
		focus.some(
			({ selector, body }) =>
				selector.includes(":focus:not(:focus-visible)") && /outline:\s*none/.test(body),
		),
	);
	assert.ok(
		focus.every(({ body }) => !body.includes("box-shadow")),
		"no pointer-focus blue shadow",
	);
	assert.ok(
		rules.some(
			({ selector, body }) =>
				selector.includes(".nya-btn--active") &&
				/background-color:\s*rgba\(36, 137, 219, 0.51\)/.test(body),
		),
	);
	assert.ok(
		rules.some(
			({ selector, body }) =>
				selector.includes(".nya-btn--open") &&
				body.includes("inset 0 0 0 1px var(--text-muted)"),
		),
	);
	const indicator = rules.find(({ selector }) => selector.includes(".nya-toolbar-indicator"));
	assert.ok(indicator.body.includes("var(--interactive-accent)"));
	assert.ok(!/transition|animation/.test(indicator.body));
});

test("render waiting uses a compact count marker and delayed external status, cleared on completion", async (t) => {
	const h = mountReading(t);
	await tick();
	h.renderer.rendered = [];
	h.component.matchAgain(false);
	await tick();
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "…");
	assert.equal(h.target.querySelector(".nya-search-status"), null);
	await new Promise((resolve) => setTimeout(resolve, 430));
	await tick();
	const status = h.target.querySelector(".nya-search-status");
	assert.ok(status);
	assert.equal(status.parentElement.classList.contains("nya-finder"), true);
	assert.equal(window.getComputedStyle(status).position, "absolute");
	assert.equal(window.getComputedStyle(status).pointerEvents, "none");
	assert.equal(status.querySelector("span").textContent.trim(), "search.ReadingPending");
	h.renderer.rendered = null;
	h.component.matchAgain(false);
	await tick();
	assert.equal(h.target.querySelector(".nya-search-status"), null);
	assert.equal(h.component.getSearchCache().matches.length, 3);
});

test("pending status delay resets for new queries and closing cancels it", async (t) => {
	const h = mountReading(t);
	await tick();
	h.renderer.rendered = [];
	h.component.matchAgain(false);
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 250));
	h.component.setFindText("tail", false);
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 220));
	await tick();
	assert.equal(h.target.querySelector(".nya-search-status"), null);
	h.component.setVisible(false);
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 220));
	await tick();
	assert.equal(h.target.querySelector(".nya-search-status"), null);
});

test("external failures have retry and native actions without putting long text into the counter", async (t) => {
	const h = mountReading(t);
	await tick();
	const original = h.renderer.showSection;
	h.renderer.showSection = () => {
		throw new Error("broken");
	};
	h.component.toNextMatch();
	await tick();
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "!");
	const status = h.target.querySelector(".nya-search-status");
	assert.ok(status.textContent.includes("search.ReadingFailed"));
	h.renderer.showSection = original;
	status.querySelector("button").click();
	await tick();
	assert.equal(h.target.querySelector(".nya-search-status"), null);
	assert.equal(h.component.getSearchCache().matches.length, 3);
});

test("file changes reset a pending status delay even when the query is unchanged", async (t) => {
	const h = mountReading(t);
	await tick();
	h.renderer.rendered = [];
	h.component.matchAgain(false);
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 250));
	h.view.file = { path: "b.md" };
	h.component.matchAgain(false);
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 220));
	await tick();
	assert.equal(h.target.querySelector(".nya-search-status"), null);
});

test("hiding a button does not remove the search or replacement action", async (t) => {
	const h = mount(t);
	await tick();
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => ({ ...item, placement: "hidden" }));
	h.plugin.settings.replaceToolbar = toolbarSource
		.defaultToolbar("replace")
		.map((item) => ({ ...item, placement: "hidden" }));
	h.component.refreshToolbar();
	await tick();
	assert.equal(h.target.querySelector('[aria-label="search.tip.NextMatch"]'), null);
	h.component.toNextMatch();
	await tick();
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(typeof h.component.replaceMatchedText, "function");
	assert.ok(h.target.querySelector('[aria-label="search.tip.Close"]'));
	assert.ok(h.target.querySelector('[aria-label="search.tip.ToggleReplace"]'));
});

test("unsupported reading renderer offers native find outside the match counter", async (t) => {
	const h = mountReading(t);
	await tick();
	delete window.Highlight;
	h.component.matchAgain(false);
	await tick();
	const status = h.target.querySelector(".nya-search-status");
	assert.ok(status.textContent.includes("search.ReadingUnsupported"));
	assert.equal(status.querySelectorAll("button").length, 1);
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "!");
});

function mockLayoutObserver(_t) {
	const previous = window.ResizeObserver;
	const observers = [];
	window.ResizeObserver = class {
		observed = [];
		constructor(callback) {
			this.callback = callback;
			observers.push(this);
		}
		observe(element) {
			this.observed.push(element);
		}
		disconnect() {
			this.disconnected = true;
		}
	};
	onTestFinished(() => {
		if (previous) window.ResizeObserver = previous;
		else delete window.ResizeObserver;
	});
	return observers;
}

test("replacement spacer shrinks with the current counter without depending on the previously expanded row", async (t) => {
	const observers = mockLayoutObserver(t);
	const h = mount(t);
	h.component.setCollapse(false);
	await tick();
	const count = h.target.querySelector(".nya-tip");
	const actions = h.target.querySelector(".finder-act");
	const replace = h.target.querySelector(".replacer-act");
	const toolbar = replace.querySelector(".nya-toolbar");
	const observer = observers.find((entry) => entry.observed.includes(count));
	assert.deepEqual(observer.observed, [count, actions, toolbar]);
	let countWidth = 100;
	count.getBoundingClientRect = () => ({ width: countWidth });
	actions.getBoundingClientRect = () => ({ width: 140 });
	toolbar.getBoundingClientRect = () => ({ width: 56 });
	for (const element of [
		h.target.querySelector(".nya-finder"),
		h.target.querySelector(".finder"),
		h.target.querySelector("textarea"),
	]) {
		element.getBoundingClientRect = () => {
			throw new Error("spacer must not read its own dependent geometry");
		};
	}
	observer.callback();
	await tick();
	assert.equal(replace.style.paddingRight, "184px");
	for (let cycle = 0; cycle < 3; cycle++) {
		countWidth = 148.36;
		observer.callback();
		await tick();
		assert.equal(replace.style.paddingRight, "232.36px");
		countWidth = 117.81;
		observer.callback();
		await tick();
		assert.equal(replace.style.paddingRight, "201.81px");
		countWidth = 100;
		h.component.setFindText("", false);
		observer.callback();
		await tick();
		assert.equal(replace.style.paddingRight, "184px");
	}
	h.component.destroy();
	assert.equal(observer.disconnected, true);
});

test("custom toolbar and collapsed layouts do not retain or receive the default replacement spacer", async (t) => {
	const observers = mockLayoutObserver(t);
	const h = mount(t);
	h.component.setCollapse(false);
	await tick();
	const count = h.target.querySelector(".nya-tip");
	const actions = h.target.querySelector(".finder-act");
	const replace = h.target.querySelector(".replacer-act");
	const toolbar = replace.querySelector(".nya-toolbar");
	const observer = observers.find((entry) => entry.observed.includes(count));
	count.getBoundingClientRect = () => ({ width: 148.36 });
	actions.getBoundingClientRect = () => ({ width: 140 });
	toolbar.getBoundingClientRect = () => ({ width: 56 });
	observer.callback();
	await tick();
	assert.equal(replace.style.paddingRight, "232.36px");
	h.component.setCollapse(true);
	await tick();
	observer.callback();
	await tick();
	assert.equal(replace.style.paddingRight, "");
	h.component.setCollapse(false);
	await tick();
	h.plugin.settings.searchToolbar = toolbarSource
		.defaultToolbar("search")
		.map((item) => ({ ...item, placement: "more" }));
	h.component.refreshToolbar();
	await tick();
	observer.callback();
	await tick();
	assert.equal(replace.style.paddingRight, "");
});

for (const [name, vault, expected] of [
	["live preview enabled", { getConfig: () => true }, false],
	["live preview disabled", { getConfig: () => false }, true],
	["internal configuration API unavailable", {}, undefined],
	["internal preference is not a boolean", { getConfig: () => "true" }, undefined],
	[
		"internal preference getter throws",
		{
			getConfig: () => {
				throw new Error("host failure");
			},
		},
		undefined,
	],
]) {
	test(`closing Finder safely restores the editor preference: ${name}`, async (t) => {
		const h = mount(t);
		await tick();
		const states = [];
		h.plugin.settings.sourceModeWhenSearch = true;
		h.plugin.app = { vault };
		// Keep the real component action and owner context; only observe mode writes.
		h.view.setState = (state) => states.push({ ...state });
		h.component.closeFinder();
		await tick();
		assert.equal(h.component.isVisible(), false);
		assert.deepEqual(
			states.map((state) => state.source),
			expected === undefined ? [] : [expected],
		);
	});
}

test("close clears both inputs only when configured, preserving all match preferences", async (t) => {
	const h = mount(t);
	await tick();
	h.component.toggleRegexMode();
	h.component.toggleMatchCaseMode();
	h.component.toggleWholeWordMode();
	setReplacement(h, "dog");
	h.component.closeFinder();
	assert.equal(h.component.getSearchCache().search, "cat");
	assert.equal(h.component.getSearchCache().replace, "dog");
	h.component.setVisible(true);
	h.plugin.settings.clearAfterHidden = true;
	h.component.closeFinder();
	await tick();
	assert.equal(h.component.getSearchCache().search, "");
	assert.equal(h.component.getSearchCache().replace, "");
	assert.deepEqual(h.component.getSearchCache().options, {
		regexMode: true,
		caseSensitive: true,
		wholeWord: true,
	});
	h.component.setVisible(true);
	assert.equal(h.component.getSearchCache().replace, "");
});

test("all user close entry points restore mode once; hidden close is inert", async (t) => {
	const h = mount(t);
	await tick();
	const states = [];
	h.plugin.settings.sourceModeWhenSearch = true;
	h.plugin.app = {
		vault: { getConfig: () => true },
		workspace: {
			getActiveViewOfType: () => h.view,
			iterateAllLeaves: (fn) => fn({ view: h.view }),
			on() {},
		},
	};
	h.view.setState = (state) => {
		states.push(state.source);
	};
	const commands = new Map();
	h.plugin.addCommand = (cmd) => commands.set(cmd.id, cmd);
	h.plugin.registerEvent = () => {};
	const search = new EditorSearch(h.plugin);
	search.owners.ensure(h.view).finder = h.component;
	search.registerFinderEvent({ containerEl: h.target }, h.component);
	for (const close of [
		() => h.target.querySelector('[aria-label="search.tip.Close"]').click(),
		() =>
			h.target.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
			),
		() => commands.get("text-finder-hide-find").checkCallback(false),
		() => commands.get("text-finder-toggle-find").checkCallback(false),
	]) {
		h.component.setVisible(true, "cat");
		states.length = 0;
		close();
		assert.equal(h.component.isVisible(), false);
		assert.deepEqual(states, [false]);
		h.component.closeFinder();
		assert.deepEqual(states, [false]);
	}
	delete search.owners.get(h.view).finder;
	search.dispose();
});

test("mode failures still hide Finder and rejected promises are reported", async (t) => {
	const h = mount(t);
	await tick();
	const errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.plugin.settings.sourceModeWhenSearch = true;
	h.plugin.app = { vault: { getConfig: () => true } };
	for (const action of [
		() => {
			throw new Error("sync");
		},
		() => Promise.reject(new Error("async")),
	]) {
		h.component.setVisible(true, "");
		h.view.setState = action;
		h.component.closeFinder();
		await Promise.resolve();
		assert.equal(h.component.isVisible(), false);
	}
	assert.deepEqual(errors, ["search.EditorFailed", "search.EditorFailed"]);
});

test("live history removal selects neighbours without scrolling and empty history restores the draft", async (t) => {
	const h = mount(t);
	await tick();
	h.plugin.settings.searchHistory = ["A", "B", "C"].map((text, index) => ({
		text,
		count: 1,
		createdAt: 3 - index,
		lastUsedAt: 3 - index,
	}));
	h.plugin.history.notify();
	h.component.setVisible(true, "draft");
	const input = h.target.querySelector("textarea");
	const up = async () => {
		input.selectionStart = 0;
		input.dispatchEvent(new window.KeyboardEvent("keydown", { code: "ArrowUp" }));
		await tick();
	};
	await up();
	await up();
	assert.equal(input.value, "B");
	h.scrolls.length = 0;
	h.plugin.history.remove(new Set(["B"]));
	await tick();
	assert.equal(input.value, "C");
	assert.equal(h.scrolls.length, 0);
	h.plugin.history.remove(new Set(["C"]));
	await tick();
	assert.equal(input.value, "A");
	h.plugin.history.remove(new Set(["A"]));
	await tick();
	assert.equal(input.value, "draft");
});

test("Meta Enter does not navigate or replace", async (t) => {
	const h = mount(t);
	h.component.setCollapse(false);
	await tick();
	for (const input of h.target.querySelectorAll("textarea")) {
		input.dispatchEvent(
			new window.KeyboardEvent("keydown", { code: "Enter", metaKey: true, cancelable: true }),
		);
	}
	assert.equal(h.component.getSearchCache().index, 0);
	assert.equal(h.view.editor.getValue(), "cat cat");
	assert.equal(h.scrolls.length, 0);
});

test("successful replacement with failed positioning reports completion without retrying the write", async (t) => {
	const h = mount(t);
	await tick();
	const errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.view.editor.scrollIntoView = () => {
		throw new Error("scroll failed");
	};
	const result = h.component.replaceOnce();
	assert.equal(result.changed, true); // Default empty replacement removes one match.
	assert.equal(result.navigationFailed, true);
	assert.equal(h.view.editor.getValue(), " cat");
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
});

test("same-count replacement positioning failure does not advance or repeat the write", async (t) => {
	const h = mount(t);
	await tick();
	const errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	setReplacement(h, "cat!");
	h.view.editor.scrollIntoView = () => {
		throw new Error("scroll failed");
	};
	const result = h.component.replaceOnce();
	assert.equal(result.changed, true);
	assert.equal(result.changeCount, 1);
	assert.equal(result.navigationFailed, true);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.component.getSearchCache().index, 0);
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
});
