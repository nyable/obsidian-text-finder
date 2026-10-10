import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { attachHistory } from "./history-source.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
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
					.replace(/<style[\s\S]*?<\/style>/g, "");
				return { contents: compile(source, { filename, generate: "dom", css: "external" }).js.code, resolveDir: path.dirname(filename) };
			});
		},
	}],
});
const dom = new JSDOM("<!doctype html><html><body></body></html>");
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
