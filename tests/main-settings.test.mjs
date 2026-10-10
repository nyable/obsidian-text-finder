import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";
import { constants, historySource, settingsSource, queueSource } from "./history-source.mjs";

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
		this.containerEl = { empty: () => fields.clear() };
	}
}
class Setting {
	setName(name) { this.name = name; return this; }
	setDesc() { return this; }
	addToggle(callback) {
		const toggle = { setValue() { return this; }, onChange(fn) { this.change = fn; return this; } };
		callback(toggle); fields.set(this.name, toggle); return this;
	}
	addText(callback) {
		const inputEl = dom.window.document.createElement("input");
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
const { default: TextFinderPlugin } = loadSource("../src/main.ts", {
	obsidian: { Plugin, PluginSettingTab, Setting, Notice: class { constructor(message) { notices.push(message); } } },
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
	let updates = 0;
	const unsubscribe = p.history.subscribe(() => { updates++; });
	fields.get("settings.EnableHistory.name").change(false);
	fields.get("settings.HistorySortOrder.name").change("count");
	fields.get("settings.MoveCursorToMatch.name").change(false);
	await p.flushSettings();
	assert.equal(updates, 3);
	assert.equal(p.writes.length, 3);
	assert.equal(p.writes.at(-1).enableHistory, false);
	assert.equal(p.writes.at(-1).historySortOrder, "count");
	unsubscribe();
});
