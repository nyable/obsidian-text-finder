// @vitest-environment jsdom
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { JSDOM } from "jsdom";
import * as settingsSource from "../../src/features/settings";
import * as toolbarSource from "../../src/features/finder";
import { nextTick as tick } from "vue";
import { componentStyles } from "../support/component-styles.mjs";
vi.mock("../../src/i18n", () => ({
	i18n: { t: (key, values) => key + (values?.name ? ": " + values.name : "") },
	initializeLanguage() {},
}));
vi.mock("../../src/app/workspace-runtime", () => ({ editorExtensionProvider() {} }));

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
const notices = [];
const tabs = [];
const fields = new Map();
class Plugin {
	async loadData() {
		return this.data;
	}
	async saveData(snapshot) {
		this.writes.push(snapshot);
	}
	addSettingTab(tab) {
		tabs.push(tab);
	}
	registerEvent() {}
}
class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = dom.window.document.createElement("div");
		dom.window.document.body.append(this.containerEl);
		this.containerEl.empty = () => {
			fields.clear();
			this.containerEl.replaceChildren();
		};
	}
}
class Setting {
	constructor(root) {
		this.row = root.ownerDocument.createElement("div");
		root.append(this.row);
		this.settingEl = this.row;
	}
	setName(name) {
		this.name = name;
		this.row.dataset.name = name;
		return this;
	}
	setDesc() {
		return this;
	}
	addButton(callback) {
		const el = this.row.ownerDocument.createElement("button");
		this.row.append(el);
		const button = {
			setButtonText(text) {
				el.textContent = text;
				return this;
			},
			onClick(fn) {
				el.addEventListener("click", fn);
				return this;
			},
		};
		callback(button);
		return this;
	}
	addToggle(callback) {
		const toggleEl = this.row.ownerDocument.createElement("button");
		this.row.append(toggleEl);
		const toggle = {
			toggleEl,
			value: false,
			setValue(value) {
				this.value = value;
				return this;
			},
			onChange(fn) {
				this.change = fn;
				return this;
			},
		};
		toggleEl.addEventListener("click", () => {
			toggle.value = !toggle.value;
			toggle.change(toggle.value);
		});
		callback(toggle);
		fields.set(this.name, toggle);
		return this;
	}
	addText(callback) {
		const inputEl = this.row.ownerDocument.createElement("input");
		this.row.append(inputEl);
		const text = {
			inputEl,
			setValue(value) {
				inputEl.value = value;
				return this;
			},
			setPlaceholder() {
				return this;
			},
			onChange(fn) {
				inputEl.addEventListener("input", () => fn(inputEl.value));
				return this;
			},
		};
		callback(text);
		fields.set(this.name, text);
		return this;
	}
	addDropdown(callback) {
		const dropdown = {
			addOption() {
				return this;
			},
			setValue() {
				return this;
			},
			onChange(fn) {
				this.change = fn;
				return this;
			},
		};
		callback(dropdown);
		fields.set(this.name, dropdown);
		return this;
	}
}
const obsidian = {
	Plugin,
	PluginSettingTab,
	Setting,
	moment: { locale: () => "en" },
	setTooltip: (element, text) => {
		element.dataset.tooltip = text;
	},
	setIcon: (element, name) => {
		element.dataset.icon = name;
	},
	normalizePath: (path) => path,
	Notice: class {
		constructor(message) {
			notices.push(message);
		}
	},
};
vi.doMock("obsidian", () => obsidian);
const { default: TextFinderPlugin } = await import("../../src/main");
const { default: ToolbarPreview } =
	await import("../../src/features/settings/ui/ToolbarPreview.vue");
const previewStyles = await componentStyles(
	"src/features/settings/ui/ToolbarPreview.vue",
	ToolbarPreview.__scopeId,
);
function plugin(data) {
	const p = new TextFinderPlugin();
	p.data = data;
	p.writes = [];
	p.manifest = { id: "text-finder", dir: ".obsidian/plugins/text-finder" };
	p.app = {
		workspace: {
			on: () => ({}),
			onLayoutReady: (callback) => callback(),
			iterateAllLeaves: () => {},
		},
		vault: {
			configDir: ".obsidian",
			adapter: {
				stat: async () => ({ type: "file" }),
				read: async () => JSON.stringify((await p.loadData()) ?? null),
				write: async (_path, text) => p.saveData(JSON.parse(text)),
			},
		},
	};
	return p;
}
const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("finder automatic edge setting defaults off and refreshes views without a global reset button", async () => {
	const p = plugin(null);
	await p.onload();
	let refreshes = 0;
	p.editorSearch = { refreshToolbars: () => refreshes++, dispose() {} };
	const tab = tabs.at(-1);
	tab.display();
	assert.equal(p.settings.finderAutoDock, false);
	fields.get("settings.FinderAutoDock.name").change(true);
	await p.flushSettings();
	assert.equal(p.settings.finderAutoDock, true);
	assert.equal(p.writes.at(-1).finderAutoDock, true);
	assert.equal(refreshes, 1);
	assert.equal(
		tab.containerEl.querySelector('[data-name="search.tip.ResetFinderPosition"]'),
		null,
	);
	p.onunload();
});

test("floating entry setting defaults off, saves and only enabling applies it to existing notes", async () => {
	const p = plugin(null);
	await p.onload();
	let syncs = 0;
	p.editorSearch = { syncFloatingEntries: () => syncs++, dispose() {} };
	const tab = tabs.at(-1);
	tab.display();
	assert.equal(p.settings.showFloatingFinderOnOpen, false);
	fields.get("settings.ShowFloatingFinderOnOpen.name").change(true);
	await p.flushSettings();
	assert.equal(p.writes.at(-1).showFloatingFinderOnOpen, true);
	assert.equal(syncs, 1);
	fields.get("settings.ShowFloatingFinderOnOpen.name").change(false);
	await p.flushSettings();
	assert.equal(p.writes.at(-1).showFloatingFinderOnOpen, false);
	assert.equal(syncs, 1);
	p.onunload();
});

function definitionRows(items) {
	return items.flatMap((item) =>
		item.items ? definitionRows(item.items) : item.render ? [item] : [],
	);
}
function renderDefinition(root, def) {
	const setting = new Setting(root).setName(def.name).setDesc(def.desc);
	return { row: setting.settingEl, cleanup: def.render(setting, {}) };
}

test("1.13 definitions index every basic field without DOM, IO or writes, using the same controls as legacy tabs", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	const before = dom.window.document.body.innerHTML;
	const read = vi.spyOn(p.app.vault.adapter, "read");
	const definitions = tab.getSettingDefinitions();
	assert.equal(dom.window.document.body.innerHTML, before);
	assert.equal(read.mock.calls.length, 0);
	assert.equal(p.writes.length, 0);
	const rows = definitionRows(definitions);
	assert.equal(
		rows.filter(
			(def) =>
				def.name.startsWith("settings.") &&
				!def.name.startsWith("settings.Appearance") &&
				!def.name.startsWith("settings.Toolbar"),
		).length,
		12,
	);
	for (const page of ["general", "find", "replace", "history"]) {
		tab.display();
		if (page !== "general") tab.containerEl.querySelector(`#nya-settings-tab-${page}`).click();
		for (const name of fields.keys())
			assert.ok(
				rows.some((def) => def.name === name),
				`missing index: ${name}`,
			);
	}
	let refreshes = 0;
	p.editorSearch = { refreshToolbars: () => refreshes++, dispose() {} };
	const row = rows.find((def) => def.name === "settings.FinderAutoDock.name");
	renderDefinition(tab.containerEl, row);
	fields.get(row.name).change(true);
	await p.flushSettings();
	assert.equal(p.settings.finderAutoDock, true);
	assert.equal(refreshes, 1);
	assert.equal(p.writes.length, 1);
	p.onunload();
});

test("declarative history fields retain commit validation, IME safety, notifications and read-failure write protection", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1),
		rows = definitionRows(tab.getSettingDefinitions());
	const root = tab.containerEl;
	for (const name of ["HistoryMaxCount", "HistorySortOrder", "HistoryRetention"])
		renderDefinition(
			root,
			rows.find((def) => def.name === `settings.${name}.name`),
		);
	const text = fields.get("settings.HistoryMaxCount.name");
	text.inputEl.value = "4";
	text.inputEl.dispatchEvent(
		new dom.window.KeyboardEvent("keydown", { key: "Enter", isComposing: true }),
	);
	assert.notEqual(p.settings.historyMaxCount, 4);
	text.inputEl.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter" }));
	await p.flushSettings();
	assert.equal(p.settings.historyMaxCount, 4);
	text.inputEl.value = "300";
	text.inputEl.dispatchEvent(new dom.window.Event("blur"));
	assert.equal(text.inputEl.value, "4");
	fields.get("settings.HistorySortOrder.name").change("count");
	fields.get("settings.HistoryRetention.name").change("createdAt");
	await p.flushSettings();
	assert.equal(p.settings.historySortOrder, "count");
	assert.equal(p.settings.historyRetention, "createdAt");
	const accepted = p.writes.length;
	fields.get("settings.HistorySortOrder.name").change("invalid");
	await p.flushSettings();
	assert.equal(p.writes.length, accepted);
	p.onunload();
	const broken = plugin(null);
	broken.app.vault.adapter.read = async () => "{broken";
	await broken.onload();
	const failedTab = tabs.at(-1);
	renderDefinition(
		failedTab.containerEl,
		definitionRows(failedTab.getSettingDefinitions()).find(
			(def) => def.name === "settings.FinderAutoDock.name",
		),
	);
	fields.get("settings.FinderAutoDock.name").change(true);
	await settle();
	assert.equal(broken.writes.length, 0);
	broken.onunload();
});

