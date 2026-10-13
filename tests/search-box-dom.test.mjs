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
import { attachHistory, toolbarSource } from "./history-source.mjs";
import { loadSource } from "./source-loader.mjs";
import { matchEngineSource } from "./match-engine-source.mjs";
import { matchWorkerPlugin } from "../tools/match-worker-build.mjs";
import { installWorkerHost } from "./match-worker-host.mjs";

const { ReadingSearch } = loadSource("../src/reading-search.ts", {
	"./reading-text": loadSource("../src/reading-text.ts"),
	"./util/text-helper": loadSource("../src/util/text-helper.ts"),
});
const { EditorSearch } = loadSource("../src/editor-extension.ts", {
	"./match-engine": matchEngineSource,
	"./search-highlight": {}, "./SearchBox.svelte": {}, obsidian: { MarkdownView: class {} },
	"./i18n": { i18n: { t: (key) => key } }, "./util/common-helper": {}, "./HistoryModal": {},
	"./reading-search": { ReadingSearch },
});

const root = fileURLToPath(new URL("../", import.meta.url));
const componentStyles = [];
const bundle = await build({
	stdin: { contents: `export {default as SearchBox} from './src/SearchBox.svelte'; export {MatchEngine} from './src/match-engine'; export {tick} from 'svelte';`, resolveDir: root },
	bundle: true, write: false, format: "cjs", platform: "browser",
	plugins: [matchWorkerPlugin(), {
		name: "search-box-dom",
		setup(build) {
			build.onResolve({ filter: /^(obsidian|lucide-svelte)$|^\.\/(i18n|search-highlight)$/ }, ({ path }) => ({ path, namespace: "stub" }));
			build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => {
				if (path === "obsidian") return { contents: `export const Platform = {isMobile: false};` };
				if (path === "./i18n") return { contents: `export const i18n = {t: key => key};` };
				if (path === "./search-highlight") return { contents: `export const searchCacheEffect = {of: value => value};` };
				const icon = compile("<span></span>", { generate: "dom", css: "external" }).js.code.replace("export default Component;", "");
				return { contents: icon + `\nexport {Component as ArrowDown, Component as ArrowUp, Component as ReplaceAll, Component as X, Component as Replace, Component as Regex, Component as CaseSensitive, Component as WholeWord, Component as ChevronDown, Component as ChevronRight, Component as History, Component as Ellipsis};`, resolveDir: root };
			});
			build.onLoad({ filter: /\.svelte$/ }, ({ path: filename }) => {
				const source = readFileSync(filename, "utf8")
					.replace(/<script lang="ts">([\s\S]*?)<\/script>/, (_, script) => `<script>${ts.transpileModule(script, {
						compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
					}).outputText}</script>`)
					.replace(/<style lang="scss">([\s\S]*?)<\/style>/g, (_, styles) => `<style>${compileString(styles, { loadPaths: [path.dirname(filename)] }).css}</style>`);
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
const { SearchBox, MatchEngine, tick } = module.exports;

function mount(t, matcher, settings = {}) {
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
			dispatch(spec) { specs.push(spec); this.state = this.state.update({ changes: spec.changes, selection: spec.selection }).state; },
		},
	};
	view.editor = editor;
	view.containerEl = target;
	const plugin = {
		settings: { enableInputHotkeys: true, enableHistory: true, historyMaxCount: 10, searchHistory: [], moveCursorToMatch: true, ...settings },
		reportError() {},
		saveSettings: () => { saves++; return pending; },
	};
	attachHistory(plugin);
	const component = new SearchBox({ target, props: {
		cid: "a", ownerView: view,
		editorSearch: { plugin, ...(matcher ? { getMatchEngine: () => matcher } : {}), getEditorContext: (owner) => {
			assert.equal(owner, view);
			return { view, editor, editorView: editor.cm, file: view.file, doc: editor.cm.state.doc };
		} },
	} });
	t.after(() => { component.$destroy(); target.remove(); resolve(); });
	component.setVisible(true, "cat");
	scrolls.length = 0;
	return { component, target, scrolls, specs, plugin, view, resolve, saves: () => saves };
}

const deferred = () => {
	let resolve, reject;
	const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
};
const settlePosition = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await tick(); };

test("whole word toolbar toggle filters counts and synchronous replacement against the current document", async (t) => {
	const h = mount(t); await tick();
	h.view.editor.cm.state = EditorState.create({ doc: "cat cat2 cat_name xcat cat-dog" });
	h.component.matchAgain(false);
	assert.equal(h.component.getSearchCache().matches.length, 5);
	const button = h.target.querySelector('[aria-label="search.tip.MatchWholeWord"]');
	assert.equal(button.getAttribute("aria-pressed"), "false");
	button.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await tick();
	assert.equal(button.getAttribute("aria-pressed"), "true");
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(document.activeElement, h.target.querySelector("textarea"));
	h.component.setVisible(false);
	h.view.editor.cm.dispatch({ changes: { from: 0, insert: "cat2 " } });
	const result = h.component.replaceAllMatchedText("dog");
	assert.equal(result.changeCount, 2); assert.equal(result.changed, true);
	assert.equal(h.view.editor.getValue(), "cat2 dog cat2 cat_name xcat dog-dog");
	assert.equal(h.specs.filter((spec) => Array.isArray(spec.changes)).length, 1);
});

test("whole word is a checked More action and hiding it does not reset the query option", async (t) => {
	const h = mount(t); await tick();
	h.plugin.settings.searchToolbar = toolbarSource.defaultToolbar("search").map((item) => item.id === "wholeWord" ? { ...item, placement: "more" } : item);
	h.component.refreshToolbar(); await tick();
	const more = h.target.querySelector('[aria-label="search.tip.More"]');
	more.click(); await tick();
	let option = h.target.querySelector('[role="menuitemcheckbox"]');
	assert.equal(option.textContent.trim(), "search.tip.MatchWholeWord"); assert.equal(option.getAttribute("aria-checked"), "false");
	option.click(); await tick();
	assert.equal(h.component.getSearchCache().options.wholeWord, true);
	more.click(); await tick(); option = h.target.querySelector('[role="menuitemcheckbox"]');
	assert.equal(option.getAttribute("aria-checked"), "true");
	h.plugin.settings.searchToolbar = h.plugin.settings.searchToolbar.map((item) => item.id === "wholeWord" ? { ...item, placement: "hidden" } : item);
	h.component.refreshToolbar(); await tick();
	assert.equal(h.target.querySelector('[aria-label="search.tip.MatchWholeWord"]'), null);
	assert.equal(h.component.getSearchCache().options.wholeWord, true);
	h.component.resetAll(); assert.equal(h.component.getSearchCache().options.wholeWord, false);
});

test("whole word changes replace pending editor queries and late results cannot publish", async (t) => {
	const matcher = delayedMatcher(), h = mount(t, matcher); await tick();
	h.component.toggleWholeWordMode();
	assert.equal(matcher.requests.length, 2); assert.equal(matcher.requests[1].options.wholeWord, true);
	matcher.requests[1].resolve({ ...matchedCats, matches: [matchedCats.matches[0]] }); await settlePosition();
	const count = h.specs.length, scrolls = h.scrolls.length;
	matcher.requests[0].resolve(matchedCats); await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 1);
	assert.equal(h.specs.length, count); assert.equal(h.scrolls.length, scrolls);
});

test("finder initializes global default options once and keeps manual choices across close, file and mode changes", async (t) => {
	const h = mount(t, undefined, { defaultRegexMode: true, defaultCaseSensitive: true, defaultWholeWord: true });
	assert.deepEqual(h.component.getSearchCache().options, { regexMode: true, caseSensitive: true, wholeWord: true });
	await tick();
	h.target.querySelector('[aria-label="search.tip.UseRegularExpression"]').click();
	h.target.querySelector('[aria-label="search.tip.MatchCase"]').click();
	h.target.querySelector('[aria-label="search.tip.MatchWholeWord"]').click();
	assert.deepEqual(h.component.getSearchCache().options, { regexMode: false, caseSensitive: false, wholeWord: false });
	h.component.setVisible(false); h.component.setVisible(true);
	h.view.file = { path: "b.md" }; h.component.matchAgain(false);
	h.view.getMode = () => "preview"; h.component.setCollapse(false);
	h.view.getMode = () => "source"; h.component.matchAgain(false);
	h.component.refreshToolbar();
	assert.deepEqual(h.component.getSearchCache().options, { regexMode: false, caseSensitive: false, wholeWord: false });
	h.plugin.settings.defaultRegexMode = false; h.plugin.settings.defaultCaseSensitive = false; h.plugin.settings.defaultWholeWord = false;
	h.component.toggleRegexMode(); h.component.toggleMatchCaseMode(); h.component.toggleWholeWordMode();
	h.component.refreshToolbar();
	assert.deepEqual(h.component.getSearchCache().options, { regexMode: true, caseSensitive: true, wholeWord: true });
	const fresh = mount(t, undefined, h.plugin.settings);
	assert.deepEqual(fresh.component.getSearchCache().options, { regexMode: false, caseSensitive: false, wholeWord: false });
	assert.deepEqual(h.component.getSearchCache().options, { regexMode: true, caseSensitive: true, wholeWord: true }, "same-file owners stay independent");
});

function delayedMatcher() {
	const requests = [];
	return { requests, cancel() { this.cancels = (this.cancels ?? 0) + 1; }, destroy() {},
		match(source, query, options) { const pending = deferred(); requests.push({ source, query, options, ...pending }); return pending.promise; } };
}
const matchedCats = { status: "completed", synchronous: false, matches: [{ from: 0, to: 3, index: 0 }, { from: 4, to: 7, index: 1 }] };

function replacementMatcher() {
	const matcher = delayedMatcher();
	matcher.replacements = [];
	matcher.replace = (source, query, replacement, options, index, all) => {
		const pending = deferred(); matcher.replacements.push({ source, query, replacement, options, index, all, ...pending }); return pending.promise;
	};
	return matcher;
}
const candidates = (insert = "cat!", all = false) => ({ ...matchedCats,
	changes: all ? [{ from: 0, to: 3, insert }, { from: 4, to: 7, insert }] : [{ from: 0, to: 3, insert }] });
async function mountReplacement(t) {
	const matcher = replacementMatcher(), h = mount(t, matcher);
	matcher.requests[0].resolve(matchedCats); await settlePosition();
	h.component.getSearchCache().replace = "cat!";
	return { ...h, matcher };
}

test("async replacement commits once, tolerates own editor events, then waits for rematch and positioning before advance", async (t) => {
	const h = await mountReplacement(t), mode = deferred(); h.view.setState = () => mode.promise;
	const original = h.view.editor.cm.dispatch;
	h.view.editor.cm.dispatch = function(spec) { original.call(this, spec); if (spec.changes) h.component.matchAgain(false); };
	const pending = h.component.replaceOnce();
	assert.equal(h.view.editor.getValue(), "cat cat");
	h.component.matchAgain(false); assert.equal(h.matcher.replacements.length, 1);
	h.matcher.replacements[0].resolve(candidates()); const result = await pending;
	assert.equal(result.changed, true); assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.matcher.requests.length, 2); assert.equal(h.component.getSearchCache().index, 0);
	h.matcher.requests[1].resolve({ ...matchedCats, matches: [{ from: 0, to: 3, index: 0 }, { from: 5, to: 8, index: 1 }] });
	await settlePosition(); assert.equal(h.component.getSearchCache().index, 0);
	mode.resolve(); assert.equal(await result.navigationCompletion, true); await settlePosition();
	assert.equal(h.component.getSearchCache().index, 1); assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
	assert.equal(result.afterCount, 2);
});

test("all replacement is one immutable CodeMirror transaction with inverse undo/redo", async (t) => {
	const h = await mountReplacement(t), before = h.view.editor.cm.state.doc;
	const pending = h.component.replaceAllMatchedText("dog"); h.matcher.replacements[0].resolve(candidates("dog", true));
	const result = await pending; assert.equal(result.changeCount, 2); assert.equal(h.view.editor.getValue(), "dog dog");
	const changes = h.specs.filter((spec) => spec.changes); assert.equal(changes.length, 1);
	const transaction = EditorState.create({ doc: before }).update(changes[0]);
	const undone = transaction.state.update({ changes: transaction.changes.invert(before) }).state;
	assert.equal(undone.doc.toString(), "cat cat");
	assert.equal(undone.update({ changes: transaction.changes }).state.doc.toString(), "dog dog");
	h.matcher.requests[1].resolve({ ...matchedCats, matches: [] }); await result.navigationCompletion;
	assert.equal(result.afterCount, 0); assert.equal(h.component.getSearchCache().index, 0);
});

for (const [name, invalidate] of [
	["query away and back", (h) => { h.component.setFindText("dog", false); h.component.setFindText("cat", false); }],
	["option change", (h) => { h.component.getSearchCache().options.regexMode = true; }],
	["whole word identity change", (h) => { h.component.getSearchCache().options.wholeWord = true; }],
	["whole word toggle away and back", (h) => { h.component.toggleWholeWordMode(); h.component.toggleWholeWordMode(); }],
	["document edit", (h) => { h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } }); h.component.matchAgain(false); }],
	["equal-text new doc", (h) => { h.view.editor.cm.state = EditorState.create({ doc: "cat cat" }); }],
	["file identity", (h) => { h.view.file = { path: "a.md" }; }],
	["file rename", (h) => { h.view.file.path = "renamed.md"; }],
	["navigation", (h) => h.component.toNextMatch()],
	["editor rebuild", (h) => { h.view.editor.cm = { state: EditorState.create({ doc: "cat cat" }), dispatch() { throw new Error("must not commit"); } }; }],
	["mode switch", (h) => { h.view.getMode = () => "preview"; }],
	["close reopen", (h) => { h.component.setVisible(false); h.component.setVisible(true); }],
	["replace input", (h) => { h.component.getSearchCache().replace = "different"; }],
	["escape setting", (h) => { h.plugin.settings.useEscapeCharInReplace = true; }],
	["dispose", (h) => h.component.$destroy()],
]) {
	test(`replacement candidates never commit after ${name}`, async (t) => {
		const h = await mountReplacement(t); const pending = h.component.replaceOnce(); invalidate(h);
		const count = h.specs.filter((spec) => spec.changes).length;
		h.matcher.replacements[0].resolve(candidates()); const result = await pending;
		assert.equal(result.changed, false); assert.equal(result.status, "cancelled");
		assert.equal(h.specs.filter((spec) => spec.changes).length, count);
	});
}

