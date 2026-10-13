import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";
import { constants, historySource, settingsSource, toolbarSource } from "./history-source.mjs";
import { ToolbarPreview, tick, previewStyles } from "./toolbar-preview-source.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
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
		this.settingEl = this.row;
	}
	setName(name) { this.name = name; this.row.dataset.name = name; return this; }
	setDesc() { return this; }
	addToggle(callback) {
		const toggleEl = dom.window.document.createElement("button"); this.row.append(toggleEl);
		const toggle = { toggleEl, value: false, setValue(value) { this.value = value; return this; }, onChange(fn) { this.change = fn; return this; } };
		toggleEl.addEventListener("click", () => { toggle.value = !toggle.value; toggle.change(toggle.value); });
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
const obsidian = { Plugin, PluginSettingTab, Setting, setIcon: (element, name) => { element.dataset.icon = name; }, normalizePath: (path) => path, Notice: class { constructor(message) { notices.push(message); } } };
const translations = { i18n: { t: (key) => key } };
const settingsTabSource = loadSource("../src/settings-tab.ts", {
	obsidian, "./i18n": translations, "./constants": constants, "./history": historySource, "./toolbar": toolbarSource,
	"./settings": settingsSource,
	"./ToolbarPreview.svelte": { default: ToolbarPreview },
});
const { default: TextFinderPlugin } = loadSource("../src/main.ts", {
	obsidian, "./settings-tab": settingsTabSource,
	"./i18n": { i18n: { t: (key) => key } },
	"./editor-extension": { editorExtensionProvider: () => {} },
	"./constants": constants, "./history": historySource, "./settings": settingsSource,
	"./settings-storage": loadSource("../src/settings-storage.ts"),
});
function plugin(data) {
	const p = new TextFinderPlugin(); p.data = data; p.writes = [];
	p.manifest = { id: "text-finder", dir: ".obsidian/plugins/text-finder" };
	p.app = { vault: { configDir: ".obsidian", adapter: {
		stat: async () => ({ type: "file" }),
		read: async () => JSON.stringify(await p.loadData() ?? null),
		write: async (_path, text) => p.saveData(JSON.parse(text)),
	} } };
	return p;
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("malformed persisted JSON blocks writes even when host loadData would swallow the error", async (t) => {
	t.mock.method(console, "error", () => {});
	const p = plugin(null);
	p.app.vault.adapter.read = async () => "{broken";
	p.loadData = async () => undefined;
	await p.loadSettings();
	await assert.rejects(p.saveSettings(), /refusing to overwrite/);
	assert.equal(p.writes.length, 0);
});

test("unload during a slow read does not register UI or accept new saves", async (t) => {
	t.mock.method(console, "error", () => {});
	const p = plugin(null); let release;
	p.app.vault.adapter.read = () => new Promise((resolve) => { release = resolve; });
	const before = tabs.length;
	const load = p.onload(); await settle();
	p.onunload(); release("null"); await load;
	assert.equal(tabs.length, before);
	await assert.rejects(p.saveSettings(), /unloaded/);
	assert.equal(p.writes.length, 0);
});

test("actual plugin reload reads all accepted snapshots before writing new history", async () => {
	let disk = JSON.stringify(settingsSource.defaultSettings()); let release; let started;
	const firstStarted = new Promise((resolve) => { started = resolve; });
	const snapshots = [];
	const app = { vault: { configDir: ".obsidian", adapter: {
		stat: async () => ({ type: "file" }), read: async () => disk,
		write: async (_path, text) => {
			snapshots.push(JSON.parse(text));
			if (snapshots.length === 1) { started(); await new Promise((resolve) => { release = resolve; }); }
			disk = text;
		},
	} } };
	const old = plugin(null); old.app = app; await old.loadSettings();
	old.history.record("A"); old.history.record("B"); old.history.record("C");
	await firstStarted; old.onunload();
	const fresh = plugin(null); fresh.app = app; const load = fresh.loadSettings();
	release(); await load;
	assert.deepEqual(fresh.history.sorted().map((item) => item.text).sort(), ["A", "B", "C"]);
	fresh.history.record("NEW"); await fresh.flushSettings();
	assert.ok(JSON.parse(disk).searchHistory.some((item) => item.text === "NEW"));
	assert.equal(snapshots.length, 4);
});

for (const manifestDir of [undefined, ".custom/plugins/renamed-folder"]) {
	test(`settings use original plugin data path with custom configuration directory: ${manifestDir ?? "fallback"}`, async () => {
		const p = plugin(null); const paths = [];
		p.manifest.dir = manifestDir; p.app.vault.configDir = ".custom";
		p.app.vault.adapter.stat = async (path) => { paths.push(path); return null; };
		p.app.vault.adapter.read = async () => { throw new Error("must not read missing file"); };
		p.app.vault.adapter.write = async (path) => { paths.push(path); };
		await p.loadSettings(); p.history.record("A"); await p.flushSettings();
		assert.deepEqual(paths, Array(2).fill(`${manifestDir ?? ".custom/plugins/text-finder"}/data.json`));
	});
}

test("stat/read race blocks saves rather than overwriting data that disappeared during load", async (t) => {
	t.mock.method(console, "error", () => {});
	const p = plugin(null);
	p.app.vault.adapter.read = async () => { throw Object.assign(new Error("missing after stat"), { code: "ENOENT" }); };
	await p.loadSettings(); await assert.rejects(p.saveSettings(), /refusing to overwrite/);
	assert.equal(p.writes.length, 0);
});

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

test("toolbar defaults update the real preview and restore defaults resets only the selected toolbar in one snapshot", async () => {
	const p = plugin(null); await p.onload();
	let refreshes = 0; p.editorSearch = { refreshToolbars: () => refreshes++ };
	const tab = tabs.at(-1); tab.display(); tab.containerEl.querySelector('#nya-settings-tab-toolbar').click();
	const root = tab.containerEl, preview = root.querySelector(".nya-toolbar-preview");
	const row = (id) => root.querySelector(`[data-action="${id}"]`);
	assert.equal(root.querySelectorAll(".nya-toolbar-default").length, 2);
	const regex = row("regex").querySelector(".nya-toolbar-default button");
	regex.click(); await tick();
	assert.equal(p.settings.defaultRegexMode, true);
	assert.equal(preview.querySelector('[aria-label="search.tip.UseRegularExpression"]').dataset.active, "true");
	assert.equal(refreshes, 0, "default changes do not update existing finders");
	const placement = row("regex").querySelector("select"); placement.value = "hidden";
	placement.dispatchEvent(new dom.window.Event("change")); await tick();
	assert.equal(row("regex").querySelector(".nya-toolbar-warning"), null);
	assert.equal(preview.querySelector('[aria-label="search.tip.UseRegularExpression"]'), null);
	assert.equal(p.settings.defaultRegexMode, true);
	row("case").querySelector(".nya-toolbar-default button").click();
	const replace = row("replace").querySelector("select"); replace.value = "more";
	replace.dispatchEvent(new dom.window.Event("change"));
	await p.flushSettings();
	root.querySelectorAll(".nya-toolbar-settings")[1].lastElementChild.click(); await tick(); await p.flushSettings();
	assert.equal(p.settings.defaultRegexMode, true); assert.equal(p.settings.defaultCaseSensitive, true, "replace reset does not reset search defaults");
	assert.equal(p.settings.searchToolbar[0].placement, "hidden");
	assert.deepEqual(p.settings.replaceToolbar, toolbarSource.defaultToolbar("replace"));
	row("replace").querySelector("select").value = "more";
	row("replace").querySelector("select").dispatchEvent(new dom.window.Event("change"));
	await p.flushSettings(); const writes = p.writes.length;
	root.querySelector(".nya-toolbar-settings").lastElementChild.click(); await tick();
	assert.equal(p.settings.defaultRegexMode, false); assert.equal(p.settings.defaultCaseSensitive, false);
	assert.deepEqual(p.settings.searchToolbar, toolbarSource.defaultToolbar("search"));
	assert.equal(p.settings.replaceToolbar[0].placement, "more", "search reset leaves replace configuration unchanged");
	assert.equal(row("regex").querySelector(".nya-toolbar-warning"), null);
	assert.equal(preview.querySelector('[aria-label="search.tip.UseRegularExpression"]').dataset.active, "false");
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1, "reset saves layout and default options together");
	assert.equal(p.writes.at(-1).defaultRegexMode, false); assert.equal(p.writes.at(-1).defaultCaseSensitive, false);
	p.data = p.writes.at(-1); await p.loadSettings();
	assert.equal(p.settings.defaultRegexMode, false);
	tab.hide();
});

test("preview stays expanded, reorders live and has no controls, menu actions or document listeners", async (t) => {
	const p = plugin(null); await p.onload();
	const listeners = new Set(), doc = dom.window.document;
	const add = doc.addEventListener.bind(doc), remove = doc.removeEventListener.bind(doc);
	t.mock.method(doc, "addEventListener", (type, handler, ...rest) => { if (type === "pointerdown") listeners.add(handler); return add(type, handler, ...rest); });
	t.mock.method(doc, "removeEventListener", (type, handler, ...rest) => { if (type === "pointerdown") listeners.delete(handler); return remove(type, handler, ...rest); });
	const tab = tabs.at(-1); tab.display(); tab.containerEl.querySelector('#nya-settings-tab-toolbar').click();
	const root = tab.containerEl;
	const preview = () => root.querySelector(".nya-toolbar-preview");
	const placement = root.querySelector('[data-action="regex"] select'); placement.value = "more";
	placement.dispatchEvent(new dom.window.Event("change"));
	root.querySelector('[data-action="regex"] .nya-toolbar-default button').click(); await tick();
	const writes = p.writes.length; await p.flushSettings(); const saved = p.writes.length;
	const trigger = preview().querySelector('[aria-label="search.tip.More"]');
	trigger.click(); await tick();
	trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await tick();
	assert.equal(preview().querySelector('[role="menu"]'), null);
	doc.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })); await tick();
	assert.equal(preview().querySelector('[role="menu"]'), null);
	preview().querySelector('[aria-label="search.tip.MatchCase"]').click(); await tick();
	assert.equal(p.settings.defaultRegexMode, true); assert.equal(p.settings.defaultCaseSensitive, false);
	assert.equal(p.writes.length, saved, "inspecting preview never saves settings");
	assert.equal(preview().querySelectorAll(".nya-preview-input").length, 2);
	preview().querySelector('.nya-preview-toggle').click(); await tick();
	assert.equal(preview().querySelectorAll(".nya-preview-input").length, 2);
	assert.equal(preview().querySelectorAll('textarea, input, button, [role="button"], [tabindex], [contenteditable]').length, 0);
	trigger.focus(); assert.notEqual(doc.activeElement, trigger);
	root.querySelector('[data-action="next"] [data-control="up"]').click(); await tick();
	const labels = [...preview().querySelectorAll('.nya-preview-search-actions .nya-toolbar > span')].map((button) => button.getAttribute("aria-label"));
	assert.deepEqual(labels, ["search.tip.MatchCase", "search.tip.NextMatch", "search.tip.PreviousMatch", "search.tip.More"]);
	assert.ok(p.writes.length >= writes);
	assert.equal(listeners.size, 0, "presentation does not register pointer listeners");
	tab.hide(); assert.equal(preview(), null); assert.equal(listeners.size, 0);
	tab.display(); assert.equal(listeners.size, 0);
	root.querySelector('#nya-settings-tab-find').click(); assert.equal(preview(), null); assert.equal(listeners.size, 0);
	root.querySelector('#nya-settings-tab-toolbar').click(); assert.ok(preview()); assert.equal(listeners.size, 0);
	p.onunload(); assert.equal(preview(), null); assert.equal(listeners.size, 0);
});