test("declarative appearance rows are searchable, expanded, owner-local and clean up drafts, menus and stale controls", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	const page = tab.getSettingDefinitions().find((item) => item.type === "page");
	assert.equal(page.name, "settings.Tabs.toolbar");
	const rows = definitionRows(page.items);
	assert.equal(rows.length, 10);
	const preview = renderDefinition(tab.containerEl, rows[0]);
	assert.ok(preview.row.querySelector(".nya-finder-preview"));
	assert.equal(rows[0].searchable, false);
	let appearanceRefreshes = 0;
	p.refreshAppearance = () => appearanceRefreshes++;
	const color = renderDefinition(
		tab.containerEl,
		rows.find((def) => def.name.endsWith("settings.Appearance.focusBorder")),
	);
	const picker = color.row.querySelector(".nya-color-picker");
	picker.click();
	assert.ok(document.querySelector(".nya-color-popover"));
	const value = document.querySelector(".nya-color-value");
	value.value = "#1234";
	value.dispatchEvent(new dom.window.Event("input"));
	assert.deepEqual(p.settings.appearanceColors, {});
	document.querySelector(".nya-color-popover .mod-cta").click();
	await p.flushSettings();
	assert.equal(p.settings.appearanceColors.focusBorder, "#11223344");
	assert.equal(appearanceRefreshes, 1);
	const scope = renderDefinition(
		tab.containerEl,
		rows.find((def) => def.name === "settings.Appearance.scope"),
	);
	assert.equal(scope.row.querySelector(".nya-settings-section-body").hidden, false);
	fields.get("settings.Appearance.scopeBorderEnabled").toggleEl.click();
	assert.equal(p.settings.scopeAppearance.border, true);
	const toolbar = renderDefinition(
		tab.containerEl,
		rows.find((def) => def.name === "settings.Toolbar.search"),
	);
	assert.equal(toolbar.row.querySelector(".nya-settings-section-body").hidden, false);
	const more = toolbar.row.querySelector('[data-control="placement"]');
	picker.click();
	assert.ok(document.querySelector(".nya-color-popover"));
	more.click();
	assert.equal(document.querySelector(".nya-color-popover"), null);
	assert.ok(document.querySelector(".nya-settings-select-popover"));
	picker.click();
	assert.equal(document.querySelector(".nya-settings-select-popover"), null);
	assert.ok(document.querySelector(".nya-color-popover"));
	more.click();
	toolbar.cleanup();
	assert.equal(document.querySelector(".nya-settings-select-popover"), null);
	await p.flushSettings();
	const before = p.writes.length;
	const defaultToggle = fields.get("settings.Toolbar.defaultEnabled");
	more.click();
	assert.equal(document.querySelector(".nya-settings-select-popover"), null);
	picker.click();
	assert.ok(document.querySelector(".nya-color-popover"));
	tab.hide();
	assert.equal(document.querySelector(".nya-color-popover"), null);
	assert.equal(preview.row.querySelector(".nya-finder-preview"), null);
	picker.click();
	assert.equal(document.querySelector(".nya-color-popover"), null);
	defaultToggle.change(true);
	await p.flushSettings();
	assert.equal(p.writes.length, before);
	color.cleanup();
	scope.cleanup();
	preview.cleanup();
	p.onunload();
});

test("multiple same-document previews update together and cleanup retains surviving ownership", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	const rows = definitionRows(
		tab.getSettingDefinitions().find((item) => item.type === "page").items,
	);
	const first = renderDefinition(tab.containerEl, rows[0]);
	const second = renderDefinition(tab.containerEl, rows[0]);
	const toolbar = renderDefinition(
		tab.containerEl,
		rows.find((def) => def.name === "settings.Toolbar.search"),
	);
	const toggle = toolbar.row.querySelector('[data-action="regex"] .nya-toolbar-default button');
	toggle.click();
	await tick();
	for (const preview of [first, second])
		assert.equal(
			preview.row.querySelector('[data-preview-action="regex"]').dataset.active,
			"true",
		);
	const color = renderDefinition(
		tab.containerEl,
		rows.find((def) => def.name.endsWith("settings.Appearance.focusBorder")),
	);
	second.cleanup();
	color.row.querySelector(".nya-color-picker").click();
	assert.ok(
		document.querySelector(".nya-color-popover"),
		"surviving preview still owns interactions",
	);
	first.cleanup();
	assert.equal(document.querySelector(".nya-color-popover"), null);
	await p.flushSettings();
	const accepted = p.writes.length;
	toggle.click();
	await p.flushSettings();
	assert.equal(p.settings.defaultRegexMode, true, "no preview means old controls are inert");
	assert.equal(p.writes.length, accepted);
	const replacement = renderDefinition(tab.containerEl, rows[0]);
	color.row.querySelector(".nya-color-picker").click();
	assert.ok(document.querySelector(".nya-color-popover"));
	tab.hide();
	assert.equal(document.querySelector(".nya-color-popover"), null);
	for (const item of [first, second, replacement, color, toolbar]) item.cleanup();
	p.onunload();
});

test("declarative color group reset refreshes rows without host update and preserves scope preferences", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	p.settings.appearanceColors = { focusBorder: "#123456", scopeBorder: "#654321" };
	const update = vi.fn();
	tab.update = update;
	const page = tab.getSettingDefinitions().find((item) => item.type === "page");
	const group = page.items.find((item) => item.type === "group");
	const preview = renderDefinition(tab.containerEl, definitionRows(page.items)[0]);
	const color = renderDefinition(
		tab.containerEl,
		definitionRows(page.items).find((def) =>
			def.name.endsWith("settings.Appearance.focusBorder"),
		),
	);
	let click;
	const button = {
		extraSettingsEl: tab.containerEl,
		setIcon() {
			return this;
		},
		setTooltip() {
			return this;
		},
		onClick(fn) {
			click = fn;
			return this;
		},
	};
	group.extraButtons[0](button);
	click();
	await p.flushSettings();
	assert.deepEqual(p.settings.appearanceColors, { scopeBorder: "#654321" });
	assert.equal(update.mock.calls.length, 0);
	assert.equal(color.row.querySelector(".nya-color-reset").disabled, true);
	assert.equal(p.writes.length, 1);
	preview.cleanup();
	color.cleanup();
	click();
	assert.equal(p.writes.length, 1, "detached group reset is inert");
	p.onunload();
});

test("declarative appearance uses owner labels and rejects a foreign-document preview", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	const foreign = new JSDOM("<!doctype html><html><body></body></html>", {
		pretendToBeVisual: true,
	});
	const root = foreign.window.document.body;
	const rows = definitionRows(
		tab.getSettingDefinitions().find((item) => item.type === "page").items,
	);
	const preview = renderDefinition(tab.containerEl, rows[0]);
	const colorDef = rows.find((def) => def.name.endsWith("settings.Appearance.focusBorder"));
	const color = renderDefinition(root, colorDef);
	color.row.querySelector(".nya-color-picker").click();
	assert.equal(
		root.querySelector(".nya-color-popover"),
		null,
		"foreign preview cannot own this picker",
	);
	const ownerPreview = renderDefinition(root, rows[0]);
	const mainColor = renderDefinition(tab.containerEl, colorDef);
	mainColor.row.querySelector(".nya-color-picker").click();
	assert.ok(
		dom.window.document.querySelector(".nya-color-popover"),
		"second Document must not steal the first preview",
	);
	const scope = renderDefinition(
		root,
		rows.find((def) => def.name === "settings.Appearance.scope"),
	);
	const toolbar = renderDefinition(
		root,
		rows.find((def) => def.name === "settings.Toolbar.search"),
	);
	for (const el of root.querySelectorAll("[aria-labelledby], [aria-controls]")) {
		for (const attr of ["aria-labelledby", "aria-controls"]) {
			for (const id of (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean))
				assert.ok(
					foreign.window.document.getElementById(id),
					`missing owner ${attr}: ${id}`,
				);
		}
	}
	const ids = [...root.querySelectorAll("[id]")].map((el) => el.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(
		root.querySelector("[data-section][aria-label], .nya-color-group[aria-label]"),
		null,
	);
	assert.ok(color.row.querySelector(".nya-color-picker").getAttribute("aria-label"));
	color.row.querySelector(".nya-color-picker").click();
	assert.ok(root.querySelector(".nya-color-popover"));
	assert.equal(tab.containerEl.querySelector(".nya-color-popover"), null);
	preview.cleanup();
	assert.ok(
		root.querySelector(".nya-color-popover"),
		"old preview cleanup cannot destroy the replacement",
	);
	foreign.window.dispatchEvent(new foreign.window.Event("pagehide"));
	assert.equal(root.querySelector(".nya-color-popover"), null);
	assert.equal(root.querySelector(".nya-finder-preview"), null);
	color.row.querySelector(".nya-color-picker").click();
	assert.equal(root.querySelector(".nya-color-popover"), null);
	p.onunload();
	assert.equal(root.querySelector(".nya-color-popover"), null);
	assert.equal(root.querySelector(".nya-finder-preview"), null);
	color.cleanup();
	mainColor.cleanup();
	ownerPreview.cleanup();
	scope.cleanup();
	toolbar.cleanup();
	foreign.window.close();
});
function resetSection(section) {
	section.querySelector(".nya-settings-section-reset").click();
}