test("latest replacement request wins; repeated input cannot commit two stale writes", async (t) => {
	const h = await mountReplacement(t), first = h.component.replaceOnce(), second = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates()); assert.equal((await first).changed, false);
	h.matcher.replacements[1].resolve(candidates()); const result = await second;
	assert.equal(result.changed, true); assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
	h.matcher.requests[1].resolve(matchedCats); await result.navigationCompletion;
});

test("pre-commit replacement failure can be explicitly sync retried without an automatic write", async (t) => {
	const h = await mountReplacement(t); const pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve({ status: "failed", error: new Error("Worker failed") }); const result = await pending; await settlePosition();
	assert.equal(result.changed, false); assert.equal(h.view.editor.getValue(), "cat cat");
	const sync = [...h.target.querySelectorAll(".nya-search-status button")].find((button) => button.textContent === "search.SynchronousRetry");
	assert.ok(sync); sync.click(); await settlePosition();
	assert.equal(h.view.editor.getValue(), "cat! cat"); assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
});

test("post-commit Worker failure reports applied edit and retry only searches, never replays replacement", async (t) => {
	const h = await mountReplacement(t), errors = []; h.plugin.reportError = (key) => errors.push(key);
	const pending = h.component.replaceOnce(); h.matcher.replacements[0].resolve(candidates()); const result = await pending;
	h.matcher.requests[1].resolve({ status: "failed", error: new Error("post-commit crash") });
	assert.equal(await result.navigationCompletion, false); await settlePosition();
	assert.equal(result.changed, true); assert.equal(result.navigationFailed, true);
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
	assert.equal(h.target.querySelector(".nya-search-status span").textContent, "search.ReplacedNavigationFailed");
	const retry = [...h.target.querySelectorAll(".nya-search-status button")].find((button) => button.textContent === "search.Retry");
	retry.click(); await settlePosition(); assert.equal(h.matcher.replacements.length, 1);
	assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
});

