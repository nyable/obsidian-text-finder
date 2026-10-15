import assert from "node:assert/strict";
import test from "node:test";
import { build } from "vite";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";
import * as cmLanguage from "@codemirror/language";
import { embeddedSources, hostExternal, root, releaseAssets } from "../tools/vite-build.mjs";

test("Vite release emits only installable files and loads the actual CommonJS plugin lifecycle", async (t) => {
	const result = await build({ configFile: resolve(root, "vite.config.mjs"), logLevel: "error", build: { write: false } });
	const output = (Array.isArray(result) ? result[0] : result).output;
	assert.deepEqual(output.map((file) => file.fileName).sort(), ["main.js", "manifest.json", "styles.css"]);
	const chunk = output.find((file) => file.type === "chunk");
	assert.deepEqual(chunk.dynamicImports, []);
	assert.ok(chunk.imports.includes("obsidian"));
	assert.ok(chunk.imports.includes("@codemirror/state"));
	assert.ok(chunk.imports.includes("@codemirror/view"));
	assert.equal(chunk.code.includes("import.meta"), false);
	assert.equal(chunk.code.includes("@vite/client"), false);
	assert.equal(chunk.code.includes("text-finder:match-worker"), false);
	assert.equal(chunk.code.includes("virtual:color-picker"), false);
	assert.equal(output.find((file) => file.fileName === "manifest.json").source.toString(), await readFile(resolve(root, "manifest.json"), "utf8"));
	const css = output.find((file) => file.fileName === "styles.css").source;
	assert.match(css, /--nya-default-width/); assert.match(css, /::highlight\(nya-reading/);
	// Vue scoped CSS is shipped in the host-managed stylesheet in every window.
	assert.match(css, /\.nya-finder/); assert.match(css, /data-v-/);
	assert.doesNotMatch(chunk.code, /svelte\/internal/);
	const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
	const previous = { window: globalThis.window, document: globalThis.document };
	Object.assign(globalThis, { window: dom.window, document: dom.window.document });
	t.after(() => { Object.assign(globalThis, previous); dom.window.close(); });
	const commands = [], settings = [], extensions = [], layout = [], notices = [];
	class Plugin {
		registerEvent() {} addCommand(command) { commands.push(command); }
		addSettingTab(tab) { settings.push(tab); } registerEditorExtension(extension) { extensions.push(extension); }
	}
	class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement("div"); } }
	const moment = Object.assign(() => ({ format: () => "fixed", fromNow: () => "fixed" }), { locale: () => "en" });
	const obsidian = { Plugin, PluginSettingTab, Modal: class {}, MarkdownView: class {}, Editor: class {}, WorkspaceLeaf: class {},
		Notice: class { constructor(message) { notices.push(message); } }, Menu: class {}, Platform: { isMobile: false }, normalizePath: (path) => path, moment };
	const modules = { obsidian, "@codemirror/state": cmState, "@codemirror/view": cmView, "@codemirror/language": cmLanguage };
	const module = { exports: {} };
	new Function("module", "exports", "require", chunk.code)(module, module.exports, (name) => {
		assert.ok(name in modules, `unexpected bundled external ${name}`); return modules[name];
	});
	assert.equal(typeof module.exports, "function", "Obsidian requires the class, not exports.default");
	const plugin = new module.exports();
	plugin.manifest = { id: "text-finder", dir: "plugins/text-finder" };
	plugin.app = { workspace: { on: () => ({}), onLayoutReady(callback) { layout.push(callback); }, iterateAllLeaves() {} },
		vault: { configDir: ".obsidian", adapter: { stat: async () => null, write: async () => { assert.fail("missing default settings must not be persisted"); } } } };
	await plugin.onload(); assert.equal(settings.length, 1);
	layout.forEach((callback) => callback());
	assert.ok(commands.some((command) => command.id === "text-finder-show-find")); assert.equal(extensions.length, 1);
	// Exercise Finder compiled by the production chain, not a separately compiled component.
	plugin.settings.enableHistory = false; plugin.settings.sourceModeWhenSearch = false; plugin.settings.moveCursorToMatch = false;
	const ownerEl = document.createElement("div"); document.body.append(ownerEl);
	let state = cmState.EditorState.create({ doc: "cat CAT cat", extensions: extensions[0] });
	const editorView = { get state() { return state; }, dispatch(spec) { state = state.update(spec).state; } };
	const view = Object.assign(new obsidian.MarkdownView(), { file: { path: "fixture.md" }, containerEl: ownerEl,
		getMode: () => "source", getState: () => ({ mode: "source", source: true }), setState() {},
		editor: { cm: editorView, getValue: () => state.doc.toString(), offsetToPos: (offset) => ({ line: 0, ch: offset }), scrollIntoView() {} } });
	plugin.app.workspace.iterateAllLeaves = (callback) => callback({ view });
	const finder = plugin.editorSearch.getFinder(view);
	// jsdom intentionally has no browser Worker; capture the expected compatibility warning.
	t.mock.method(console, "warn", () => {});
	finder.setVisible(true, "cat"); await Promise.resolve();
	assert.equal(finder.getSearchCache().matches.length, 3);
	assert.ok(ownerEl.querySelector(".nya-finder textarea"));
	const replacement = await finder.replaceAllMatchedText("dog");
	assert.equal(replacement.changed, true); assert.equal(view.editor.getValue(), "dog dog dog");
	if (replacement.navigationCompletion) await replacement.navigationCompletion;
	assert.equal(notices.length, 1, "only the expected Worker compatibility notice is allowed");
	finder.closeFinder(); await Promise.resolve(); assert.equal(finder.isVisible(), false);
	plugin.onunload(); assert.equal(plugin.isUnloaded(), true);
	assert.equal(ownerEl.querySelector(".nya-finder"), null);
});

test("embedded build watch inputs include the original Worker/helper and color library", async () => {
	const plugin = embeddedSources(); const watched = new Set();
	const context = { addWatchFile(path) { watched.add(path.replaceAll("\\", "/")); } };
	await plugin.load.call(context, "\0text-finder:match-worker");
	assert.ok([...watched].some((path) => path.endsWith("/src/match-worker.ts")));
	assert.ok([...watched].some((path) => path.endsWith("/src/util/text-helper.ts")));
	await plugin.load.call(context, "\0virtual:color-picker");
	assert.ok([...watched].some((path) => path.includes("vanilla-colorful")));
	releaseAssets().buildStart.call(context);
	assert.ok([...watched].some((path) => path.endsWith("/manifest.json")));
	for (const id of ["obsidian", "electron", "fs", "node:fs", "@codemirror/state", "@lezer/common"]) assert.equal(hostExternal(id), true);
	for (const id of ["svelte", "vue", "i18next", "./src/main.ts"]) assert.equal(hostExternal(id), false);
});
