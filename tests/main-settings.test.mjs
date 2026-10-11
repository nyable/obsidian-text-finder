import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";
import { constants, historySource, settingsSource, queueSource, toolbarSource } from "./history-source.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const notices = [];
const tabs = [];
const fields = new Map();
class Plugin {
	async loadData() { return this.data; }
	async saveData(snapshot) { this.writes.push(snapshot); }
	addSettingTab(tab) { tabs.push(tab); }
}
class PluginSettingTab {
	constructor(app, plugin) {
		this.plugin = plugin;
		this.containerEl = dom.window.document.createElement("div");
		dom.window.document.body.append(this.containerEl);
		this.containerEl.empty = () => { fields.clear(); this.containerEl.replaceChildren(); };
	}
}
class Setting {
	constructor(root) {
		this.row = dom.window.document.createElement("div"); root.append(this.row);
	}
	setName(name) { this.name = name; this.row.dataset.name = name; return this; }
	setDesc() { return this; }
	addToggle(callback) {
		const toggle = { setValue() { return this; }, onChange(fn) { this.change = fn; return this; } };
		callback(toggle); fields.set(this.name, toggle); return this;
	}
	addText(callback) {
		const inputEl = dom.window.document.createElement("input");
		this.row.append(inputEl);
		const text = { inputEl,
			setValue(value) { inputEl.value = value; return this; },
			setPlaceholder() { return this; },
			onChange(fn) { inputEl.addEventListener("input", () => fn(inputEl.value)); return this; },
		};
		callback(text); fields.set(this.name, text); return this;
	}
	addDropdown(callback) {
		const dropdown = { addOption() { return this; }, setValue() { return this; }, onChange(fn) { this.change = fn; return this; } };
		callback(dropdown); fields.set(this.name, dropdown); return this;
	}
}
const obsidian = { Plugin, PluginSettingTab, Setting, Notice: class { constructor(message) { notices.push(message); } } };
const translations = { i18n: { t: (key) => key } };
const settingsTabSource = loadSource("../src/settings-tab.ts", {
	obsidian, "./i18n": translations, "./constants": constants, "./history": historySource, "./toolbar": toolbarSource,
});
const { default: TextFinderPlugin } = loadSource("../src/main.ts", {
	obsidian, "./settings-tab": settingsTabSource,
	"./i18n": { i18n: { t: (key) => key } },
	"./editor-extension": { editorExtensionProvider: () => {} },
	"./constants": constants, "./history": historySource, "./settings": settingsSource, "./save-queue": queueSource,
});
function plugin(data) {
	const p = new TextFinderPlugin(); p.data = data; p.writes = []; return p;
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("actual plugin migrates all entries, saves once and loads normalized data unchanged", async () => {
	const p = plugin({ searchHistory: [{ text: "new", createdAt: 5, lastUsedAt: 6, count: 2 }, "old", { text: "missingLast", createdAt: 2, count: 7 }] });
	await p.loadSettings();
	assert.equal(p.writes.length, 1);
	assert.equal(p.settings.searchHistory.length, 3);
	assert.equal(p.settings.searchHistory.find((i) => i.text === "missingLast").lastUsedAt, 2);
	p.data = p.writes[0];
	await p.loadSettings();
	assert.equal(p.writes.length, 1);
});

test("actual plugin tolerates null history without aborting load", async () => {
	const p = plugin({ searchHistory: null });
	await p.loadSettings();
	assert.deepEqual(p.settings.searchHistory, []);
	assert.equal(p.writes.length, 1);
});

test("read failure permits startup but blocks all writes until successful reload", async (t) => {
	t.mock.method(console, "error", () => {});
	const p = plugin();
	p.loadData = async () => { throw new Error("read failed"); };
	const previous = notices.length;
	await p.onload();
	assert.deepEqual(p.settings, settingsSource.defaultSettings());
	p.history.record("temporary");
	await settle();
	await assert.rejects(p.saveSettings(), /refusing to overwrite/);
	assert.equal(p.writes.length, 0);
	assert.equal(notices.length, previous + 1, "repeated errors are throttled");
	p.loadData = async () => null;
	await p.loadSettings();
	p.history.record("recovered");
	await p.flushSettings();
	assert.equal(p.writes.length, 1);
});

test("migration write failure is reported but does not prevent loading or later saving", async (t) => {
	t.mock.method(console, "error", () => {});
	const p = plugin({ searchHistory: ["A"] });
	let fails = true;
	p.saveData = async (snapshot) => { if (fails) throw new Error("disk failed"); p.writes.push(snapshot); };
	await p.loadSettings();
	assert.equal(p.settings.searchHistory[0].text, "A");
	await assert.rejects(p.flushSettings(), /disk failed/);
	fails = false;
	p.history.record("B");
	await p.flushSettings();
	assert.deepEqual(p.writes[0].searchHistory.map((i) => i.text).sort(), ["A", "B"]);
});

test("interleaved real plugin history, deletion and settings writes never overlap", async () => {
	const p = plugin(null); await p.loadSettings();
	const jobs = [];
	let active = 0;
	p.saveData = (snapshot) => {
		active++; assert.equal(active, 1);
		p.writes.push(snapshot);
		return new Promise((resolve) => jobs.push(() => { active--; resolve(); }));
	};
	p.history.record("A");
	p.history.record("B");
	p.history.remove(new Set(["A"]));
	p.settings.moveCursorToMatch = false;
	p.requestSaveSettings();
	await settle(); assert.equal(p.writes.length, 1);
	for (let i = 0; i < 4; i++) { jobs[i](); await settle(); }
	await p.flushSettings();
	assert.deepEqual(p.writes[0].searchHistory.map((i) => i.text), ["A"]);
	assert.deepEqual(p.writes.at(-1).searchHistory.map((i) => i.text), ["B"]);
	assert.equal(p.writes.at(-1).moveCursorToMatch, false);
});

test("capacity input only commits on Enter or blur, rejecting partial and malformed values", async () => {
	const p = plugin(null); await p.onload();
	p.settings.searchHistory = Array.from({ length: 10 }, (_, i) => ({ text: String(i), count: 1, createdAt: i, lastUsedAt: i }));
	tabs.at(-1).display();
	tabs.at(-1).containerEl.querySelector('[role="tab"][id$="-history"]').click();
	const input = fields.get("settings.HistoryMaxCount.name").inputEl;
	input.value = "2";
	input.dispatchEvent(new dom.window.Event("input"));
	assert.equal(p.settings.historyMaxCount, 10);
	assert.equal(p.settings.searchHistory.length, 10);
	input.value = "20";
	input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter" }));
	assert.equal(p.settings.historyMaxCount, 20);
	assert.equal(p.settings.searchHistory.length, 10);
	input.value = "2abc";
	input.dispatchEvent(new dom.window.Event("blur"));
	assert.equal(p.settings.historyMaxCount, 20);
	assert.equal(input.value, "20");
	input.value = "2";
	input.dispatchEvent(new dom.window.Event("blur"));
	assert.equal(p.settings.historyMaxCount, 2);
	assert.equal(p.settings.searchHistory.length, 2);
	await p.flushSettings();
	assert.equal(p.writes.at(-1).historyMaxCount, 2);
	assert.equal(p.writes.at(-1).searchHistory.length, 2);
});

test("settings toggles and sort changes save through the queue and notify subscribers", async () => {
	const p = plugin(null); await p.onload();
	tabs.at(-1).display();
	tabs.at(-1).containerEl.querySelector('[role="tab"][id$="-history"]').click();
	let updates = 0;
	const unsubscribe = p.history.subscribe(() => { updates++; });
	fields.get("settings.EnableHistory.name").change(false);
	fields.get("settings.HistorySortOrder.name").change("count");
	tabs.at(-1).containerEl.querySelector('[role="tab"][id$="-find"]').click();
	fields.get("settings.MoveCursorToMatch.name").change(false);
	await p.flushSettings();
	assert.equal(updates, 3);
	assert.equal(p.writes.length, 3);
	assert.equal(p.writes.at(-1).enableHistory, false);
	assert.equal(p.writes.at(-1).historySortOrder, "count");
	unsubscribe();
});

test("four settings tabs isolate features, include reading preference in Find and support keyboard navigation", async () => {
	const p = plugin(null); await p.onload();
	const tab = tabs.at(-1); tab.display();
	const root = tab.containerEl;
	assert.equal(root.querySelectorAll('[role="tab"]').length, 4);
	const names = () => [...root.querySelectorAll('[data-name]')].map((el) => el.dataset.name);
	assert.ok(names().includes("settings.UseObsidianSearchInRead.name"));
	assert.ok(!names().includes("settings.EnableHistory.name"));
	root.querySelector('#nya-settings-tab-find').dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
	assert.deepEqual(names(), ["settings.UseEscapeCharInReplace.name"]);
	assert.equal(root.querySelector('[role="tab"][aria-selected="true"]').id, "nya-settings-tab-replace");
	root.querySelector('#nya-settings-tab-history').click();
	assert.equal(names().length, 3);
	const input = root.querySelector("input"); input.focus(); input.value = "17";
	root.querySelector('#nya-settings-tab-find').click();
	assert.equal(p.settings.historyMaxCount, 17, "switching tabs commits a focused history capacity input");
	await p.flushSettings();
});

test("toolbar placement changes compose, reorder supports keys/buttons, reset affects only one toolbar", async () => {
	const p = plugin(null); await p.onload();
	let refreshes = 0; p.editorSearch = { refreshToolbars: () => refreshes++ };
	const tab = tabs.at(-1); tab.display(); tab.containerEl.querySelector('#nya-settings-tab-toolbar').click();
	const root = tab.containerEl;
	const first = root.querySelector('[data-action="regex"] select'); first.value = "more"; first.dispatchEvent(new dom.window.Event("change"));
	const second = root.querySelector('[data-action="case"] select'); second.value = "hidden"; second.dispatchEvent(new dom.window.Event("change"));
	assert.equal(p.settings.searchToolbar[0].placement, "more");
	assert.equal(p.settings.searchToolbar[1].placement, "hidden");
	root.querySelector('[data-action="regex"] [data-control="down"]').click();
	assert.deepEqual(p.settings.searchToolbar.slice(0, 2).map((i) => i.id), ["case", "regex"]);
	root.querySelector('[data-action="regex"] [data-control="handle"]').dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
	assert.equal(p.settings.searchToolbar[0].id, "regex");
	const replace = root.querySelector('[data-action="replace"] select'); replace.value = "more"; replace.dispatchEvent(new dom.window.Event("change"));
	const sections = root.querySelectorAll("section"); sections[0].lastElementChild.click();
	assert.deepEqual(p.settings.searchToolbar, toolbarSource.defaultToolbar("search"));
	assert.equal(p.settings.replaceToolbar[0].placement, "more");
	assert.equal(refreshes, 6);
	await p.flushSettings();
	assert.equal(p.writes.at(-1).replaceToolbar[0].placement, "more");
});

function pointer(target, type, y) {
	const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientY: y }); target.dispatchEvent(event);
}