test("closing after commit cancels rematch navigation but retains exactly one applied change", async (t) => {
	const h = await mountReplacement(t), pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve(candidates()); const result = await pending;
	h.component.setVisible(false); const count = h.specs.length;
	h.matcher.requests[1].resolve(matchedCats); assert.equal(await result.navigationCompletion, false); await settlePosition();
	assert.equal(h.specs.length, count); assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.component.getSearchCache().index, 0);
});

test("hidden replacement recomputes doc through Worker and preserves hidden next-match behavior", async (t) => {
	const h = await mountReplacement(t); h.component.setVisible(false);
	const pending = h.component.replaceOnce(); h.matcher.replacements[0].resolve(candidates()); const result = await pending;
	h.matcher.requests[1].resolve({ ...matchedCats, matches: [{ from: 0, to: 3, index: 0 }, { from: 5, to: 8, index: 1 }] });
	assert.equal(await result.navigationCompletion, true); assert.equal(h.component.isVisible(), false);
	assert.equal(h.component.getSearchCache().index, 1);
});

test("replace textarea input cancels pending Worker candidates even if user changes away and back", async (t) => {
	const h = await mountReplacement(t), pending = h.component.replaceOnce();
	const input = h.target.querySelector(".replacer textarea");
	input.value = "other"; input.dispatchEvent(new window.Event("input"));
	input.value = "cat!"; input.dispatchEvent(new window.Event("input"));
	h.matcher.replacements[0].resolve(candidates()); assert.equal((await pending).changed, false);
	assert.equal(h.view.editor.getValue(), "cat cat");
});

test("production Worker drives single and all component replacements including post-commit rematch", async (t) => {
	const host = installWorkerHost(window), engine = new MatchEngine(() => window);
	t.after(async () => { engine.destroy(); await host.dispose(); delete window.Worker; });
	const h = mount(t, engine), initial = engine.pending;
	await new Promise((resolve) => { const original = initial.resolve; initial.resolve = (value) => { original(value); resolve(); }; });
	await settlePosition(); h.component.getSearchCache().replace = "cat!";
	const one = await h.component.replaceOnce(); assert.equal(one.changed, true);
	assert.equal(await one.navigationCompletion, true); assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	const all = await h.component.replaceAllMatchedText("dog"); assert.equal(all.changeCount, 2);
	assert.equal(await all.navigationCompletion, true); assert.equal(h.view.editor.getValue(), "dog! dog");
	assert.equal(all.afterCount, 0); assert.equal(host.workers.length, 1, "idle Worker reused across match/replace/rematch");
	assert.equal(h.specs.filter((spec) => spec.changes).length, 2);
	h.component.setVisible(false); assert.equal(host.blobs.size, 0);
});

test("production Worker whole word filters both single and all replacements and post-commit counts", async (t) => {
	const host = installWorkerHost(window), engine = new MatchEngine(() => window);
	t.after(async () => { engine.destroy(); await host.dispose(); delete window.Worker; });
	const h = mount(t, engine, { defaultWholeWord: true }), initial = engine.pending;
	await new Promise((resolve) => { const original = initial.resolve; initial.resolve = (value) => { original(value); resolve(); }; });
	await settlePosition();
	h.view.editor.cm.state = EditorState.create({ doc: "cat2 cat cat_name cat" });
	h.component.getSearchCache().replace = "dog";
	const one = await h.component.replaceOnce();
	assert.equal(one.changeCount, 1); assert.equal(one.beforeCount, 2);
	await one.navigationCompletion;
	assert.equal(one.afterCount, 1); assert.equal(h.view.editor.getValue(), "cat2 dog cat_name cat");
	const all = await h.component.replaceAllMatchedText("dog"); await all.navigationCompletion;
	assert.equal(all.changeCount, 1); assert.equal(all.afterCount, 0);
	assert.equal(h.view.editor.getValue(), "cat2 dog cat_name dog");
});

test("post-commit host positioning rejection never advances and keeps applied write", async (t) => {
	const h = await mountReplacement(t), position = deferred(), errors = [];
	h.view.setState = () => position.promise; h.plugin.reportError = (key) => errors.push(key);
	const pending = h.component.replaceOnce(); h.matcher.replacements[0].resolve(candidates()); const result = await pending;
	h.matcher.requests[1].resolve(matchedCats); await settlePosition(); position.reject(new Error("host rejected"));
	assert.equal(await result.navigationCompletion, false); assert.equal(result.changed, true);
	assert.equal(h.component.getSearchCache().index, 0); assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
});

test("normal replacement retry recomputes candidates in Worker and does not silently become find-only", async (t) => {
	const h = await mountReplacement(t), pending = h.component.replaceOnce();
	h.matcher.replacements[0].resolve({ status: "failed", error: "crash" }); await pending; await settlePosition();
	const button = [...h.target.querySelectorAll(".nya-search-status button")].find((button) => button.textContent === "search.Retry");
	button.click(); assert.equal(h.matcher.replacements.length, 2); assert.equal(h.view.editor.getValue(), "cat cat");
	h.matcher.replacements[1].resolve(candidates()); await settlePosition();
	assert.equal(h.view.editor.getValue(), "cat! cat"); h.matcher.requests[1].resolve(matchedCats); await settlePosition();
});

for (const [name, invalidate] of [
	["document edit", (h) => { h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } }); h.component.matchAgain(false); }],
	["query change", (h) => h.component.setFindText("dog", false)],
	["whole word toggle", (h) => h.component.toggleWholeWordMode()],
	["file change", (h) => { h.view.file = { path: "b.md" }; h.component.matchAgain(false); }],
	["editor rebuild", (h) => { h.view.editor.cm = { state: EditorState.create({ doc: "cat! cat" }), dispatch() {} }; h.component.matchAgain(false); }],
	["destroy", (h) => h.component.$destroy()],
]) {
	test(`post-commit rematch completion is inert after ${name}`, async (t) => {
		const h = await mountReplacement(t), pending = h.component.replaceOnce();
		h.matcher.replacements[0].resolve(candidates()); const result = await pending;
		invalidate(h); const specs = h.specs.length, scrolls = h.scrolls.length;
		h.matcher.requests[1].resolve(matchedCats); assert.equal(await result.navigationCompletion, false); await settlePosition();
		assert.equal(result.changed, true); assert.equal(h.specs.length, specs); assert.equal(h.scrolls.length, scrolls);
	});
}

