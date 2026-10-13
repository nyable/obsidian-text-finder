import assert from "node:assert/strict";
import test from "node:test";
import { toolbarSource, settingsSource } from "./history-source.mjs";
const { defaultToolbar, normalizeToolbar, moveToolbarItem } = toolbarSource;

test("search defaults preserve old behavior, validate booleans and reload enabled preferences unchanged", () => {
	const old = settingsSource.normalizeSettings({ enableHistory: true }).settings;
	assert.equal(old.defaultRegexMode, false); assert.equal(old.defaultCaseSensitive, false);
	assert.equal(old.defaultWholeWord, false);
	const invalid = settingsSource.normalizeSettings({ defaultRegexMode: "true", defaultCaseSensitive: 1, defaultWholeWord: "true" }).settings;
	assert.equal(invalid.defaultRegexMode, false); assert.equal(invalid.defaultCaseSensitive, false);
	assert.equal(invalid.defaultWholeWord, false);
	const enabled = settingsSource.normalizeSettings({ defaultRegexMode: true, defaultCaseSensitive: true, defaultWholeWord: true }).settings;
	assert.equal(enabled.defaultRegexMode, true); assert.equal(enabled.defaultCaseSensitive, true);
	assert.equal(enabled.defaultWholeWord, true);
	assert.equal(settingsSource.normalizeSettings(enabled).changed, false);
	assert.deepEqual(settingsSource.normalizeSettings(enabled).settings, enabled);
});

test("default toolbar preserves legacy visible actions and hides optional history", () => {
	assert.deepEqual(defaultToolbar("search").filter((i) => i.placement === "inline").map((i) => i.id), ["regex", "case", "wholeWord", "previous", "next"]);
	assert.deepEqual(defaultToolbar("replace").map((i) => i.id), ["replace", "replaceAll"]);
	assert.equal(defaultToolbar("search").at(-1).placement, "hidden");
	const a = settingsSource.defaultSettings(), b = settingsSource.defaultSettings();
	a.searchToolbar[0].placement = "more";
	assert.equal(b.searchToolbar[0].placement, "inline");
});

test("toolbar normalization validates placements, removes duplicate/foreign actions and preserves order", () => {
	const raw = [{ id: "next", placement: "more" }, { id: "next", placement: "hidden" }, null,
		{ id: "replace", placement: "inline" }, { id: "case", placement: "invalid" }, { id: "unknown", placement: "more" }];
	const result = normalizeToolbar(raw, "search");
	assert.deepEqual(result.slice(0, 2), [{ id: "next", placement: "more" }, { id: "case", placement: "inline" }]);
	assert.deepEqual(result.map((i) => i.id), ["next", "case", "regex", "wholeWord", "previous", "history"]);
	assert.deepEqual(normalizeToolbar(result, "search"), result);
	assert.deepEqual(normalizeToolbar(null, "replace"), defaultToolbar("replace"));
});

test("toolbar moves use insertion boundaries and do not mutate the original", () => {
	const items = defaultToolbar("search");
	assert.deepEqual(moveToolbarItem(items, 0, 3).map((i) => i.id), ["case", "wholeWord", "regex", "previous", "next", "history"]);
	assert.deepEqual(moveToolbarItem(items, 4, 0).map((i) => i.id), ["next", "regex", "case", "wholeWord", "previous", "history"]);
	assert.equal(moveToolbarItem(items, 0, 1), items);
	assert.equal(moveToolbarItem(items, -1, 0), items);
	assert.equal(items[0].id, "regex");
});

test("existing settings migrate to unchanged toolbar defaults; customized settings reload unchanged", () => {
	const { settings, changed } = settingsSource.normalizeSettings({ enableHistory: false });
	assert.equal(changed, true);
	assert.deepEqual(settings.searchToolbar, defaultToolbar("search"));
	settings.searchToolbar = moveToolbarItem(settings.searchToolbar, 0, 5);
	settings.replaceToolbar[0].placement = "more";
	const reloaded = settingsSource.normalizeSettings(settings);
	assert.equal(reloaded.changed, false);
	assert.deepEqual(reloaded.settings, settings);
});

test("old toolbar settings append whole word without changing existing order or placements", () => {
	const searchToolbar = [{ id: "next", placement: "more" }, { id: "case", placement: "hidden" },
		{ id: "regex", placement: "inline" }, { id: "history", placement: "hidden" }, { id: "previous", placement: "more" }];
	const { settings } = settingsSource.normalizeSettings({ searchToolbar });
	assert.deepEqual(settings.searchToolbar, [...searchToolbar, { id: "wholeWord", placement: "inline" }]);
	assert.equal(settings.defaultWholeWord, false);
	assert.equal(settingsSource.normalizeSettings(settings).changed, false);
});
