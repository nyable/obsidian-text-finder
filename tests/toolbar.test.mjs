import assert from "node:assert/strict";
import test from "node:test";
import { toolbarSource, settingsSource } from "./history-source.mjs";
const { defaultToolbar, normalizeToolbar, moveToolbarItem } = toolbarSource;

test("default toolbar preserves legacy visible actions and hides optional history", () => {
	assert.deepEqual(defaultToolbar("search").filter((i) => i.placement === "inline").map((i) => i.id), ["regex", "case", "previous", "next"]);
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
	assert.deepEqual(result.map((i) => i.id), ["next", "case", "regex", "previous", "history"]);
	assert.deepEqual(normalizeToolbar(result, "search"), result);
	assert.deepEqual(normalizeToolbar(null, "replace"), defaultToolbar("replace"));
});

test("toolbar moves use insertion boundaries and do not mutate the original", () => {
	const items = defaultToolbar("search");
	assert.deepEqual(moveToolbarItem(items, 0, 3).map((i) => i.id), ["case", "previous", "regex", "next", "history"]);
	assert.deepEqual(moveToolbarItem(items, 3, 0).map((i) => i.id), ["next", "regex", "case", "previous", "history"]);
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