function setPlacement(root, action, value) {
	const row = root.querySelector(`[data-action="${action}"]`),
		section = row.closest("[data-section]");
	if (section.querySelector(".nya-settings-section-body").hidden)
		section.querySelector(".nya-settings-section-toggle").click();
	row.querySelector('[data-control="placement"]').click();
	document.querySelector(`.nya-settings-select-popover [data-value="${value}"]`).click();
}

test("malformed persisted JSON blocks writes even when host loadData would swallow the error", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const p = plugin(null);
	p.app.vault.adapter.read = async () => "{broken";
	p.loadData = async () => undefined;
	await p.loadSettings();
	await assert.rejects(p.saveSettings(), /refusing to overwrite/);
	assert.equal(p.writes.length, 0);
});

test("unload during a slow read does not register UI or accept new saves", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const p = plugin(null);
	let release;
	p.app.vault.adapter.read = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	const before = tabs.length;
	const load = p.onload();
	await settle();
	p.onunload();
	release("null");
	await load;
	assert.equal(tabs.length, before);
	await assert.rejects(p.saveSettings(), /unloaded/);
	assert.equal(p.writes.length, 0);
});

test("actual plugin reload reads all accepted snapshots before writing new history", async () => {
	let disk = JSON.stringify(settingsSource.defaultSettings());
	let release;
	let started;
	const firstStarted = new Promise((resolve) => {
		started = resolve;
	});
	const snapshots = [];
	const app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				stat: async () => ({ type: "file" }),
				read: async () => disk,
				write: async (_path, text) => {
					snapshots.push(JSON.parse(text));
					if (snapshots.length === 1) {
						started();
						await new Promise((resolve) => {
							release = resolve;
						});
					}
					disk = text;
				},
			},
		},
	};
	const old = plugin(null);
	old.app = app;
	await old.loadSettings();
	old.history.record("A");
	old.history.record("B");
	old.history.record("C");
	await firstStarted;
	old.onunload();
	const fresh = plugin(null);
	fresh.app = app;
	const load = fresh.loadSettings();
	release();
	await load;
	assert.deepEqual(
		fresh.history
			.sorted()
			.map((item) => item.text)
			.sort(),
		["A", "B", "C"],
	);
	fresh.history.record("NEW");
	await fresh.flushSettings();
	assert.ok(JSON.parse(disk).searchHistory.some((item) => item.text === "NEW"));
	assert.equal(snapshots.length, 2);
});

for (const manifestDir of [undefined, ".custom/plugins/renamed-folder"]) {
	test(`settings use original plugin data path with custom configuration directory: ${manifestDir ?? "fallback"}`, async () => {
		const p = plugin(null);
		const paths = [];
		p.manifest.dir = manifestDir;
		p.app.vault.configDir = ".custom";
		p.app.vault.adapter.stat = async (path) => {
			paths.push(path);
			return null;
		};
		p.app.vault.adapter.read = async () => {
			throw new Error("must not read missing file");
		};
		p.app.vault.adapter.write = async (path) => {
			paths.push(path);
		};
		await p.loadSettings();
		p.history.record("A");
		await p.flushSettings();
		assert.deepEqual(
			paths,
			Array(2).fill(`${manifestDir ?? ".custom/plugins/text-finder"}/data.json`),
		);
	});
}

test("stat/read race blocks saves rather than overwriting data that disappeared during load", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const p = plugin(null);
	p.app.vault.adapter.read = async () => {
		throw Object.assign(new Error("missing after stat"), { code: "ENOENT" });
	};
	await p.loadSettings();
	await assert.rejects(p.saveSettings(), /refusing to overwrite/);
	assert.equal(p.writes.length, 0);
});

test("actual plugin migrates all entries, saves once and loads normalized data unchanged", async () => {
	const p = plugin({
		searchHistory: [
			{ text: "new", createdAt: 5, lastUsedAt: 6, count: 2 },
			"old",
			{ text: "missingLast", createdAt: 2, count: 7 },
		],
	});
	await p.loadSettings();
	assert.equal(p.writes.length, 1);
	assert.equal(p.settings.searchHistory.length, 3);
	assert.equal(p.settings.searchHistory.find((i) => i.text === "missingLast").lastUsedAt, 2);
	p.data = p.writes[0];
	await p.loadSettings();
	assert.equal(p.writes.length, 1);
});

test("actual plugin saves retired reading preference migration once and preserves all other data", async () => {
	for (const value of [true, false]) {
		const expected = {
			...settingsSource.defaultSettings(),
			useSelectionAsSearch: false,
			searchHistory: [{ text: " cat\n\t ", createdAt: 5, lastUsedAt: 6, count: 2 }],
		};
		const p = plugin({ ...expected, useObsidianSearchInRead: value });
		await p.loadSettings();
		assert.deepEqual(p.settings, expected);
		assert.deepEqual(p.writes, [expected]);
		p.data = p.writes[0];
		await p.loadSettings();
		assert.equal(p.writes.length, 1);
		p.onunload();
	}
});

test("actual plugin tolerates null history without aborting load", async () => {
	const p = plugin({ searchHistory: null });
	await p.loadSettings();
	assert.deepEqual(p.settings.searchHistory, []);
	assert.equal(p.writes.length, 1);
});

test("read failure permits startup but blocks all writes until successful reload", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const p = plugin();
	p.loadData = async () => {
		throw new Error("read failed");
	};
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

test("migration write failure is reported but does not prevent loading or later saving", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const p = plugin({ searchHistory: ["A"] });
	let fails = true;
	p.saveData = async (snapshot) => {
		if (fails) throw new Error("disk failed");
		p.writes.push(snapshot);
	};
	await p.loadSettings();
	assert.equal(p.settings.searchHistory[0].text, "A");
	await assert.rejects(p.flushSettings(), /disk failed/);
	fails = false;
	p.history.record("B");
	await p.flushSettings();
	assert.deepEqual(p.writes[0].searchHistory.map((i) => i.text).sort(), ["A", "B"]);
});

test("interleaved real plugin history, deletion and settings writes never overlap", async () => {
	const p = plugin(null);
	await p.loadSettings();
	const jobs = [];
	let active = 0;
	p.saveData = (snapshot) => {
		active++;
		assert.equal(active, 1);
		p.writes.push(snapshot);
		return new Promise((resolve) =>
			jobs.push(() => {
				active--;
				resolve();
			}),
		);
	};
	p.history.record("A");
	await settle();
	assert.equal(p.writes.length, 1);
	p.history.record("B");
	p.history.remove(new Set(["A"]));
	p.settings.moveCursorToMatch = false;
	p.requestSaveSettings();
	await settle();
	assert.equal(p.writes.length, 1);
	for (let i = 0; i < 2; i++) {
		jobs[i]();
		await settle();
	}
	await p.flushSettings();
	assert.deepEqual(
		p.writes[0].searchHistory.map((i) => i.text),
		["A"],
	);
	assert.deepEqual(
		p.writes.at(-1).searchHistory.map((i) => i.text),
		["B"],
	);
	assert.equal(p.writes.at(-1).moveCursorToMatch, false);
});