test("mouse/touch pointer drag previews insertion, saves once on drop and cancels safely", async () => {
	const p = plugin(null); await p.onload();
	const tab = tabs.at(-1); tab.display(); tab.containerEl.querySelector('#nya-settings-tab-toolbar').click();
	const root = tab.containerEl;
	const rows = () => [...root.querySelectorAll("section:first-of-type .nya-toolbar-row")];
	const mockRects = () => rows().forEach((row, index) => { row.getBoundingClientRect = () => ({ top: index * 40, height: 40 }); });
	mockRects();
	const writes = p.writes.length;
	pointer(rows()[0].querySelector("button"), "pointerdown", 10);
	pointer(root.ownerDocument, "pointermove", 100);
	assert.ok(root.querySelector(".nya-drop-before"));
	assert.equal(p.settings.searchToolbar[0].id, "regex");
	assert.equal(p.writes.length, writes);
	pointer(root.ownerDocument, "pointerup", 100);
	assert.deepEqual(p.settings.searchToolbar.slice(0, 3).map((i) => i.id), ["case", "previous", "regex"]);
	await p.flushSettings(); assert.equal(p.writes.length, writes + 1);
	for (const cancel of ["escape", "pointercancel", "hide", "switch"]) {
		mockRects(); const before = JSON.stringify(p.settings.searchToolbar);
		pointer(rows()[0].querySelector("button"), "pointerdown", 10); pointer(root.ownerDocument, "pointermove", 180);
		if (cancel === "escape") root.ownerDocument.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
		else if (cancel === "hide") tab.hide();
		else if (cancel === "switch") root.querySelector('#nya-settings-tab-find').click();
		else pointer(root.ownerDocument, "pointercancel", 180);
		pointer(root.ownerDocument, "pointerup", 180);
		assert.equal(JSON.stringify(p.settings.searchToolbar), before);
		assert.equal(root.querySelector(".nya-toolbar-dragging"), null);
		if (cancel === "switch") root.querySelector('#nya-settings-tab-toolbar').click();
	}
	await p.flushSettings(); assert.equal(p.writes.length, writes + 1);
});