test("same-file split owners calculate and commit independent replacement requests", async (t) => {
	const a = await mountReplacement(t), b = await mountReplacement(t); b.view.file = a.view.file;
	const first = a.component.replaceOnce(), second = b.component.replaceAllMatchedText("dog");
	b.matcher.replacements[0].resolve(candidates("dog", true)); const secondResult = await second;
	a.matcher.replacements[0].resolve(candidates()); const firstResult = await first;
	assert.equal(a.view.editor.getValue(), "cat! cat"); assert.equal(b.view.editor.getValue(), "dog dog");
	a.matcher.requests[1].resolve(matchedCats); b.matcher.requests[1].resolve({ ...matchedCats, matches: [] });
	assert.equal(await firstResult.navigationCompletion, true); assert.equal(await secondResult.navigationCompletion, true);
	assert.equal(a.specs.filter((spec) => spec.changes).length, 1); assert.equal(b.specs.filter((spec) => spec.changes).length, 1);
});

test("host exception after commit is reported as an applied edit and never offers write replay", async (t) => {
	const h = await mountReplacement(t), original = h.view.editor.cm.dispatch, errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.view.editor.cm.dispatch = function(spec) { original.call(this, spec); if (spec.changes) throw new Error("post-commit host event failed"); };
	const pending = h.component.replaceOnce(); h.matcher.replacements[0].resolve(candidates()); const result = await pending;
	assert.equal(result.changed, true); assert.equal(result.changeCount, 1); assert.equal(result.status, "failed");
	assert.equal(h.view.editor.getValue(), "cat! cat"); assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
	await settlePosition(); const retry = [...h.target.querySelectorAll(".nya-search-status button")].find((button) => button.textContent === "search.Retry");
	retry.click(); assert.equal(h.matcher.replacements.length, 1);
});

test("post-commit effect failure cannot masquerade as an uncommitted replacement", async (t) => {
	const h = await mountReplacement(t), original = h.view.editor.cm.dispatch, errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.view.editor.cm.dispatch = function(spec) { if (!spec.changes) throw new Error("effect failed"); original.call(this, spec); };
	const pending = h.component.replaceOnce(); h.matcher.replacements[0].resolve(candidates()); const result = await pending;
	assert.equal(result.changed, true); assert.equal(result.status, "failed"); assert.equal(result.navigationFailed, true);
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]); assert.equal(h.view.editor.getValue(), "cat! cat");
});

test("production controller sync compatibility preserves single-replace advancement and all-replace semantics", async (t) => {
	const engine = new MatchEngine(() => window); t.after(() => engine.destroy());
	const h = mount(t, engine); h.component.getSearchCache().replace = "cat!";
	const one = h.component.replaceOnce(); assert.ok(!(one instanceof Promise));
	assert.equal(one.changed, true); assert.equal(one.afterCount, 2); assert.equal(h.component.getSearchCache().index, 1);
	const all = h.component.replaceAllMatchedText("dog"); assert.equal(all.changed, true);
	assert.equal(h.view.editor.getValue(), "dog! dog"); assert.equal(all.afterCount, 0);
});

test("regex replacement input escapes are decoded once before candidate transport", async (t) => {
	const h = await mountReplacement(t); h.plugin.settings.useEscapeCharInReplace = true;
	h.component.getSearchCache().options.regexMode = true;
	const pending = h.component.replaceAllMatchedText("$&\\n\\t\\\\n\0");
	assert.equal(h.matcher.replacements[0].replacement, "$&\n\t\\n\0");
	h.matcher.replacements[0].resolve({ status: "cancelled" }); assert.equal((await pending).changed, false);
});

test("asynchronous editor find preserves queued user navigation across background refresh", async (t) => {
	const matcher = delayedMatcher(), h = mount(t, matcher); await tick();
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "…");
	h.component.toNextMatch(); h.component.matchAgain(false); h.component.toNextMatch(); h.component.toPreviousMatch();
	assert.equal(matcher.requests.length, 1);
	matcher.requests[0].resolve(matchedCats); await settlePosition();
	assert.equal(h.component.getSearchCache().index, 1); assert.equal(h.scrolls.at(-1).from, 4);
	assert.equal(h.component.getSearchCache().matches.length, 2);
});

for (const [name, invalidate] of [
	["query away and back", (h) => { h.component.setFindText("dog", false); h.component.setFindText("cat", false); }],
	["document identity", (h) => h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } })],
	["file identity", (h) => { h.view.file = { path: "other.md" }; }],
	["editor rebuild", (h) => { h.view.editor.cm = { state: EditorState.create({ doc: "cat cat" }), dispatch() { throw new Error("old result dispatched"); } }; }],
	["close/reopen", (h) => { h.component.setVisible(false); h.component.setVisible(true, "cat"); }],
	["destroy", (h) => h.component.$destroy()],
]) {
	test(`asynchronous editor result is rejected after ${name}`, async (t) => {
		const matcher = delayedMatcher(), h = mount(t, matcher); await tick(); invalidate(h);
		const before = h.specs.length, scrolls = h.scrolls.length;
		matcher.requests[0].resolve(matchedCats); await settlePosition();
		assert.equal(h.specs.length, before); assert.equal(h.scrolls.length, scrolls);
	});
}

test("Worker execution failure is visible and sync retry requires explicit user action", async (t) => {
	const matcher = delayedMatcher(), h = mount(t, matcher);
	matcher.requests[0].resolve({ status: "failed", error: new Error("Worker crash") }); await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 0);
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "!");
	assert.equal(h.target.querySelector(".nya-search-status span").textContent, "search.WorkerFailed");
	const retry = [...h.target.querySelectorAll(".nya-search-status button")].find((button) => button.textContent === "search.SynchronousRetry");
	assert.ok(retry); assert.equal(matcher.requests.length, 1); retry.click(); await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 2); assert.equal(matcher.requests.length, 1);
});

test("production Worker computes actual component matches and closing terminates owned resources", async (t) => {
	const host = installWorkerHost(window), engine = new MatchEngine(() => window);
	t.after(async () => { engine.destroy(); await host.dispose(); delete window.Worker; });
	const h = mount(t, engine);
	// Await the exact controller result without introducing a sleep-based test.
	const result = engine.pending;
	assert.ok(result);
	await new Promise((resolve) => { const original = result.resolve; result.resolve = (value) => { original(value); resolve(); }; });
	await settlePosition(); assert.equal(h.component.getSearchCache().matches.length, 2);
	h.component.setVisible(false); assert.equal(host.blobs.size, 0); assert.equal(host.workers[0].terminated, true);
});

test("reading async match retains navigation, caches offsets and maps detached endpoints", async (t) => {
	const matcher = delayedMatcher(), h = mountReading(t, matcher); await tick();
	assert.equal(matcher.requests.length, 1);
	h.component.toNextMatch(); h.component.matchAgain(false); h.component.toNextMatch();
	const source = matcher.requests[0].source;
	const helper = loadSource("../src/util/text-helper.ts");
	matcher.requests[0].resolve({ status: "completed", synchronous: false, matches: helper.findTextOffsets(source, "cat", false, false) });
	await settlePosition(); assert.equal(h.component.getSearchCache().matches.length, 3);
	assert.equal(h.component.getSearchCache().index, 2); assert.equal(h.scrolls.at(-1), h.sections[1]);
	h.component.toPreviousMatch(); await settlePosition(); assert.equal(matcher.requests.length, 1);
});

test("reading async result cannot paint or scroll a mutated DOM index", async (t) => {
	const matcher = delayedMatcher(), h = mountReading(t, matcher); await tick();
	h.sections[0].el.querySelector("p").textContent = "dog";
	matcher.requests[0].resolve(matchedCats); await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 0); assert.equal(h.scrolls.length, 0);
	assert.equal(window.CSS.highlights.has("nya-reading-current"), false);
});

test("reading Worker execution error offers explicit synchronous retry without automatic replay", async (t) => {
	const matcher = delayedMatcher(), h = mountReading(t, matcher);
	matcher.requests[0].resolve({ status: "failed", error: new Error("Worker crash") }); await settlePosition();
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "!");
	const retry = [...h.target.querySelectorAll(".nya-search-status button")].find((button) => button.textContent === "search.SynchronousRetry");
	assert.ok(retry); retry.click(); await settlePosition();
	assert.equal(h.component.getSearchCache().matches.length, 3); assert.equal(matcher.requests.length, 1);
});