test("capacity input only commits on Enter or blur, rejecting partial and malformed values", async () => {
	const p = plugin(null);
	await p.onload();
	p.settings.searchHistory = Array.from({ length: 10 }, (_, i) => ({
		text: String(i),
		count: 1,
		createdAt: i,
		lastUsedAt: i,
	}));
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

test("global escape settings route immediate replacement invalidation through the workspace", async () => {
	const p = plugin(null);
	await p.onload();
	let invalidations = 0;
	p.editorSearch = {
		replacementPreferencesChanged() {
			invalidations++;
		},
		dispose() {},
	};
	const tab = tabs.at(-1);
	const row = definitionRows(tab.getSettingDefinitions()).find(
		(def) => def.name === "settings.UseEscapeCharInReplace.name",
	);
	const rendered = renderDefinition(tab.containerEl, row);
	const control = fields.get("settings.UseEscapeCharInReplace.name");
	control.change(false);
	control.change(true);
	control.change(true);
	assert.equal(invalidations, 2);
	rendered.cleanup?.();
	await p.flushSettings();
	p.onunload();
});

test("settings toggles and sort changes save through the queue and notify subscribers", async () => {
	const p = plugin(null);
	await p.onload();
	tabs.at(-1).display();
	tabs.at(-1).containerEl.querySelector('[role="tab"][id$="-history"]').click();
	let updates = 0;
	const unsubscribe = p.history.subscribe(() => {
		updates++;
	});
	fields.get("settings.EnableHistory.name").change(false);
	fields.get("settings.HistorySortOrder.name").change("count");
	assert.equal(p.settings.historyRetention, "lastUsedAt", "view order never changes retention");
	fields.get("settings.HistoryRetention.name").change("count");
	tabs.at(-1).containerEl.querySelector('[role="tab"][id$="-find"]').click();
	fields.get("settings.MoveCursorToMatch.name").change(false);
	await p.flushSettings();
	assert.equal(updates, 4);
	assert.equal(p.writes.length, 1);
	assert.equal(p.writes.at(-1).enableHistory, false);
	assert.equal(p.writes.at(-1).historySortOrder, "count");
	assert.equal(p.writes.at(-1).historyRetention, "count");
	unsubscribe();
});

test("five settings tabs omit retired controls and support keyboard navigation", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	const root = tab.containerEl;
	assert.equal(root.querySelectorAll('[role="tab"]').length, 5);
	const names = () => [...root.querySelectorAll("[data-name]")].map((el) => el.dataset.name);
	assert.equal(
		root.querySelector('[role="tab"][aria-selected="true"]').id,
		"nya-settings-tab-general",
	);
	assert.deepEqual(names(), [
		"settings.ShowFloatingFinderOnOpen.name",
		"settings.FinderAutoDock.name",
	]);
	root.querySelector("#nya-settings-tab-general").dispatchEvent(
		new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
	);
	assert.deepEqual(names(), [
		"settings.ClearAfterHidden.name",
		"settings.EnableInputHotkeys.name",
		"settings.UseSelectionAsSearch.name",
		"settings.SourceModeWhenSearch.name",
		"settings.MoveCursorToMatch.name",
	]);
	assert.ok(!names().includes("settings.FinderAutoDock.name"));
	assert.ok(!names().includes("settings.EnableHistory.name"));
	root.querySelector("#nya-settings-tab-find").dispatchEvent(
		new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
	);
	assert.deepEqual(names(), ["settings.UseEscapeCharInReplace.name"]);
	assert.equal(
		root.querySelector('[role="tab"][aria-selected="true"]').id,
		"nya-settings-tab-replace",
	);
	root.querySelector("#nya-settings-tab-history").click();
	assert.equal(names().length, 4);
	const input = root.querySelector("input");
	input.focus();
	input.value = "17";
	root.querySelector("#nya-settings-tab-find").click();
	assert.equal(
		p.settings.historyMaxCount,
		17,
		"switching tabs commits a focused history capacity input",
	);
	await p.flushSettings();
});

test("toolbar placement changes compose, reorder supports keys/buttons, reset affects only one toolbar", async () => {
	const p = plugin(null);
	await p.onload();
	let refreshes = 0;
	p.editorSearch = { refreshToolbars: () => refreshes++, dispose: () => {} };
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	setPlacement(root, "regex", "more");
	setPlacement(root, "case", "hidden");
	assert.equal(p.settings.searchToolbar[0].placement, "more");
	assert.equal(p.settings.searchToolbar[1].placement, "hidden");
	root.querySelector('[data-action="regex"] [data-control="down"]').click();
	assert.deepEqual(
		p.settings.searchToolbar.slice(0, 2).map((i) => i.id),
		["case", "regex"],
	);
	root.querySelector('[data-action="regex"] [data-control="handle"]').dispatchEvent(
		new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
	);
	assert.equal(p.settings.searchToolbar[0].id, "regex");
	setPlacement(root, "replace", "more");
	const sections = root.querySelectorAll(".nya-toolbar-settings");
	resetSection(sections[0]);
	assert.deepEqual(p.settings.searchToolbar, toolbarSource.defaultToolbar("search"));
	assert.equal(p.settings.replaceToolbar[0].placement, "more");
	assert.equal(refreshes, 6);
	await p.flushSettings();
	assert.equal(p.writes.at(-1).replaceToolbar[0].placement, "more");
	p.onunload();
});

test("custom placement select navigates without saving and commits once with live preview and scoped refresh", async () => {
	const p = plugin(null);
	await p.onload();
	let refreshes = 0;
	p.editorSearch = { refreshToolbars: () => refreshes++, dispose: () => {} };
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	root.querySelector('[data-section="search"] .nya-settings-section-toggle').click();
	await p.flushSettings();
	const writes = p.writes.length;
	const trigger = root.querySelector('[data-action="regex"] [role="combobox"]');
	const key = (value) =>
		trigger.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: value,
				bubbles: true,
				cancelable: true,
			}),
		);
	key("Enter");
	key("End");
	await p.flushSettings();
	assert.equal(p.writes.length, writes);
	assert.equal(refreshes, 0);
	assert.equal(p.settings.searchToolbar[0].placement, "inline");
	assert.equal(
		document.querySelector('[role="listbox"] [data-highlighted="true"]').dataset.value,
		"hidden",
	);
	key("Enter");
	await tick();
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1);
	assert.equal(refreshes, 1);
	assert.equal(p.settings.searchToolbar[0].placement, "hidden");
	assert.equal(root.querySelector('.nya-toolbar-preview [data-preview-action="regex"]'), null);
	assert.deepEqual(p.settings.replaceToolbar, toolbarSource.defaultToolbar("replace"));
	key("Enter");
	key("Enter");
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1, "selecting the current option does not save");
	p.onunload();
});

test("placement popups close on fold, reset, reorder, page switch, redraw, hide and unload; detached options are inert", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	for (const reason of ["fold", "reset", "reorder", "switch", "redraw", "hide", "unload"]) {
		const section = root.querySelector('[data-section="search"]');
		if (section.querySelector(".nya-settings-section-body").hidden)
			section.querySelector(".nya-settings-section-toggle").click();
		const trigger = section.querySelector('[data-action="regex"] [role="combobox"]');
		trigger.click();
		const old = document.querySelector('.nya-settings-select-popover [data-value="hidden"]');
		assert.ok(old);
		if (reason === "fold") section.querySelector(".nya-settings-section-toggle").click();
		if (reason === "reset") resetSection(section);
		if (reason === "reorder")
			section.querySelector('[data-action="regex"] [data-control="down"]').click();
		if (reason === "switch") root.querySelector("#nya-settings-tab-find").click();
		if (reason === "redraw") tab.display();
		if (reason === "hide") tab.hide();
		if (reason === "unload") p.onunload();
		assert.equal(document.querySelector(".nya-settings-select-popover"), null, reason);
		await p.flushSettings();
		const writes = p.writes.length,
			before = JSON.stringify(p.settings);
		old.click();
		assert.equal(JSON.stringify(p.settings), before);
		await p.flushSettings();
		assert.equal(p.writes.length, writes);
		if (reason !== "unload") {
			tab.display();
			root.querySelector("#nya-settings-tab-toolbar").click();
		}
	}
});

test("opening placement cancels color drafts and opening a picker dismisses placement without a write", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	root.querySelectorAll(".nya-settings-section-toggle").forEach((toggle) => toggle.click());
	await p.flushSettings();
	const writes = p.writes.length;
	const picker = root.querySelector(".nya-color-picker"),
		trigger = root.querySelector('[data-section="search"] [role="combobox"]');
	picker.click();
	assert.ok(document.querySelector(".nya-color-popover"));
	trigger.click();
	assert.equal(document.querySelector(".nya-color-popover"), null);
	assert.ok(document.querySelector(".nya-settings-select-popover"));
	picker.click();
	assert.equal(document.querySelector(".nya-settings-select-popover"), null);
	assert.ok(document.querySelector(".nya-color-popover"));
	assert.equal(
		root
			.querySelector(".nya-appearance-preview")
			.style.getPropertyValue("--nya-focus-border-color"),
		"",
	);
	await p.flushSettings();
	assert.equal(p.writes.length, writes);
	p.onunload();
});

function pointer(target, type, y) {
	const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientY: y });
	target.dispatchEvent(event);
}

test("toolbar defaults update the real preview and restore defaults resets only the selected toolbar in one snapshot", async () => {
	const p = plugin(null);
	await p.onload();
	let refreshes = 0;
	p.editorSearch = { refreshToolbars: () => refreshes++ };
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl,
		preview = root.querySelector(".nya-toolbar-preview");
	const row = (id) => root.querySelector(`[data-action="${id}"]`);
	assert.equal(root.querySelectorAll(".nya-toolbar-default").length, 3);
	const regex = row("regex").querySelector(".nya-toolbar-default button");
	regex.click();
	await tick();
	assert.equal(p.settings.defaultRegexMode, true);
	assert.equal(preview.querySelector('[data-preview-action="regex"]').dataset.active, "true");
	assert.equal(refreshes, 0, "default changes do not update existing finders");
	setPlacement(root, "regex", "hidden");
	await tick();
	assert.equal(row("regex").querySelector(".nya-toolbar-warning"), null);
	assert.equal(preview.querySelector('[data-preview-action="regex"]'), null);
	assert.equal(p.settings.defaultRegexMode, true);
	row("case").querySelector(".nya-toolbar-default button").click();
	row("wholeWord").querySelector(".nya-toolbar-default button").click();
	await tick();
	assert.equal(p.settings.defaultWholeWord, true);
	assert.equal(preview.querySelector('[data-preview-action="wholeWord"]').dataset.active, "true");
	setPlacement(root, "replace", "more");
	await p.flushSettings();
	resetSection(root.querySelectorAll(".nya-toolbar-settings")[1]);
	await tick();
	await p.flushSettings();
	assert.equal(p.settings.defaultRegexMode, true);
	assert.equal(
		p.settings.defaultCaseSensitive,
		true,
		"replace reset does not reset search defaults",
	);
	assert.equal(p.settings.defaultWholeWord, true);
	assert.equal(p.settings.searchToolbar[0].placement, "hidden");
	assert.deepEqual(p.settings.replaceToolbar, toolbarSource.defaultToolbar("replace"));
	setPlacement(root, "replace", "more");
	await p.flushSettings();
	const writes = p.writes.length;
	resetSection(root.querySelector(".nya-toolbar-settings"));
	await tick();
	assert.equal(p.settings.defaultRegexMode, false);
	assert.equal(p.settings.defaultCaseSensitive, false);
	assert.equal(p.settings.defaultWholeWord, false);
	assert.deepEqual(p.settings.searchToolbar, toolbarSource.defaultToolbar("search"));
	assert.equal(
		p.settings.replaceToolbar[0].placement,
		"more",
		"search reset leaves replace configuration unchanged",
	);
	assert.equal(row("regex").querySelector(".nya-toolbar-warning"), null);
	assert.equal(preview.querySelector('[data-preview-action="regex"]').dataset.active, "false");
	assert.equal(
		preview.querySelector('[data-preview-action="wholeWord"]').dataset.active,
		"false",
	);
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1, "reset saves layout and default options together");
	assert.equal(p.writes.at(-1).defaultRegexMode, false);
	assert.equal(p.writes.at(-1).defaultCaseSensitive, false);
	assert.equal(p.writes.at(-1).defaultWholeWord, false);
	p.data = p.writes.at(-1);
	await p.loadSettings();
	assert.equal(p.settings.defaultRegexMode, false);
	tab.hide();
});