test("toolbar blocks separate identity/reorder from configuration and omit explanation paragraphs", async () => {
	const p = plugin(null); await p.onload();
	const tab = tabs.at(-1); tab.display(); tab.containerEl.querySelector('#nya-settings-tab-toolbar').click();
	const root = tab.containerEl;
	assert.equal(root.querySelectorAll('.nya-settings-panel p').length, 0);
	const blocks = [...root.querySelectorAll('.nya-toolbar-row')]; assert.equal(blocks.length, 7);
	for (const block of blocks) {
		const header = block.querySelector('.nya-toolbar-row-controls'), options = block.querySelector('.nya-toolbar-row-options');
		assert.ok(header.querySelector('.nya-toolbar-name'));
		assert.ok(header.querySelector('.nya-toolbar-item-icon').dataset.icon);
		assert.equal(header.querySelectorAll('button').length, 2);
		assert.equal(block.firstElementChild.dataset.control, "handle", "full-height handle is outside the two content rows");
		assert.equal(header.querySelector('select'), null);
		assert.ok(options.querySelector('.nya-toolbar-placement > select').getAttribute('aria-label'));
		assert.equal(options.querySelector('.nya-toolbar-placement').children.length, 2, "only the select and decorative arrow are shown");
		assert.equal(options.querySelector('.nya-toolbar-select-arrow').dataset.icon, "chevron-down");
		assert.equal(options.querySelectorAll('.nya-toolbar-default').length, ['regex', 'case'].includes(block.dataset.action) ? 1 : 0);
	}
	assert.ok(root.querySelector('.nya-toolbar-default button').title, "default timing remains available as a tooltip");
	tab.hide();
});