test("reading query supersession and close refuse old worker offsets and endpoint mapping", async (t) => {
	const matcher = delayedMatcher(), h = mountReading(t, matcher); await tick();
	h.component.setFindText("tail", false); const old = matcher.requests[0];
	old.resolve(matchedCats); await settlePosition(); assert.equal(h.component.getSearchCache().matches.length, 0);
	h.component.setVisible(false); matcher.requests[1].resolve(matchedCats); await settlePosition();
	assert.equal(window.CSS.highlights.has("nya-reading-matches"), false); assert.equal(h.scrolls.length, 0);
});

test("async replacement positioning commits once and advances only after success", async (t) => {
	const h = mount(t); await tick(); const position = deferred();
	h.component.getSearchCache().replace = "cat!";
	h.view.setState = () => position.promise;
	const result = h.component.replaceOnce();
	assert.equal(result.changed, true); assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.component.getSearchCache().index, 0);
	position.resolve(); assert.equal(await result.navigationCompletion, true); await settlePosition();
	assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(h.specs.filter((spec) => spec.changes).length, 1);
});

test("async replacement mode rejection prevents additional navigation and reports committed edit", async (t) => {
	const h = mount(t); await tick(); const position = deferred(); const errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.component.getSearchCache().replace = "cat!";
	h.view.setState = () => position.promise;
	const result = h.component.replaceOnce();
	position.reject(new Error("host rejected"));
	assert.equal(await result.navigationCompletion, false); await settlePosition();
	assert.equal(result.changed, true); assert.equal(result.navigationFailed, true);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.component.getSearchCache().index, 0);
	assert.equal(h.scrolls.length, 1);
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
});

for (const [name, invalidate] of [
	["close and reopen", (h) => { h.component.setVisible(false); h.view.setState = () => {}; h.component.setVisible(true, "cat"); }],
	["query changes away and back", (h) => { h.component.setFindText("dog", false); h.component.setFindText("cat", false); }],
	["document edit", (h) => h.view.editor.cm.dispatch({ changes: { from: 0, insert: "prefix " } })],
	["file switch", (h) => { h.view.file = { path: "b.md" }; }],
	["unload", (h) => h.component.$destroy()],
]) {
	test(`late async replacement position is inert after ${name}`, async (t) => {
		const h = mount(t); await tick(); const position = deferred();
		h.component.getSearchCache().replace = "cat!"; h.view.setState = () => position.promise;
		const result = h.component.replaceOnce(); invalidate(h);
		const count = h.specs.length; const scrolls = h.scrolls.length;
		position.resolve(); assert.equal(await result.navigationCompletion, false); await settlePosition();
		assert.equal(h.specs.length, count); assert.equal(h.scrolls.length, scrolls);
		assert.equal(h.specs.filter((spec) => spec.changes && spec.changes[0]?.insert === "cat!").length, 1);
	});
}

test("out-of-order same-query navigation only selects the newest requested match", async (t) => {
	const h = mount(t); await tick(); const first = deferred(), second = deferred();
	let calls = 0; h.view.setState = () => (++calls === 1 ? first : second).promise;
	h.component.toNextMatch(); h.component.toPreviousMatch();
	const count = h.specs.length;
	second.resolve(); await settlePosition();
	assert.equal(h.specs.at(-1).selection.anchor, 0);
	const selected = h.specs.length; assert.equal(selected, count + 1);
	first.resolve(); await settlePosition(); assert.equal(h.specs.length, selected);
});

test("async mode rebuild refreshes matches without dispatching old coordinates or advancing", async (t) => {
	const h = mount(t); await tick(); const position = deferred();
	h.component.getSearchCache().replace = "cat!"; h.view.setState = () => position.promise;
	const result = h.component.replaceOnce();
	const old = h.view.editor.cm; let lateOldDispatch = 0;
	old.dispatch = () => lateOldDispatch++;
	h.view.editor.cm = { state: EditorState.create({ doc: "prefix cat! cat" }), dispatch(spec) {
		h.specs.push(spec); this.state = this.state.update({ changes: spec.changes, selection: spec.selection }).state;
	} };
	position.resolve(); assert.equal(await result.navigationCompletion, false); await settlePosition();
	assert.equal(lateOldDispatch, 0); assert.equal(h.component.getSearchCache().index, 0);
	assert.equal(h.component.getSearchCache().matches[0].from, 7);
	assert.equal(h.specs.at(-1).selection, undefined);
});

test("late positioning rejection after destruction has no notice or editor effects", async (t) => {
	const h = mount(t); await tick(); const position = deferred(); const errors = [];
	h.plugin.reportError = (key) => errors.push(key); h.view.setState = () => position.promise;
	h.component.getSearchCache().replace = "cat!";
	const result = h.component.replaceOnce(); h.component.$destroy();
	const count = h.specs.length; position.reject(new Error("late rejection"));
	assert.equal(await result.navigationCompletion, false); await settlePosition();
	assert.deepEqual(errors, []); assert.equal(h.specs.length, count);
});

test("hidden replacement retains safe async next-match behavior while the finder stays hidden", async (t) => {
	const h = mount(t); await tick(); h.component.setVisible(false);
	const position = deferred(); h.view.setState = () => position.promise;
	h.component.getSearchCache().replace = "cat!";
	const result = h.component.replaceOnce(); assert.equal(h.view.editor.getValue(), "cat! cat");
	position.resolve(); assert.equal(await result.navigationCompletion, true); await settlePosition();
	assert.equal(h.component.isVisible(), false); assert.equal(h.component.getSearchCache().index, 1);
});

function mountReading(t, matcher, settings = {}) {
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
		settings: { enableInputHotkeys: true, enableHistory: true, historyMaxCount: 10, searchHistory: [], ...settings },
		saveSettings: async () => {},
	};
	attachHistory(plugin);
	let component;
	const search = new ReadingSearch(view, () => true, () => component.matchAgain(false), 5000, matcher);
	component = new SearchBox({ target, props: { cid: "reading", ownerView: view, editorSearch: {
		plugin, getEditorContext: () => null, canSearchReading: () => true,
		getReadingSearch: () => search, clearReadingSearch: () => search.clear(),
	} } });
	t.after(() => { search.destroy(); component.$destroy(); target.remove(); });
	component.setVisible(true, "cat");
	scrolls.length = 0;
	return { component, target, preview, view, sections, plugin, scrolls, renderer, search };
}

test("reading whole word control uses logical boundaries, not inline formatting boundaries", async (t) => {
	const h = mountReading(t); await tick();
	h.sections[0].el.innerHTML = "<p>ca<strong>t</strong> cat<span>2</span> xcat cat_name</p>";
	h.component.matchAgain(false); assert.equal(h.component.getSearchCache().matches.length, 5);
	h.target.querySelector('[aria-label="search.tip.MatchWholeWord"]').click(); await tick();
	assert.equal(h.component.getSearchCache().matches.length, 2);
	assert.equal(h.component.getSearchCache().options.wholeWord, true);
	h.component.toNextMatch(); await tick();
	assert.equal(h.scrolls.at(-1), h.sections[1]);
});