test("preview stays expanded, reorders live and has no controls, menu actions or document listeners", async () => {
	const p = plugin(null);
	await p.onload();
	const listeners = new Set(),
		doc = dom.window.document;
	const add = doc.addEventListener.bind(doc),
		remove = doc.removeEventListener.bind(doc);
	vi.spyOn(doc, "addEventListener").mockImplementation((type, handler, ...rest) => {
		if (type === "pointerdown") listeners.add(handler);
		return add(type, handler, ...rest);
	});
	vi.spyOn(doc, "removeEventListener").mockImplementation((type, handler, ...rest) => {
		if (type === "pointerdown") listeners.delete(handler);
		return remove(type, handler, ...rest);
	});
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	const preview = () => root.querySelector(".nya-toolbar-preview");
	setPlacement(root, "regex", "more");
	root.querySelector('[data-action="regex"] .nya-toolbar-default button').click();
	await tick();
	const writes = p.writes.length;
	await p.flushSettings();
	const saved = p.writes.length;
	const trigger = preview().querySelector('[data-preview-action="more"]');
	assert.equal(trigger.getAttribute("data-has-active"), "true");
	assert.equal(trigger.classList.contains("nya-btn--active"), false);
	assert.ok(trigger.querySelector(".nya-toolbar-indicator"));
	trigger.click();
	await tick();
	trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	await tick();
	assert.equal(preview().querySelector('[role="menu"]'), null);
	doc.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
	await tick();
	assert.equal(preview().querySelector('[role="menu"]'), null);
	preview().querySelector('[data-preview-action="case"]').click();
	await tick();
	preview().querySelector('[data-preview-action="wholeWord"]').click();
	await tick();
	assert.equal(p.settings.defaultWholeWord, false);
	assert.equal(p.settings.defaultRegexMode, true);
	assert.equal(p.settings.defaultCaseSensitive, false);
	assert.equal(p.writes.length, saved, "inspecting preview never saves settings");
	assert.equal(preview().querySelectorAll(".nya-preview-input").length, 2);
	preview().querySelector(".nya-preview-toggle").click();
	await tick();
	assert.equal(preview().querySelectorAll(".nya-preview-input").length, 2);
	assert.equal(
		preview().querySelectorAll(
			'textarea, input, button, [role="button"], [tabindex], [contenteditable]',
		).length,
		0,
	);
	trigger.focus();
	assert.notEqual(doc.activeElement, trigger);
	root.querySelector('[data-action="next"] [data-control="up"]').click();
	await tick();
	const actions = [
		...preview().querySelectorAll(".nya-preview-search-actions .nya-toolbar > span"),
	].map((button) => button.dataset.previewAction);
	assert.deepEqual(actions, ["case", "wholeWord", "next", "previous", "more"]);
	assert.ok(p.writes.length >= writes);
	assert.equal(listeners.size, 0, "presentation does not register pointer listeners");
	setPlacement(root, "regex", "inline");
	await tick();
	assert.equal(
		preview().querySelector('[data-preview-action="more"]').getAttribute("data-has-active"),
		"false",
		"inline active default is not aggregated into More",
	);
	assert.equal(
		preview().querySelector('[data-preview-action="more"] .nya-toolbar-indicator'),
		null,
	);
	tab.hide();
	assert.equal(preview(), null);
	assert.equal(listeners.size, 0);
	tab.display();
	assert.equal(listeners.size, 0);
	root.querySelector("#nya-settings-tab-find").click();
	assert.equal(preview(), null);
	assert.equal(listeners.size, 0);
	root.querySelector("#nya-settings-tab-toolbar").click();
	assert.ok(preview());
	assert.equal(listeners.size, 0);
	p.onunload();
	assert.equal(preview(), null);
	assert.equal(listeners.size, 0);
});

test("toolbar blocks separate identity/reorder from configuration and omit explanation paragraphs", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	assert.equal(root.querySelectorAll(".nya-settings-panel p").length, 0);
	const blocks = [...root.querySelectorAll(".nya-toolbar-row")];
	assert.equal(blocks.length, 9);
	for (const block of blocks) {
		const header = block.querySelector(".nya-toolbar-row-controls"),
			options = block.querySelector(".nya-toolbar-row-options");
		assert.ok(header.querySelector(".nya-toolbar-name"));
		assert.ok(header.querySelector(".nya-toolbar-item-icon").dataset.icon);
		assert.equal(header.querySelectorAll("button").length, 2);
		assert.equal(
			block.firstElementChild.dataset.control,
			"handle",
			"full-height handle is outside the two content rows",
		);
		assert.equal(header.querySelector("select"), null);
		assert.ok(
			options
				.querySelector('.nya-toolbar-placement > [role="combobox"]')
				.getAttribute("aria-label"),
		);
		assert.equal(options.querySelector('[role="combobox"]').dataset.size, "sm");
		assert.equal(options.querySelector('[role="combobox"]').dataset.width, "content");
		assert.equal(
			options.querySelector(".nya-toolbar-placement").children.length,
			1,
			"only the select trigger is shown",
		);
		assert.equal(
			options.querySelector(".nya-toolbar-select-arrow").dataset.icon,
			"chevron-down",
		);
		assert.equal(
			options.querySelectorAll(".nya-toolbar-default").length,
			["regex", "case", "wholeWord"].includes(block.dataset.action) ? 1 : 0,
		);
	}
	assert.ok(
		root.querySelector(".nya-toolbar-default button").title,
		"default timing remains available as a tooltip",
	);
	tab.hide();
});

test("preview shows fixed English matches, an empty replacement placeholder and distinct UI/body typography", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const preview = tab.containerEl.querySelector(".nya-toolbar-preview");
	assert.equal(preview.querySelector(".nya-preview-find").textContent, "text");
	const replacement = preview.querySelector(".nya-preview-replace");
	assert.equal(replacement.childNodes.length, 1);
	assert.equal(
		replacement.querySelector(".nya-preview-placeholder").textContent,
		"search.tip.ReplacePlaceholder",
	);
	const text = preview.querySelector(".nya-preview-text");
	assert.equal(
		text.textContent.trim(),
		"Find text and more text within this text selection, not outside.",
	);
	assert.equal(preview.querySelectorAll(".nya-preview-text, .nya-preview-scope").length, 1);
	assert.equal(text.querySelectorAll(":scope > div").length, 2);
	assert.equal(text.querySelectorAll('[data-nya-scope="preview"]').length, 2);
	assert.equal(text.lang, "en");
	assert.equal(text.querySelectorAll(".nya-text-finder-match-current").length, 1);
	assert.equal(text.querySelectorAll(".nya-text-finder-match").length, 3);
	assert.equal(
		text.querySelectorAll(".nya-text-finder-match:not(.nya-text-finder-match-current)").length,
		2,
	);
	assert.ok(
		[...text.querySelectorAll(".nya-text-finder-match")].every(
			(span) => span.textContent === "text",
		),
	);
	assert.ok(text.querySelector(".nya-text-finder-scope .nya-text-finder-match-current"));
	const css = previewStyles.join("\n");
	const rule = (name) =>
		[...css.matchAll(new RegExp(`\\.${name}[^{}]*\\{([^}]+)\\}`, "g"))]
			.map((match) => match[1])
			.join(";");
	assert.match(rule("nya-preview-input"), /font-family:\s*var\(--font-interface\)/);
	assert.match(rule("nya-preview-input"), /font-size:\s*var\(--font-ui-small\)/);
	assert.match(rule("nya-preview-input"), /color:\s*var\(--text-normal\)/);
	assert.match(rule("nya-preview-placeholder"), /font:\s*inherit/);
	assert.match(rule("nya-preview-placeholder"), /color:\s*var\(--text-faint\)/);
	assert.match(rule("nya-preview-find"), /border-color:\s*var\(--nya-focus-border-color\)/);
	assert.doesNotMatch(rule("nya-preview-text"), /(?:^|;)(?:min-)?height:/);
	assert.match(rule("nya-preview-text"), /padding:\s*8px 12px/);
	assert.match(rule("nya-preview-text"), /font-size:\s*var\(--font-text-size\)/);
	assert.doesNotMatch(rule("nya-preview-text"), /overflow:\s*hidden/);
	assert.equal(
		preview.querySelectorAll('input, textarea, button, [tabindex], [role="button"]').length,
		0,
	);
	tab.hide();
});

