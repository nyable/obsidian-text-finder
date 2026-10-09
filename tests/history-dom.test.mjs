import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import ts from "typescript";
import { JSDOM } from "jsdom";

// Compile the actual components, including bindings, reactive sorting and DOM
// event modifiers. Only host APIs and decorative icons are stubbed.
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
	stdin: {
		contents: `export { default as HistoryModal } from './src/HistoryModal.svelte'; export { tick } from 'svelte';`,
		resolveDir: root,
	},
	bundle: true,
	write: false,
	format: "cjs",
	platform: "browser",
	plugins: [{
		name: "history-test-components",
		setup(build) {
			build.onResolve({ filter: /^(obsidian|lucide-svelte)$|^\.\/i18n$/ }, ({ path }) => ({ path, namespace: "stub" }));
			build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => {
				if (path === "obsidian") return { contents: `export const moment = () => ({format: () => 'date', fromNow: () => 'relative'});` };
				if (path === "./i18n") return { contents: `export const i18n = { t: key => key };` };
				const icon = compile("<span></span>", { generate: "dom", css: "external" }).js.code.replace("export default Component;", "");
				return { contents: icon + `\nexport { Component as Trash2, Component as Copy, Component as CheckSquare, Component as Square, Component as Info, Component as ArrowLeft, Component as Calendar, Component as Clock, Component as Hash, Component as AlignLeft };`, resolveDir: root };
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
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
const module = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(module, module.exports);
const { HistoryModal, tick } = module.exports;

function mount(t, sortOrder = "lastUsedAt", texts = ["A", "B", "C"]) {
	const copied = [];
	const searched = [];
	let saves = 0;
	let closes = 0;
	navigator.clipboard = { writeText: async (text) => { copied.push(text); } };
	const plugin = {
		settings: {
			historySortOrder: sortOrder,
			historyMaxCount: 10,
			searchHistory: texts.map((text, index) => ({ text, count: 1, createdAt: 100 - index, lastUsedAt: 100 - index })),
		},
		saveSettings: async () => { saves++; },
		editorSearch: { getFinder: () => ({ setVisibleFromHistory: (text) => searched.push(text) }) },
	};
	const target = document.createElement("div");
	document.body.append(target);
	const component = new HistoryModal({ target, props: { plugin, modal: { close: () => { closes++; } } } });
	t.after(() => { component.$destroy(); target.remove(); });
	const rows = () => [...target.querySelectorAll(".nya-history-item")];
	const row = (text) => rows().find((row) => row.querySelector(".nya-history-text").textContent === text);
	const click = async (element) => { assert.ok(element, "action exists"); element.click(); await tick(); };
	const key = async (element, key = "Enter") => {
		element.focus();
		const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		await tick();
		return event;
	};
	return {
		target, plugin, component, row, rows, click, key, copied, searched,
		saves: () => saves, closes: () => closes,
		select: (text) => click(row(text).querySelector('[role="checkbox"]')),
		action: (text, name) => click(row(text).querySelector(`[title="history.${name}"]`)),
		bulkDelete: () => click(target.querySelector(".nya-history-toolbar button.delete")),
		selectAll: () => click(target.querySelector(".nya-history-toolbar button:not(.delete)")),
		texts: () => plugin.settings.searchHistory.map((item) => item.text).sort(),
	};
}

for (const sortOrder of ["lastUsedAt", "count"]) {
	test(`selection and keyed DOM survive usage-driven ${sortOrder} sorting`, async (t) => {
		const h = mount(t, sortOrder);
		await h.select("A");
		const originalA = h.row("A");
		const originalB = h.row("B");
		await h.action("B", "Copy");
		assert.deepEqual(h.copied, ["B"]);
		assert.equal(h.rows()[0], originalB);
		assert.equal(h.row("A"), originalA);
		assert.equal(h.row("A").querySelector('[role="checkbox"]').getAttribute("aria-checked"), "true");
		assert.equal(h.row("B").querySelector('[role="checkbox"]').getAttribute("aria-checked"), "false");
		await h.bulkDelete();
		assert.deepEqual(h.texts(), ["B", "C"]);
		assert.equal(h.saves(), 2);
		assert.equal(h.closes(), 0);
	});
}

test("single deletion preserves unrelated selections", async (t) => {
	const h = mount(t);
	await h.select("A");
	await h.select("C");
	await h.action("A", "Delete");
	assert.equal(h.row("C").querySelector('[role="checkbox"]').getAttribute("aria-checked"), "true");
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["B"]);
});

test("deleting an unselected row does not clear the selection", async (t) => {
	const h = mount(t);
	await h.select("A");
	await h.action("B", "Delete");
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["C"]);
});

test("select all, unselect all and select all after a reorder operate on identities", async (t) => {
	const h = mount(t);
	await h.selectAll();
	assert.equal(h.target.querySelectorAll('[aria-checked="true"]').length, 3);
	await h.action("C", "Copy");
	await h.selectAll();
	assert.equal(h.target.querySelectorAll('[aria-checked="true"]').length, 0);
	assert.equal(h.target.querySelector(".nya-history-toolbar button.delete"), null);
	await h.selectAll();
	await h.bulkDelete();
	assert.deepEqual(h.texts(), []);
	await h.selectAll();
	assert.equal(h.target.querySelector(".nya-history-toolbar button.delete"), null);
});

test("selection uses exact text, including whitespace and special property names", async (t) => {
	const h = mount(t, "lastUsedAt", ["A", " A ", "__proto__"]);
	await h.select(" A ");
	await h.action("__proto__", "Copy");
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["A", "__proto__"]);
});

test("detail copy can reorder the list without changing its selection", async (t) => {
	const h = mount(t);
	await h.select("A");
	await h.action("B", "Details");
	await h.click(h.target.querySelector(".nya-history-detail-actions button:not(.delete)"));
	await h.click(h.target.querySelector('[title="history.Back"]'));
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["B", "C"]);
});

for (const action of ["Details", "Copy", "Delete"]) {
	test(`Enter on ${action} does not activate the parent search action`, async (t) => {
		const h = mount(t);
		const button = h.row("B").querySelector(`[title="history.${action}"]`);
		const event = await h.key(button);
		assert.equal(h.closes(), 0);
		assert.deepEqual(h.searched, []);
		assert.equal(event.defaultPrevented, false, "native button activation remains available");
		// jsdom does not synthesize the browser's keyboard-generated click.
		await h.click(button);
		assert.equal(h.closes(), 0);
		assert.deepEqual(h.searched, []);
		if (action === "Details") assert.ok(h.target.querySelector(".nya-history-detail"));
		if (action === "Copy") assert.deepEqual(h.copied, ["B"]);
		if (action === "Delete") assert.deepEqual(h.texts(), ["A", "C"]);
	});
}

test("Enter on the row itself still reuses the history exactly once", async (t) => {
	const h = mount(t);
	await h.key(h.row("A").querySelector(".nya-history-content"));
	assert.equal(h.closes(), 1);
	assert.deepEqual(h.searched, ["A"]);
	assert.equal(h.saves(), 1);
});

test("checkbox Enter toggles selection without activating search", async (t) => {
	const h = mount(t);
	await h.key(h.row("B").querySelector('[role="checkbox"]'));
	await h.action("C", "Copy");
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["A", "C"]);
	assert.deepEqual(h.searched, []);
});