test("reading finder initializes defaults and preserves manual options across actual mode changes", async (t) => {
	const h = mountReading(t, undefined, { defaultRegexMode: true, defaultCaseSensitive: true, defaultWholeWord: true }); await tick();
	assert.deepEqual(h.component.getSearchCache().options, { regexMode: true, caseSensitive: true, wholeWord: true });
	assert.equal(h.component.getSearchCache().matches.length, 2);
	h.component.setFindText("c.t", false); await tick();
	assert.equal(h.component.getSearchCache().matches.length, 2, "default regex is used by the reading matcher");
	h.target.querySelector('[aria-label="search.tip.MatchCase"]').click(); await tick();
	h.view.getMode = () => "source"; h.component.matchAgain(false); await tick();
	h.view.getMode = () => "preview"; h.component.matchAgain(false); await tick();
	h.component.setVisible(false); h.component.setVisible(true); await tick();
	assert.deepEqual(h.component.getSearchCache().options, { regexMode: true, caseSensitive: false, wholeWord: true });
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

for (const signal of ["isComposing", "composition events", "legacy 229"]) {
	for (const code of ["Enter", "NumpadEnter", "ArrowUp", "ArrowDown"]) {
		test(`IME ${signal}: search ${code} does not navigate or change history`, async (t) => {
			const h = mount(t); await tick();
			h.plugin.history.record("dog");
			const input = h.target.querySelector("textarea");
			input.selectionStart = 0;
			if (signal === "composition events") input.dispatchEvent(new window.CompositionEvent("compositionstart", { bubbles: true }));
			const event = new window.KeyboardEvent("keydown", {
				key: code === "NumpadEnter" ? "Enter" : code, code, bubbles: true, cancelable: true,
				isComposing: signal === "isComposing", keyCode: signal === "legacy 229" ? 229 : 0,
			});
			const saves = h.saves();
			input.dispatchEvent(event); await tick();
			assert.equal(event.defaultPrevented, false);
			assert.equal(h.component.getSearchCache().search, "cat");
			assert.equal(h.component.getSearchCache().index, 0);
			assert.equal(h.scrolls.length, 0);
			assert.equal(h.saves(), saves);
			input.dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true }));
			input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
			await tick(); assert.equal(h.component.getSearchCache().index, 1);
		});
	}
	for (const code of ["Enter", "NumpadEnter"]) {
		test(`IME ${signal}: replacement ${code} does not write until composition ends`, async (t) => {
			const h = mount(t); h.component.setCollapse(false); await tick();
			const input = h.target.querySelector(".replacer textarea");
			input.value = "DOG"; input.dispatchEvent(new window.Event("input", { bubbles: true }));
			if (signal === "composition events") input.dispatchEvent(new window.CompositionEvent("compositionstart", { bubbles: true }));
			const event = new window.KeyboardEvent("keydown", {
				key: "Enter", code, bubbles: true, cancelable: true,
				isComposing: signal === "isComposing", keyCode: signal === "legacy 229" ? 229 : 0,
			});
			input.dispatchEvent(event); await tick();
			assert.equal(event.defaultPrevented, false);
			assert.equal(h.view.editor.getValue(), "cat cat");
			assert.equal(h.specs.filter((spec) => spec.changes).length, 0);
			input.dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true }));
			input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", code, bubbles: true }));
			await tick(); assert.equal(h.view.editor.getValue(), "DOG cat");
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
	{ replacement: "cat!", content: "cat! cat", next: 1, scrollCount: 2, range: { from: 5, to: 8 } },
	{ replacement: "cat", content: "cat cat", next: 1, scrollCount: 2, range: { from: 4, to: 7 } },
	{ replacement: "DOG", content: "DOG cat", next: 0, scrollCount: 1, range: { from: 4, to: 7 } },
	{ replacement: "cat!", index: 1, content: "cat cat!", next: 0, scrollCount: 2, range: { from: 0, to: 3 } },
	{ replacement: "DOG", query: "fox", content: "cat cat", next: 0, scrollCount: 0 },
]) {
	for (const entry of ["button", "Enter", "command"]) {
		test(`single replacement ${entry}: ${query} → ${replacement}, starting index ${index}`, async (t) => {
			const h = mount(t); h.component.setCollapse(false); await tick();
			h.component.setFindText(query, false);
			h.component.getSearchCache().index = index;
			const input = h.target.querySelector(".replacer textarea");
			input.value = replacement; input.dispatchEvent(new window.Event("input", { bubbles: true }));
			h.scrolls.length = 0; h.specs.length = 0;
			if (entry === "command") replacementCommand(h)();
			else if (entry === "Enter") input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
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
	const h = mount(t); h.component.setCollapse(false); await tick();
	const root = h.target.querySelector(".nya-finder");
	const input = root.querySelector("textarea");
	input.focus(); assert.equal(document.activeElement, input);
	h.component.setVisible(false); await tick();
	assert.equal(root.getAttribute("aria-hidden"), "true");
	assert.equal(window.getComputedStyle(root).visibility, "hidden");
	assert.ok(!root.contains(document.activeElement));
	for (const control of root.querySelectorAll('textarea, [role="button"], button')) {
		assert.equal(control.tabIndex, -1);
		control.focus(); assert.ok(!root.contains(document.activeElement));
	}
	h.component.setVisible(true, "cat");
	assert.equal(document.activeElement, input, "opening must focus before the next Svelte flush");
	await tick();
	assert.equal(root.getAttribute("aria-hidden"), "false");
	assert.equal(window.getComputedStyle(root).visibility, "visible");
	assert.equal(input.selectionStart, 0); assert.equal(input.selectionEnd, 3);
	assert.equal(input.tabIndex, 0);
	h.component.setCollapse(false); await tick();
	assert.equal(root.querySelector(".replacer textarea").tabIndex, 1);
	h.component.resetAll(); await tick();
	assert.ok(!root.contains(document.activeElement));
	assert.equal(input.tabIndex, -1);
});

test("hiding Finder closes More without restoring focus into hidden controls", async (t) => {
	const h = mount(t);
	h.plugin.settings.searchToolbar = toolbarSource.defaultToolbar("search").map((item) => ({ ...item, placement: "more" }));
	h.component.refreshToolbar(); await tick();
	h.target.querySelector('[aria-label="search.tip.More"]').click(); await tick();
	assert.ok(h.target.querySelector('[role="menu"]'));
	const menu = h.target.querySelector('[role="menu"]');
	assert.equal(menu.hasAttribute('aria-label'), false, 'menu container does not create a hover tooltip');
	assert.equal(h.target.ownerDocument.getElementById(menu.getAttribute('aria-labelledby')), h.target.querySelector('[aria-label="search.tip.More"]'));
	assert.ok(h.target.contains(document.activeElement));
	h.component.setVisible(false); await tick();
	assert.equal(h.target.querySelector('[role="menu"]'), null);
	assert.ok(!h.target.contains(document.activeElement));
	assert.equal(h.target.querySelector('[aria-label="search.tip.More"]').tabIndex, -1);
});

test("reading Finder has no focusable hidden controls and reopens with the query selected", async (t) => {
	const h = mountReading(t); await tick();
	h.component.setVisible(false); await tick();
	const root = h.target.querySelector(".nya-finder");
	for (const control of root.querySelectorAll('textarea, [role="button"], button')) assert.equal(control.tabIndex, -1);
	h.component.setVisible(true, "cat"); await tick();
	assert.equal(document.activeElement, root.querySelector("textarea"));
	assert.equal(root.querySelector("textarea").selectionEnd, 3);
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

test("default toolbar keeps order, button geometry and active styling without More", async (t) => {
	const h = mount(t); await tick();
	assert.deepEqual([...h.target.querySelectorAll('.finder-act [role="button"]')].map((el) => el.getAttribute("aria-label")),
		["search.tip.UseRegularExpression", "search.tip.MatchCase", "search.tip.MatchWholeWord", "search.tip.PreviousMatch", "search.tip.NextMatch", "search.tip.Close"]);
	assert.equal(h.target.querySelector('[aria-label="search.tip.More"]'), null);
	const button = h.target.querySelector('[aria-label="search.tip.UseRegularExpression"]');
	const style = window.getComputedStyle(button);
	assert.equal(style.width, "24px"); assert.equal(style.height, "24px"); assert.equal(style.margin, "2px"); assert.equal(style.padding, "4px");
	button.click(); await tick();
	assert.ok(button.classList.contains("nya-btn--active"));
	assert.equal(button.getAttribute("aria-pressed"), "true");
	assert.equal(window.getComputedStyle(button).backgroundColor, "rgba(36, 137, 219, 0.51)");
	button.click(); await tick(); assert.ok(!button.classList.contains("nya-btn--active"));
});

test("mobile search actions size to their buttons rather than the old four-button width", async (t) => {
	const h = mount(t); await tick();
	document.body.classList.add("is-mobile"); h.target.querySelector(".nya-finder").classList.add("nya-mobile");
	t.after(() => document.body.classList.remove("is-mobile"));
	const style = window.getComputedStyle(h.target.querySelector(".finder-act"));
	assert.equal(style.width, "auto"); assert.equal(style.flexShrink, "0");
	assert.equal(window.getComputedStyle(h.target.querySelector(".replacer-act")).width, "112px");
});

test("configured toolbars update immediately, More toggles preserve state and Escape does not close Finder", async (t) => {
	const h = mount(t); await tick();
	h.plugin.settings.searchToolbar = [{ id: "case", placement: "inline" }, { id: "regex", placement: "more" },
		{ id: "previous", placement: "hidden" }, { id: "next", placement: "inline" }, { id: "history", placement: "more" }];
	h.plugin.settings.replaceToolbar = toolbarSource.defaultToolbar("replace");
	h.component.refreshToolbar(); await tick();
	assert.equal(h.target.querySelector('[aria-label="search.tip.PreviousMatch"]'), null);
	const more = h.target.querySelector('[aria-label="search.tip.More"]'); more.click(); await tick();
	let regex = h.target.querySelector('[role="menuitemcheckbox"]'); assert.equal(regex.getAttribute("aria-checked"), "false");
	regex.click(); await tick(); assert.equal(h.component.getSearchCache().options.regexMode, true);
	more.click(); await tick(); regex = h.target.querySelector('[role="menuitemcheckbox"]'); assert.equal(regex.getAttribute("aria-checked"), "true");
	regex.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await tick();
	assert.equal(h.target.querySelector('[role="menu"]'), null); assert.equal(h.component.isVisible(), true);
	h.plugin.settings.enableHistory = false; h.component.refreshToolbar(); more.click(); await tick();
	assert.equal(h.target.querySelector('[role="menuitem"]').disabled, true);
	document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })); await tick(); assert.equal(h.target.querySelector('[role="menu"]'), null);
});

test("render waiting uses a compact count marker and delayed external status, cleared on completion", async (t) => {
	const h = mountReading(t); await tick();
	h.renderer.rendered = []; h.component.matchAgain(false); await tick();
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "…");
	assert.equal(h.target.querySelector(".nya-search-status"), null);
	await new Promise((resolve) => setTimeout(resolve, 430)); await tick();
	const status = h.target.querySelector(".nya-search-status"); assert.ok(status);
	assert.equal(status.parentElement.classList.contains("nya-finder"), true);
	assert.equal(window.getComputedStyle(status).position, "absolute");
	assert.equal(window.getComputedStyle(status).pointerEvents, "none");
	assert.equal(status.querySelector("span").textContent.trim(), "search.ReadingPending");
	h.renderer.rendered = null; h.component.matchAgain(false); await tick();
	assert.equal(h.target.querySelector(".nya-search-status"), null);
	assert.equal(h.component.getSearchCache().matches.length, 3);
});