test("appearance drafts stay local, apply saves once, and resets leave toolbar/session options unchanged", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl,
		controls = root.querySelector(".nya-appearance-controls");
	assert.ok(root.classList.contains("nya-settings--appearance"));
	assert.ok(controls.previousElementSibling.querySelector(".nya-toolbar-preview"));
	assert.equal(controls.querySelector(".nya-toolbar-preview"), null);
	assert.equal(controls.querySelectorAll("[data-color]").length, 8);
	assert.equal(controls.querySelectorAll('input[type="range"], input[type="color"]').length, 0);
	const row = (key) => controls.querySelector(`[data-color="${key}"]`);
	const preview = root.querySelector(".nya-appearance-preview");
	const frames = new Map();
	let nextFrame = 0;
	vi.spyOn(dom.window, "requestAnimationFrame").mockImplementation((fn) => {
		frames.set(++nextFrame, fn);
		return nextFrame;
	});
	vi.spyOn(dom.window, "cancelAnimationFrame").mockImplementation((id) => frames.delete(id));
	const flushFrame = () => {
		const pending = [...frames.values()];
		frames.clear();
		pending.forEach((fn) => fn());
	};
	const open = (key) => {
		const section = row(key).closest("[data-section]");
		if (section.querySelector(".nya-settings-section-body").hidden)
			section.querySelector(".nya-settings-section-toggle").click();
		row(key).querySelector(".nya-color-picker").click();
	};
	const dialog = () => document.querySelector(".nya-color-popover");
	const input = () => dialog().querySelector(".nya-color-value");
	const change = (color) => {
		input().value = color;
		input().dispatchEvent(new dom.window.Event("input"));
	};
	const apply = () => dialog().querySelector(".mod-cta").click();
	const setColor = async (key, color) => {
		open(key);
		change(color);
		apply();
		await p.flushSettings();
	};
	const before = JSON.stringify(p.settings.searchToolbar);
	await p.flushSettings();
	const initialWrites = p.writes.length;
	let refreshes = 0;
	const refresh = p.refreshAppearance.bind(p);
	vi.spyOn(p, "refreshAppearance").mockImplementation(() => {
		refreshes++;
		refresh();
	});
	open("matchBackground");
	const picker = dialog().querySelector(".nya-color-library");
	assert.equal(
		picker.shadowRoot.querySelectorAll('[role="slider"]').length,
		3,
		"real library supplies saturation, hue and alpha",
	);
	for (let i = 0; i < 60; i++)
		picker.dispatchEvent(
			new dom.window.CustomEvent("color-changed", { detail: { value: "#abcdef80" } }),
		);
	assert.equal(frames.size, 1, "drag events merge into one preview frame");
	flushFrame();
	assert.equal(preview.style.getPropertyValue("--nya-match-bgColor"), "#abcdef80");
	assert.deepEqual(p.settings.appearanceColors, {});
	assert.equal(document.querySelector("style[data-nya-appearance]"), null);
	input().dispatchEvent(new dom.window.Event("blur"));
	await p.flushSettings();
	assert.equal(p.writes.length, initialWrites);
	assert.equal(refreshes, 0);
	change("#12");
	assert.equal(input().getAttribute("aria-invalid"), "true");
	assert.equal(dialog().querySelector(".mod-cta").disabled, true);
	change("#11223344");
	apply();
	await p.flushSettings();
	assert.equal(frames.size, 0, "apply cancels outstanding draft frame");
	assert.equal(preview.style.getPropertyValue("--nya-match-bgColor"), "");
	assert.equal(p.writes.length, initialWrites + 1);
	assert.equal(refreshes, 1);
	await setColor("currentMatchText", "#ABC");
	assert.deepEqual(p.settings.appearanceColors, {
		matchBackground: "#11223344",
		currentMatchText: "#aabbcc",
	});
	const style = document.querySelector("style[data-nya-appearance]");
	assert.match(style.textContent, /--nya-match-bgColor: #11223344 !important/);
	assert.match(style.textContent, /--nya-match-curColor: #aabbcc !important/);
	open("currentMatchText");
	input().value = "#ffffff";
	input().dispatchEvent(new dom.window.InputEvent("input", { isComposing: true }));
	assert.equal(dialog().querySelector(".mod-cta").disabled, true);
	dialog().querySelector("button:not(.mod-cta)").click();
	assert.equal(p.settings.appearanceColors.currentMatchText, "#aabbcc");
	row("matchBackground").querySelector(".nya-color-reset").click();
	assert.deepEqual(p.settings.appearanceColors, { currentMatchText: "#aabbcc" });
	assert.doesNotMatch(style.textContent, /--nya-match-bgColor/);
	await p.flushSettings();
	p.data = p.writes.at(-1);
	await p.loadSettings();
	assert.deepEqual(p.settings.appearanceColors, { currentMatchText: "#aabbcc" });
	assert.equal(JSON.stringify(p.settings.searchToolbar), before);
	assert.equal(p.settings.defaultRegexMode, false);
	resetSection(root.querySelector(".nya-toolbar-settings"));
	assert.deepEqual(
		p.settings.appearanceColors,
		{ currentMatchText: "#aabbcc" },
		"toolbar reset leaves colors alone",
	);
	p.settings.defaultRegexMode = true;
	open("currentMatchText");
	change("#123456");
	flushFrame();
	await p.flushSettings();
	const resetWrites = p.writes.length;
	resetSection(controls.querySelector(".nya-color-settings"));
	assert.equal(dialog(), null);
	assert.equal(preview.style.getPropertyValue("--nya-match-curColor"), "");
	assert.deepEqual(p.settings.appearanceColors, {});
	assert.equal(p.settings.defaultRegexMode, true, "color reset leaves defaults alone");
	assert.equal(document.querySelector("style[data-nya-appearance]"), null);
	assert.ok(
		[...controls.querySelectorAll(".nya-color-reset")].every((button) => button.disabled),
	);
	await p.flushSettings();
	assert.equal(p.writes.length, resetWrites + 1, "color section reset saves one snapshot");
	root.querySelector("#nya-settings-tab-find").click();
	assert.equal(root.classList.contains("nya-settings--appearance"), false);
	p.onunload();
	await p.flushSettings();
});

test("search selection controls persist width/toggle, preview alpha drafts locally and reset only their own group", async () => {
	const p = plugin({ appearanceColors: { matchText: "#abcdef" } });
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl,
		section = root.querySelector('[data-section="scope"]');
	assert.ok(section);
	assert.equal(section.querySelector(".nya-settings-section-body").hidden, true);
	section.querySelector(".nya-settings-section-toggle").click();
	const sample = root.querySelector(".nya-preview-scope");
	assert.equal(sample.querySelectorAll('[data-nya-scope="preview"]').length, 2);
	assert.ok(sample.querySelector(".nya-text-finder-match"));
	assert.equal(sample.getAttribute("aria-label"), null);
	const toggle = section.querySelector('[aria-label="settings.Appearance.scopeBorderEnabled"]');
	const details = section.querySelector(".nya-scope-details");
	assert.equal(details.hidden, true);
	assert.equal(document.getElementById(toggle.getAttribute("aria-controls")), details);
	assert.ok(
		toggle.parentElement.compareDocumentPosition(details) &
			dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
	);
	assert.equal(section.querySelector('[data-color="scopeBackground"]').closest("[hidden]"), null);
	assert.equal(section.querySelector('[data-color="scopeBorder"]').closest("[hidden]"), details);
	toggle.click();
	await p.flushSettings();
	assert.equal(details.hidden, false);
	assert.deepEqual(p.settings.scopeAppearance, { border: true, width: 1 });
	assert.match(
		document.querySelector("style[data-nya-appearance]").textContent,
		/--nya-scope-border-width: 1px/,
	);
	section.querySelector("[data-scope-width] button").click();
	document.querySelector('.nya-settings-select-popover [data-value="3"]').click();
	await p.flushSettings();
	assert.equal(p.writes.at(-1).scopeAppearance.width, 3);
	assert.match(
		document.querySelector("style[data-nya-appearance]").textContent,
		/--nya-scope-border-width: 3px/,
	);
	const preview = root.querySelector(".nya-appearance-preview");
	for (const [key, variable] of [
		["scopeBackground", "--nya-scope-background"],
		["scopeBorder", "--nya-scope-border-color"],
	]) {
		section.querySelector(`[data-color="${key}"] .nya-color-picker`).click();
		const dialog = document.querySelector(".nya-color-popover"),
			input = dialog.querySelector("input");
		assert.equal(
			dialog
				.querySelector(".nya-color-library")
				.shadowRoot.querySelectorAll('[role="slider"]').length,
			3,
		);
		input.value = "#12345680";
		input.dispatchEvent(new dom.window.Event("input"));
		await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
		assert.equal(preview.style.getPropertyValue(variable), "#12345680");
		assert.equal(p.settings.appearanceColors[key], undefined);
		dialog.querySelector(".mod-cta").click();
		await p.flushSettings();
		assert.equal(p.writes.at(-1).appearanceColors[key], "#12345680");
		assert.equal(preview.style.getPropertyValue(variable), "");
	}
	// Turning the feature off hides dependants, not their persisted values.
	section.querySelector('[data-color="scopeBorder"] .nya-color-picker').click();
	assert.ok(document.querySelector(".nya-color-popover"));
	toggle.click();
	await p.flushSettings();
	assert.equal(details.hidden, true);
	assert.equal(document.querySelector(".nya-color-popover"), null);
	assert.deepEqual(p.settings.scopeAppearance, { border: false, width: 3 });
	assert.equal(p.settings.appearanceColors.scopeBorder, "#12345680");
	section.querySelector("[data-scope-width] button").click();
	section.querySelector('[data-color="scopeBorder"] .nya-color-picker').click();
	assert.equal(document.querySelector(".nya-settings-select-popover, .nya-color-popover"), null);
	toggle.click();
	await p.flushSettings();
	assert.equal(details.hidden, false);
	assert.equal(section.querySelector("[data-scope-width] button").dataset.value, "3");
	const widthTrigger = section.querySelector("[data-scope-width] button");
	widthTrigger.click();
	assert.ok(document.querySelector(".nya-settings-select-popover"));
	toggle.click();
	await p.flushSettings();
	assert.equal(document.querySelector(".nya-settings-select-popover"), null);
	assert.equal(
		document.activeElement,
		toggle,
		"hiding focused child returns focus to the controlling toggle",
	);
	toggle.click();
	await p.flushSettings();
	resetSection(root.querySelector('[data-section="colors"]'));
	assert.deepEqual(p.settings.appearanceColors, {
		scopeBackground: "#12345680",
		scopeBorder: "#12345680",
	});
	assert.deepEqual(p.settings.scopeAppearance, { border: true, width: 3 });
	p.settings.appearanceColors.matchText = "#abcdef";
	await p.flushSettings();
	const writes = p.writes.length;
	resetSection(section);
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1);
	assert.deepEqual(p.settings.scopeAppearance, { border: false, width: 1 });
	assert.deepEqual(p.settings.appearanceColors, { matchText: "#abcdef" });
	assert.doesNotMatch(
		document.querySelector("style[data-nya-appearance]").textContent,
		/--nya-scope-/,
	);
	assert.equal(section.querySelector("[data-scope-width] button").dataset.value, "1");
	assert.equal(section.querySelector(".nya-scope-details").hidden, true);
	toggle.click();
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1);
	const replacement = section.querySelector(
		'[aria-label="settings.Appearance.scopeBorderEnabled"]',
	);
	tab.hide();
	replacement.click();
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1);
	p.data = p.writes.at(-1);
	await p.loadSettings();
	assert.deepEqual(p.settings.scopeAppearance, { border: false, width: 1 });
	p.onunload();
});

