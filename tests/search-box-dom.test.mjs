import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import { compileString } from "sass";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { attachHistory } from "./history-source.mjs";
import { loadSource } from "./source-loader.mjs";

const { ReadingSearch } = loadSource("../src/reading-search.ts", {
	"./reading-text": loadSource("../src/reading-text.ts"),
	"./util/text-helper": loadSource("../src/util/text-helper.ts"),
});

const root = fileURLToPath(new URL("../", import.meta.url));
const componentStyles = [];
const bundle = await build({
	stdin: { contents: `export {default as SearchBox} from './src/SearchBox.svelte'; export {tick} from 'svelte';`, resolveDir: root },
	bundle: true, write: false, format: "cjs", platform: "browser",
	plugins: [{
		name: "search-box-dom",
		setup(build) {
			build.onResolve({ filter: /^(obsidian|lucide-svelte)$|^\.\/(i18n|search-highlight)$/ }, ({ path }) => ({ path, namespace: "stub" }));
			build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => {
				if (path === "obsidian") return { contents: `export const Platform = {isMobile: false};` };
				if (path === "./i18n") return { contents: `export const i18n = {t: key => key};` };
				if (path === "./search-highlight") return { contents: `export const searchCacheEffect = {of: value => value};` };
				const icon = compile("<span></span>", { generate: "dom", css: "external" }).js.code.replace("export default Component;", "");
				return { contents: icon + `\nexport {Component as ArrowDown, Component as ArrowUp, Component as ReplaceAll, Component as X, Component as Replace, Component as Regex, Component as CaseSensitive, Component as ChevronDown, Component as ChevronRight};`, resolveDir: root };
			});
			build.onLoad({ filter: /\.svelte$/ }, ({ path: filename }) => {
				const source = readFileSync(filename, "utf8")
					.replace(/<script lang="ts">([\s\S]*?)<\/script>/, (_, script) => `<script>${ts.transpileModule(script, {
						compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
					}).outputText}</script>`)
					.replace(/<style lang="scss">([\s\S]*?)<\/style>/g, (_, styles) => `<style>${compileString(styles).css}</style>`);
				const compiled = compile(source, { filename, generate: "dom", css: "external" });
				componentStyles.push(compiled.css.code);
				return { contents: compiled.js.code, resolveDir: path.dirname(filename) };
			});
		},
	}],
});
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const style = dom.window.document.createElement("style");
style.textContent = componentStyles.join("\n");
dom.window.document.head.append(style);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
const module = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(module, module.exports);
const { SearchBox, tick } = module.exports;

function mount(t) {
	const target = document.createElement("div");
	document.body.append(target);
	const scrolls = [];
	const specs = [];
	let saves = 0;
	let resolve;
	const pending = new Promise((done) => { resolve = done; });
	const view = { file: { path: "a.md" }, getState: () => ({ mode: "source", source: true }), setState: () => {} };
	const editor = {
		getValue: () => editor.cm.state.doc.toString(), offsetToPos: (offset) => offset,
		scrollIntoView: (range) => scrolls.push(range),
		cm: {
			state: EditorState.create({ doc: "cat cat" }),
			dispatch(spec) { specs.push(spec); this.state = this.state.update({ selection: spec.selection }).state; },
		},
	};
	view.editor = editor;
	const plugin = {
		settings: { enableInputHotkeys: true, enableHistory: true, historyMaxCount: 10, searchHistory: [], moveCursorToMatch: true },
		saveSettings: () => { saves++; return pending; },
	};
	attachHistory(plugin);
	const component = new SearchBox({ target, props: {
		cid: "a", ownerView: view,
		editorSearch: { plugin, getEditorContext: (owner) => {
			assert.equal(owner, view);
			return { view, editor, editorView: editor.cm, file: view.file, doc: editor.cm.state.doc };
		} },
	} });
	t.after(() => { component.$destroy(); target.remove(); resolve(); });
	component.setVisible(true, "cat");
	scrolls.length = 0;
	return { component, target, scrolls, specs, plugin, resolve, saves: () => saves };
}

function mountReading(t) {
	window.CSS = { highlights: new Map() };
	window.Highlight = class extends Set { priority = 0; };
	const target = document.createElement("div");
	const preview = document.createElement("div");
	target.append(preview);
	document.body.append(target);
	const sections = ["<p>cat <strong>CAT</strong></p>", "<p>tail cat</p>"].map((html) => {
		const el = document.createElement("div"); el.innerHTML = html;
		return { el, rendered: true };
	});
	preview.append(sections[0].el);
	const scrolls = [];
	const renderer = {
		sections, previewEl: preview, text: "markdown", lastText: "markdown", parsing: false, rendered: null,
		showSection(section) { scrolls.push(section); },
		applyScrollSection(section) { this.target = section; return true; },
		updateVirtualDisplay() { if (this.target) preview.append(this.target.el); },
		onRendered() {},
	};
	const view = { file: { path: "a.md" }, getMode: () => "preview", previewMode: { renderer, containerEl: preview } };
	const plugin = {
		settings: { enableInputHotkeys: true, enableHistory: true, historyMaxCount: 10, searchHistory: [] },
		saveSettings: async () => {},
	};
	attachHistory(plugin);
	let component;
	const search = new ReadingSearch(view, () => true, () => component.matchAgain(false));
	component = new SearchBox({ target, props: { cid: "reading", ownerView: view, editorSearch: {
		plugin, getEditorContext: () => null, canSearchReading: () => true,
		getReadingSearch: () => search, clearReadingSearch: () => search.clear(),
	} } });
	t.after(() => { search.destroy(); component.$destroy(); target.remove(); });
	component.setVisible(true, "cat");
	scrolls.length = 0;
	return { component, target, preview, view, sections, plugin, scrolls, renderer, search };
}

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
	assert.equal(h.scrolls.length, 1, "background mode refresh adds no scroll beyond the case-toggle action");
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
	h.renderer.showSection = () => { throw new Error("broken bridge"); };
	h.component.toNextMatch();
	await tick();
	assert.ok(h.target.textContent.includes("search.ReadingFailed"));
	assert.ok(h.target.textContent.includes("search.UseNativeFind"));
	assert.equal(window.CSS.highlights.has("nya-reading-matches"), false);
});

test("actual SearchBox Enter binding navigates immediately and records exactly once", async (t) => {
	const h = mount(t);
	const input = h.target.querySelector("textarea");
	input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
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

test("exact query and whitespace queries are retained in actual input history", async (t) => {
	const h = mount(t);
	for (const query of [" cat ", "cat", " \n\t"]) {
		h.component.setFindText(query, false);
		h.component.toNextMatch();
	}
	assert.deepEqual(h.plugin.settings.searchHistory.map((i) => i.text).sort(), [" cat ", "cat", " \n\t"].sort());
});

test("A to B to A input cycle increments again even with Svelte bind:value", async (t) => {
	const h = mount(t);
	const input = h.target.querySelector("textarea");
	const navigate = async (query) => {
		input.value = query;
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
		input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
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
	input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", bubbles: true }));
	await tick();
	assert.equal(h.component.getSearchCache().search, "dog");
});