test("pending status delay resets for new queries and closing cancels it", async (t) => {
	const h = mountReading(t); await tick();
	h.renderer.rendered = []; h.component.matchAgain(false); await tick();
	await new Promise((resolve) => setTimeout(resolve, 250)); h.component.setFindText("tail", false); await tick();
	await new Promise((resolve) => setTimeout(resolve, 220)); await tick(); assert.equal(h.target.querySelector(".nya-search-status"), null);
	h.component.setVisible(false); await tick();
	await new Promise((resolve) => setTimeout(resolve, 220)); await tick(); assert.equal(h.target.querySelector(".nya-search-status"), null);
});

test("external failures have retry and native actions without putting long text into the counter", async (t) => {
	const h = mountReading(t); await tick();
	const original = h.renderer.showSection;
	h.renderer.showSection = () => { throw new Error("broken"); }; h.component.toNextMatch(); await tick();
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "!");
	const status = h.target.querySelector(".nya-search-status"); assert.ok(status.textContent.includes("search.ReadingFailed"));
	h.renderer.showSection = original; status.querySelector("button").click(); await tick();
	assert.equal(h.target.querySelector(".nya-search-status"), null); assert.equal(h.component.getSearchCache().matches.length, 3);
});

test("file changes reset a pending status delay even when the query is unchanged", async (t) => {
	const h = mountReading(t); await tick();
	h.renderer.rendered = []; h.component.matchAgain(false); await tick();
	await new Promise((resolve) => setTimeout(resolve, 250));
	h.view.file = { path: "b.md" }; h.component.matchAgain(false); await tick();
	await new Promise((resolve) => setTimeout(resolve, 220)); await tick();
	assert.equal(h.target.querySelector(".nya-search-status"), null);
});

test("hiding a button does not remove the search or replacement action", async (t) => {
	const h = mount(t); await tick();
	h.plugin.settings.searchToolbar = toolbarSource.defaultToolbar("search").map((item) => ({ ...item, placement: "hidden" }));
	h.plugin.settings.replaceToolbar = toolbarSource.defaultToolbar("replace").map((item) => ({ ...item, placement: "hidden" }));
	h.component.refreshToolbar(); await tick();
	assert.equal(h.target.querySelector('[aria-label="search.tip.NextMatch"]'), null);
	h.component.toNextMatch(); await tick(); assert.equal(h.component.getSearchCache().index, 1);
	assert.equal(typeof h.component.replaceMatchedText, "function");
	assert.ok(h.target.querySelector('[aria-label="search.tip.Close"]'));
	assert.ok(h.target.querySelector('[aria-label="search.tip.ToggleReplace"]'));
});

test("unsupported reading renderer offers native find outside the match counter", async (t) => {
	const h = mountReading(t); await tick();
	delete window.Highlight; h.component.matchAgain(false); await tick();
	const status = h.target.querySelector(".nya-search-status");
	assert.ok(status.textContent.includes("search.ReadingUnsupported"));
	assert.equal(status.querySelectorAll("button").length, 1);
	assert.equal(h.target.querySelector(".nya-tip").textContent.trim(), "!");
});

function mockLayoutObserver(t) {
	const previous = window.ResizeObserver;
	const observers = [];
	window.ResizeObserver = class {
		observed = [];
		constructor(callback) { this.callback = callback; observers.push(this); }
		observe(element) { this.observed.push(element); }
		disconnect() { this.disconnected = true; }
	};
	t.after(() => { if (previous) window.ResizeObserver = previous; else delete window.ResizeObserver; });
	return observers;
}

test("replacement spacer shrinks with the current counter without depending on the previously expanded row", async (t) => {
	const observers = mockLayoutObserver(t);
	const h = mount(t); h.component.setCollapse(false); await tick();
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
	for (const element of [h.target.querySelector(".nya-finder"), h.target.querySelector(".finder"), h.target.querySelector("textarea")]) {
		element.getBoundingClientRect = () => { throw new Error("spacer must not read its own dependent geometry"); };
	}
	observer.callback(); await tick(); assert.equal(replace.style.paddingRight, "184px");
	for (let cycle = 0; cycle < 3; cycle++) {
		countWidth = 148.36; observer.callback(); await tick(); assert.equal(replace.style.paddingRight, "232.36px");
		countWidth = 117.81; observer.callback(); await tick(); assert.equal(replace.style.paddingRight, "201.81px");
		countWidth = 100; h.component.setFindText("", false); observer.callback(); await tick();
		assert.equal(replace.style.paddingRight, "184px");
	}
	h.component.$destroy(); assert.equal(observer.disconnected, true);
});