test("color drafts cancel on Escape/outside/switch/hide/redraw/unload without saving or leaving preview frames", async () => {
	const p = plugin({ appearanceColors: { matchText: "#123456" } });
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const frames = new Map();
	let next = 0;
	vi.spyOn(dom.window, "requestAnimationFrame").mockImplementation((fn) => {
		frames.set(++next, fn);
		return next;
	});
	vi.spyOn(dom.window, "cancelAnimationFrame").mockImplementation((id) => frames.delete(id));
	await p.flushSettings();
	const writes = p.writes.length;
	for (const reason of ["escape", "outside", "switch", "hide", "redraw", "unload"]) {
		const root = tab.containerEl,
			preview = root.querySelector(".nya-appearance-preview");
		const trigger = root.querySelector('[data-color="matchText"] .nya-color-picker');
		const section = trigger.closest("[data-section]");
		if (section.querySelector(".nya-settings-section-body").hidden)
			section.querySelector(".nya-settings-section-toggle").click();
		trigger.click();
		const input = document.querySelector(".nya-color-popover .nya-color-value");
		input.value = "#abcdef80";
		input.dispatchEvent(new dom.window.Event("input"));
		assert.equal(frames.size, 1);
		if (reason === "escape")
			document.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		if (reason === "outside")
			document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
		if (reason === "switch") root.querySelector("#nya-settings-tab-find").click();
		if (reason === "hide") tab.hide();
		if (reason === "redraw") tab.display();
		if (reason === "unload") p.onunload();
		assert.equal(frames.size, 0);
		assert.equal(document.querySelector(".nya-color-popover"), null);
		assert.equal(preview.style.getPropertyValue("--nya-match-color"), "");
		assert.deepEqual(p.settings.appearanceColors, { matchText: "#123456" });
		await p.flushSettings();
		assert.equal(p.writes.length, writes);
		if (reason !== "unload") {
			tab.display();
			tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
		}
	}
});

test("plugin propagates appearance colors to existing/new popup documents and unregisters styles on close/unload", async () => {
	const p = plugin({ appearanceColors: { matchText: "#123456" } });
	const popup = new JSDOM("<!doctype html><body></body>");
	const events = new Map();
	let ready;
	p.app.workspace = {
		on: (name, callback) => {
			events.set(name, callback);
			return {};
		},
		onLayoutReady: (callback) => {
			ready = callback;
		},
		iterateAllLeaves: (callback) =>
			callback({ view: { containerEl: popup.window.document.body } }),
	};
	await p.onload();
	ready();
	assert.match(
		popup.window.document.querySelector("style").textContent,
		/--nya-match-color: #123456/,
	);
	events.get("window-close")({}, popup.window);
	assert.equal(popup.window.document.querySelector("style"), null);
	events.get("window-open")({}, popup.window);
	assert.ok(popup.window.document.querySelector("style"));
	p.onunload();
	ready();
	events.get("layout-change")();
	events.get("window-open")({}, popup.window);
	assert.equal(popup.window.document.querySelector("style"), null);
	assert.equal(document.querySelector("style[data-nya-appearance]"), null);
	popup.window.close();
});

test("appearance sections fold independently without saving, retain state on navigation and keep the preview visible", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	await p.flushSettings();
	const writes = p.writes.length,
		before = JSON.stringify(p.settings);
	const sections = [...root.querySelectorAll("[data-section]")];
	assert.equal(sections.length, 4);
	for (const section of sections) {
		const toggle = section.querySelector(".nya-settings-section-toggle"),
			body = section.querySelector(".nya-settings-section-body");
		assert.equal(toggle.getAttribute("aria-expanded"), "false");
		assert.equal(body.hidden, true);
		assert.equal(toggle.getAttribute("aria-controls"), body.id);
		const reset = section.querySelector(".nya-settings-section-reset");
		assert.equal(reset.parentElement, section.querySelector(".nya-settings-section-header"));
		assert.equal(reset.dataset.icon, "undo-2");
		assert.equal(reset.textContent, "");
		assert.equal(reset.dataset.tooltip, "settings.Toolbar.reset");
		assert.equal(reset.getAttribute("aria-label"), "settings.Toolbar.reset");
		assert.equal(
			toggle.contains(reset),
			false,
			"restore is a separate button, not nested in disclosure",
		);
	}
	sections[0].querySelector(".nya-settings-section-toggle").click();
	sections[1].querySelector(".nya-settings-section-toggle").click();
	assert.deepEqual(
		sections.map((section) => section.querySelector(".nya-settings-section-body").hidden),
		[false, false, true, true],
	);
	assert.equal(root.querySelector(".nya-appearance-preview").closest("[hidden]"), null);
	root.querySelector("#nya-settings-tab-find").click();
	root.querySelector("#nya-settings-tab-toolbar").click();
	assert.deepEqual(
		[...root.querySelectorAll(".nya-settings-section-body")].map((body) => body.hidden),
		[false, false, true, true],
	);
	tab.display();
	assert.equal(
		root.querySelector('[data-section="colors"] .nya-settings-section-body').hidden,
		false,
	);
	await p.flushSettings();
	assert.equal(p.writes.length, writes);
	assert.equal(JSON.stringify(p.settings), before);
	tab.hide();
	tab.display();
	assert.ok(
		[...root.querySelectorAll(".nya-settings-section-body")].every((body) => body.hidden),
		"new settings visit starts folded",
	);
	p.onunload();
});