test("preview shows fixed English matches, an empty replacement placeholder and distinct UI/body typography", async () => {
	const p = plugin(null); await p.onload();
	const tab = tabs.at(-1); tab.display(); tab.containerEl.querySelector('#nya-settings-tab-toolbar').click();
	const preview = tab.containerEl.querySelector('.nya-toolbar-preview');
	assert.equal(preview.querySelector('.nya-preview-find').textContent, 'text');
	const replacement = preview.querySelector('.nya-preview-replace');
	assert.equal(replacement.childNodes.length, 1);
	assert.equal(replacement.querySelector('.nya-preview-placeholder').textContent, 'search.tip.ReplacePlaceholder');
	const text = preview.querySelector('.nya-preview-text');
	assert.equal(text.textContent.trim(), 'Find text, highlight text, and replace text.');
	assert.equal(text.lang, 'en');
	assert.equal(text.querySelectorAll('.nya-text-finder-match-current').length, 1);
	assert.equal(text.querySelectorAll('.nya-text-finder-match').length, 3);
	assert.equal(text.querySelectorAll('.nya-text-finder-match:not(.nya-text-finder-match-current)').length, 2);
	assert.equal(text.querySelector('span').className, 'nya-text-finder-match nya-text-finder-match-current');
	assert.ok([...text.querySelectorAll('span')].every((span) => span.textContent === 'text'));
	const css = previewStyles.join('\n');
	const rule = (name) => [...css.matchAll(new RegExp(`\\.${name}[^{}]*\\{([^}]+)\\}`, 'g'))].map((match) => match[1]).join(';');
	assert.match(rule('nya-preview-input'), /font-family:\s*var\(--font-interface\)/);
	assert.match(rule('nya-preview-input'), /font-size:\s*var\(--font-ui-small\)/);
	assert.match(rule('nya-preview-input'), /color:\s*var\(--text-normal\)/);
	assert.match(rule('nya-preview-placeholder'), /font:\s*inherit/);
	assert.match(rule('nya-preview-placeholder'), /color:\s*var\(--text-faint\)/);
	assert.match(rule('nya-preview-text'), /height:\s*120px/);
	assert.match(rule('nya-preview-text'), /font-size:\s*var\(--font-text-size\)/);
	assert.match(rule('nya-preview-text'), /overflow:\s*hidden/);
	assert.equal(preview.querySelectorAll('input, textarea, button, [tabindex], [role="button"]').length, 0);
	tab.hide();
});

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