test("custom toolbar and collapsed layouts do not retain or receive the default replacement spacer", async (t) => {
	const observers = mockLayoutObserver(t);
	const h = mount(t); h.component.setCollapse(false); await tick();
	const count = h.target.querySelector(".nya-tip");
	const actions = h.target.querySelector(".finder-act");
	const replace = h.target.querySelector(".replacer-act");
	const toolbar = replace.querySelector(".nya-toolbar");
	const observer = observers.find((entry) => entry.observed.includes(count));
	count.getBoundingClientRect = () => ({ width: 148.36 });
	actions.getBoundingClientRect = () => ({ width: 140 });
	toolbar.getBoundingClientRect = () => ({ width: 56 });
	observer.callback(); await tick(); assert.equal(replace.style.paddingRight, "232.36px");
	h.component.setCollapse(true); await tick(); observer.callback(); await tick(); assert.equal(replace.style.paddingRight, "");
	h.component.setCollapse(false); await tick();
	h.plugin.settings.searchToolbar = toolbarSource.defaultToolbar("search").map((item) => ({ ...item, placement: "more" }));
	h.component.refreshToolbar(); await tick(); observer.callback(); await tick(); assert.equal(replace.style.paddingRight, "");
});

for (const [name, vault, expected] of [
	["live preview enabled", { getConfig: () => true }, false],
	["live preview disabled", { getConfig: () => false }, true],
	["internal configuration API unavailable", {}, undefined],
	["internal preference is not a boolean", { getConfig: () => "true" }, undefined],
	["internal preference getter throws", { getConfig: () => { throw new Error("host failure"); } }, undefined],
]) {
	test(`closing Finder safely restores the editor preference: ${name}`, async (t) => {
		const h = mount(t); await tick();
		const states = [];
		h.plugin.settings.sourceModeWhenSearch = true;
		h.plugin.app = { vault };
		// Keep the real component action and owner context; only observe mode writes.
		h.view.setState = (state) => states.push({ ...state });
		h.component.closeFinder(); await tick();
		assert.equal(h.component.isVisible(), false);
		assert.deepEqual(states.map((state) => state.source), expected === undefined ? [] : [expected]);
	});
}

test("close clears both inputs only when configured, preserving all match preferences", async (t) => {
	const h = mount(t); await tick();
	h.component.toggleRegexMode(); h.component.toggleMatchCaseMode(); h.component.toggleWholeWordMode();
	h.component.getSearchCache().replace = "dog";
	h.component.closeFinder();
	assert.equal(h.component.getSearchCache().search, "cat");
	assert.equal(h.component.getSearchCache().replace, "dog");
	h.component.setVisible(true); h.plugin.settings.clearAfterHidden = true;
	h.component.closeFinder(); await tick();
	assert.equal(h.component.getSearchCache().search, "");
	assert.equal(h.component.getSearchCache().replace, "");
	assert.deepEqual(h.component.getSearchCache().options, { regexMode: true, caseSensitive: true, wholeWord: true });
	h.component.setVisible(true); assert.equal(h.component.getSearchCache().replace, "");
});

test("all user close entry points restore mode once; hidden close is inert", async (t) => {
	const h = mount(t); await tick();
	const states = []; h.plugin.settings.sourceModeWhenSearch = true;
	h.plugin.app = { vault: { getConfig: () => true }, workspace: { getActiveViewOfType: () => h.view, iterateAllLeaves: (fn) => fn({ view: h.view }), on() {} } };
	h.view.setState = (state) => { states.push(state.source); };
	const commands = new Map(); h.plugin.addCommand = (cmd) => commands.set(cmd.id, cmd); h.plugin.registerEvent = () => {};
	const search = new EditorSearch(h.plugin); search.finderViews.set(h.view, h.component);
	search.registerFinderEvent({ containerEl: h.target }, h.component);
	for (const close of [
		() => h.target.querySelector('[aria-label="search.tip.Close"]').click(),
		() => h.target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", cancelable: true })),
		() => commands.get("text-finder-hide-find").checkCallback(false),
		() => commands.get("text-finder-toggle-find").checkCallback(false),
	]) {
		h.component.setVisible(true, "cat"); states.length = 0;
		close(); assert.equal(h.component.isVisible(), false); assert.deepEqual(states, [false]);
		h.component.closeFinder(); assert.deepEqual(states, [false]);
	}
	search.finderViews.clear(); search.destoryAll();
});

test("mode failures still hide Finder and rejected promises are reported", async (t) => {
	const h = mount(t); await tick(); const errors = [];
	h.plugin.reportError = (key) => errors.push(key); h.plugin.settings.sourceModeWhenSearch = true;
	h.plugin.app = { vault: { getConfig: () => true } };
	for (const action of [() => { throw new Error("sync"); }, () => Promise.reject(new Error("async"))]) {
		h.component.setVisible(true, ""); h.view.setState = action;
		h.component.closeFinder(); await Promise.resolve();
		assert.equal(h.component.isVisible(), false);
	}
	assert.deepEqual(errors, ["search.EditorFailed", "search.EditorFailed"]);
});

test("live history removal selects neighbours without scrolling and empty history restores the draft", async (t) => {
	const h = mount(t); await tick();
	h.plugin.settings.searchHistory = ["A", "B", "C"].map((text, index) => ({ text, count: 1, createdAt: 3 - index, lastUsedAt: 3 - index }));
	h.plugin.history.notify(); h.component.setVisible(true, "draft");
	const input = h.target.querySelector("textarea");
	const up = async () => { input.selectionStart = 0; input.dispatchEvent(new window.KeyboardEvent("keydown", { code: "ArrowUp" })); await tick(); };
	await up(); await up(); assert.equal(input.value, "B"); h.scrolls.length = 0;
	h.plugin.history.remove(new Set(["B"])); await tick(); assert.equal(input.value, "C"); assert.equal(h.scrolls.length, 0);
	h.plugin.history.remove(new Set(["C"])); await tick(); assert.equal(input.value, "A");
	h.plugin.history.remove(new Set(["A"])); await tick(); assert.equal(input.value, "draft");
});

test("Meta Enter does not navigate or replace", async (t) => {
	const h = mount(t); h.component.setCollapse(false); await tick();
	for (const input of h.target.querySelectorAll("textarea")) {
		input.dispatchEvent(new window.KeyboardEvent("keydown", { code: "Enter", metaKey: true, cancelable: true }));
	}
	assert.equal(h.component.getSearchCache().index, 0);
	assert.equal(h.view.editor.getValue(), "cat cat"); assert.equal(h.scrolls.length, 0);
});

test("successful replacement with failed positioning reports completion without retrying the write", async (t) => {
	const h = mount(t); await tick(); const errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.view.editor.scrollIntoView = () => { throw new Error("scroll failed"); };
	const result = h.component.replaceOnce();
	assert.equal(result.changed, true); // Default empty replacement removes one match.
	assert.equal(result.navigationFailed, true);
	assert.equal(h.view.editor.getValue(), " cat");
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
});

test("same-count replacement positioning failure does not advance or repeat the write", async (t) => {
	const h = mount(t); await tick(); const errors = [];
	h.plugin.reportError = (key) => errors.push(key);
	h.component.getSearchCache().replace = "cat!";
	h.view.editor.scrollIntoView = () => { throw new Error("scroll failed"); };
	const result = h.component.replaceOnce();
	assert.equal(result.changed, true); assert.equal(result.changeCount, 1);
	assert.equal(result.navigationFailed, true);
	assert.equal(h.view.editor.getValue(), "cat! cat");
	assert.equal(h.component.getSearchCache().index, 0);
	assert.deepEqual(errors, ["search.ReplacedNavigationFailed"]);
});