test("folding a section discards color drafts and cancels toolbar drag without changing applied settings", async () => {
	const p = plugin({ appearanceColors: { matchText: "#123456" } });
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl,
		frames = new Map();
	let next = 0;
	root.querySelectorAll(".nya-settings-section-toggle").forEach((toggle) => toggle.click());
	vi.spyOn(dom.window, "requestAnimationFrame").mockImplementation((fn) => {
		frames.set(++next, fn);
		return next;
	});
	vi.spyOn(dom.window, "cancelAnimationFrame").mockImplementation((id) => frames.delete(id));
	await p.flushSettings();
	const writes = p.writes.length,
		before = JSON.stringify(p.settings);
	root.querySelector('[data-color="matchText"] .nya-color-picker').click();
	const input = document.querySelector(".nya-color-popover input");
	input.value = "#abcdef80";
	input.dispatchEvent(new dom.window.Event("input"));
	root.querySelector('[data-section="colors"] .nya-settings-section-toggle').click();
	assert.equal(frames.size, 0);
	assert.equal(document.querySelector(".nya-color-popover"), null);
	assert.equal(
		root.querySelector(".nya-appearance-preview").style.getPropertyValue("--nya-match-color"),
		"",
	);
	const rows = [
		...root.querySelector('[data-section="search"]').querySelectorAll(".nya-toolbar-row"),
	];
	rows.forEach((row, index) => {
		row.getBoundingClientRect = () => ({ top: index * 40, height: 40 });
	});
	pointer(rows[0].querySelector('[data-control="handle"]'), "pointerdown", 10);
	pointer(document, "pointermove", 180);
	assert.ok(root.querySelector(".nya-toolbar-dragging"));
	root.querySelector('[data-section="search"] .nya-settings-section-toggle').click();
	pointer(document, "pointerup", 180);
	assert.equal(root.querySelector(".nya-toolbar-dragging"), null);
	assert.equal(root.querySelector(".nya-drop-before, .nya-drop-after"), null);
	const toggle = root.querySelector('[data-section="replace"] .nya-settings-section-toggle');
	root.querySelector('[data-action="replace"] [data-control="placement"]').focus();
	toggle.click();
	assert.equal(document.activeElement, toggle, "focus cannot remain in folded content");
	await p.flushSettings();
	assert.equal(JSON.stringify(p.settings), before);
	assert.equal(p.writes.length, writes);
	p.onunload();
});

test("settings containers and preview retain accessible names without Obsidian hover labels", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	for (const node of [
		root.querySelector('[role="tablist"]'),
		root.querySelector(".nya-appearance-controls"),
		root.querySelector(".nya-finder-preview"),
	]) {
		assert.equal(node.hasAttribute("aria-label"), false);
		const label = document.getElementById(node.getAttribute("aria-labelledby"));
		assert.ok(label?.textContent, "container has a valid named reference");
	}
	assert.equal(
		root.querySelector(".nya-toolbar-preview [aria-label]"),
		null,
		"presentation-only preview does not create hover labels",
	);
	for (const node of root.querySelectorAll("[aria-label]")) {
		assert.ok(
			node.matches('button, select, input, [role="button"], [role="switch"]'),
			"only real controls keep hover labels",
		);
	}
	assert.ok(
		root
			.querySelector('[data-action="regex"] [data-control="placement"]')
			.getAttribute("aria-label"),
	);
	assert.ok(
		root
			.querySelector('[data-action="regex"] [data-control="handle"]')
			.getAttribute("aria-label"),
	);
	p.onunload();
});

test("direct reset rejects old controls after switch, redraw, hide and unload", async () => {
	const p = plugin({ defaultRegexMode: true, appearanceColors: { matchText: "#123456" } });
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	await p.flushSettings();
	const writes = p.writes.length,
		before = JSON.stringify(p.settings);
	const noticeCount = notices.length;
	for (const reason of ["switch", "redraw", "hide", "unload"]) {
		const trigger = tab.containerEl.querySelector(
			'[data-section="search"] .nya-settings-section-reset',
		);
		if (reason === "switch") tab.containerEl.querySelector("#nya-settings-tab-find").click();
		if (reason === "redraw") tab.display();
		if (reason === "hide") tab.hide();
		if (reason === "unload") p.onunload();
		trigger.click();
		assert.equal(JSON.stringify(p.settings), before);
		await p.flushSettings();
		assert.equal(p.writes.length, writes);
		assert.equal(notices.length, noticeCount, "ignored stale reset does not claim success");
		if (reason !== "unload") {
			tab.display();
			tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
		}
	}
});

test("reset from a folded section applies directly without unfolding and color single reset is scoped", async () => {
	const p = plugin({ appearanceColors: { matchText: "#123456", accentStrip: "#abcdef" } });
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl,
		section = root.querySelector('[data-section="colors"]');
	section.querySelector(".nya-settings-section-toggle").click();
	const single = section.querySelector('[data-color="matchText"] .nya-color-reset');
	await p.flushSettings();
	let writes = p.writes.length;
	assert.equal(single.dataset.icon, "undo-2");
	assert.equal(single.dataset.tooltip, "settings.Toolbar.reset");
	single.click();
	await p.flushSettings();
	assert.deepEqual(p.settings.appearanceColors, { accentStrip: "#abcdef" });
	assert.equal(p.writes.length, ++writes);
	section.querySelector(".nya-settings-section-toggle").click();
	section.querySelector(".nya-settings-section-reset").click();
	assert.equal(
		section.querySelector(".nya-settings-section-body").hidden,
		true,
		"restore does not toggle disclosure",
	);
	assert.deepEqual(p.settings.appearanceColors, {}, "click applies without a confirmation modal");
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1);
	assert.deepEqual(p.settings.appearanceColors, {});
	assert.equal(section.querySelector(".nya-settings-section-body").hidden, true);
	p.onunload();
});

test("all section and single color restores give one uniform notice without waiting for persistence", async () => {
	const p = plugin({ appearanceColors: { matchText: "#123456" }, defaultRegexMode: true });
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	await p.flushSettings();
	let release;
	p.saveData = (snapshot) =>
		new Promise((resolve) => {
			p.writes.push(snapshot);
			release = resolve;
		});
	const restore = async (button) => {
		const count = notices.length,
			writes = p.writes.length;
		button.click();
		assert.deepEqual(
			notices.slice(count),
			["settings.Toolbar.resetDone"],
			"one immediate notice per restore",
		);
		await settle();
		assert.equal(typeof release, "function");
		assert.equal(p.writes.length, writes + 1, "only the original restore snapshot is queued");
		release();
		release = undefined;
		await p.flushSettings();
	};
	root.querySelector('[data-section="colors"] .nya-settings-section-toggle').click();
	await restore(root.querySelector('[data-color="matchText"] .nya-color-reset'));
	assert.deepEqual(p.settings.appearanceColors, {});
	for (const kind of ["colors", "search", "replace"]) {
		const section = root.querySelector(`[data-section="${kind}"]`),
			body = section.querySelector(".nya-settings-section-body");
		const hidden = body.hidden;
		await restore(section.querySelector(".nya-settings-section-reset"));
		assert.equal(body.hidden, hidden, "notice and restore do not change folding");
	}
	assert.equal(p.settings.defaultRegexMode, false);
	p.onunload();
});

test("restore notice does not hide or replace a subsequent save failure", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const p = plugin({ defaultRegexMode: true });
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	await p.flushSettings();
	p.saveData = async () => {
		throw new Error("disk failed");
	};
	const count = notices.length;
	resetSection(tab.containerEl.querySelector('[data-section="search"]'));
	assert.equal(p.settings.defaultRegexMode, false);
	assert.deepEqual(notices.slice(count), ["settings.Toolbar.resetDone"]);
	await assert.rejects(p.flushSettings(), /disk failed/);
	assert.deepEqual(notices.slice(count), ["settings.Toolbar.resetDone", "history.SaveFailed"]);
	p.onunload();
});

test("mouse/touch pointer drag previews insertion, saves once on drop and cancels safely", async () => {
	const p = plugin(null);
	await p.onload();
	const tab = tabs.at(-1);
	tab.display();
	tab.containerEl.querySelector("#nya-settings-tab-toolbar").click();
	const root = tab.containerEl;
	const rows = () => [
		...root.querySelector(".nya-toolbar-settings").querySelectorAll(".nya-toolbar-row"),
	];
	const mockRects = () =>
		rows().forEach((row, index) => {
			row.getBoundingClientRect = () => ({ top: index * 40, height: 40 });
		});
	mockRects();
	const writes = p.writes.length;
	pointer(rows()[0].querySelector("button"), "pointerdown", 10);
	pointer(root.ownerDocument, "pointermove", 100);
	assert.ok(root.querySelector(".nya-drop-before"));
	assert.equal(p.settings.searchToolbar[0].id, "regex");
	assert.equal(p.writes.length, writes);
	pointer(root.ownerDocument, "pointerup", 100);
	assert.deepEqual(
		p.settings.searchToolbar.slice(0, 3).map((i) => i.id),
		["case", "wholeWord", "regex"],
	);
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1);
	for (const cancel of ["escape", "pointercancel", "hide", "switch"]) {
		mockRects();
		const before = JSON.stringify(p.settings.searchToolbar);
		pointer(rows()[0].querySelector("button"), "pointerdown", 10);
		pointer(root.ownerDocument, "pointermove", 180);
		if (cancel === "escape")
			root.ownerDocument.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", { key: "Escape" }),
			);
		else if (cancel === "hide") tab.hide();
		else if (cancel === "switch") root.querySelector("#nya-settings-tab-find").click();
		else pointer(root.ownerDocument, "pointercancel", 180);
		pointer(root.ownerDocument, "pointerup", 180);
		assert.equal(JSON.stringify(p.settings.searchToolbar), before);
		assert.equal(root.querySelector(".nya-toolbar-dragging"), null);
		if (cancel === "switch") root.querySelector("#nya-settings-tab-toolbar").click();
	}
	await p.flushSettings();
	assert.equal(p.writes.length, writes + 1);
});
