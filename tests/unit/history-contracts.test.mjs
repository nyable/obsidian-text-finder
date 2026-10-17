import assert from "node:assert/strict";
import { test } from "vitest";
import * as h from "../../src/features/history";
import * as s from "../../src/features/settings/model/settings";

const item = (text, count = 1, createdAt = 10, lastUsedAt = 20) => ({
	text,
	count,
	createdAt,
	lastUsedAt,
});

test("history navigation retains exact identity across reorder and selects the next surviving neighbour", () => {
	const nav = new h.HistoryNavigation();
	const rows = ["A", " B ", "C", "D"].map((text) => item(text));
	assert.equal(nav.move(1, "draft", rows), "A");
	assert.equal(nav.move(1, "A", rows), " B ");
	assert.equal(nav.reconcile([rows[3], rows[2], rows[1], rows[0]]), undefined);
	assert.equal(nav.move(-1, " B ", [rows[3], rows[2], rows[1], rows[0]]), "C");
	assert.equal(nav.reconcile([rows[3], rows[0]]), "A");
	assert.equal(nav.reconcile([rows[3]]), "D");
	assert.equal(nav.reconcile([]), "draft");
	assert.equal(nav.move(1, "draft", []), undefined);
});

test("history shrink never indexes a missing entry and reset starts with the new draft", () => {
	const nav = new h.HistoryNavigation();
	const rows = ["A", "B", "C"].map((text) => item(text));
	for (let i = 0; i < 3; i++) nav.move(1, "draft", rows);
	assert.equal(nav.move(-1, "C", rows.slice(0, 1)), "A");
	assert.equal(nav.move(-1, "A", rows.slice(0, 1)), "draft");
	nav.reset();
	assert.equal(nav.move(1, "typed", rows), "A");
	assert.equal(nav.move(-1, "A", rows), "typed");
});

test("retired native reading preference is removed without changing other settings or exact history", () => {
	assert.equal(Object.hasOwn(s.defaultSettings(), "useObsidianSearchInRead"), false);
	for (const value of [true, false, "true"]) {
		const expected = {
			...s.defaultSettings(),
			useSelectionAsSearch: false,
			finderAutoDock: true,
			searchHistory: [item(" cat\n\t ")],
		};
		const raw = { ...expected, useObsidianSearchInRead: value };
		const result = s.normalizeSettings(raw);
		assert.equal(result.changed, true);
		assert.equal(Object.hasOwn(result.settings, "useObsidianSearchInRead"), false);
		assert.deepEqual(result.settings, expected);
		assert.equal(s.normalizeSettings(result.settings).changed, false);
		assert.equal(raw.useObsidianSearchInRead, value, "migration does not mutate input");
	}
});
function controller(overrides = {}) {
	const settings = { ...s.defaultSettings(), ...overrides };
	let saves = 0;
	const history = new h.HistoryController(
		() => settings,
		() => {
			saves++;
			return Promise.resolve();
		},
	);
	return { settings, history, saves: () => saves };
}

test("exact queries retain whitespace and special keys; only empty text is skipped", () => {
	const c = controller();
	for (const text of ["cat", " cat ", "\n\t ", "__proto__", "constructor", ""])
		c.history.record(text);
	assert.deepEqual(
		c.settings.searchHistory.map((i) => i.text).sort(),
		["cat", " cat ", "\n\t ", "__proto__", "constructor"].sort(),
	);
	assert.equal(c.saves(), 5);
});

test("continuous usage can update time without incrementing; existing-only never resurrects", () => {
	const c = controller();
	c.history.record("A");
	c.history.record("A", false);
	assert.equal(c.settings.searchHistory[0].count, 1);
	c.history.record("A");
	assert.equal(c.settings.searchHistory[0].count, 2);
	c.history.remove(new Set(["A"]));
	assert.equal(c.history.record("A", true, true), false);
	assert.deepEqual(c.settings.searchHistory, []);
});

test("disabled history preserves entries and permits deletion but no recording or stats", () => {
	const c = controller({ enableHistory: false, searchHistory: [item("A")] });
	assert.equal(c.history.record("A"), false);
	assert.equal(c.history.record("B"), false);
	assert.equal(c.saves(), 0);
	c.history.remove(new Set(["A"]));
	assert.equal(c.saves(), 1);
});

for (const [order, expected] of [
	["count", ["C", "B"]],
	["createdAt", ["B", "A"]],
	["lastUsedAt", ["A", "C"]],
]) {
	test(`shrinking history applies ${order} priority in one save`, () => {
		const c = controller({
			historySortOrder: order,
			historyRetention: order,
			searchHistory: [item("A", 1, 20, 30), item("B", 2, 30, 10), item("C", 3, 10, 20)],
		});
		c.history.resize(2);
		assert.deepEqual(
			c.settings.searchHistory.map((i) => i.text),
			expected,
		);
		assert.equal(c.settings.historyMaxCount, 2);
		assert.equal(c.saves(), 1);
		c.history.resize(2);
		assert.equal(c.saves(), 1);
	});
}

test("adding or updating also repairs over-capacity history", () => {
	for (const text of ["new", "A"]) {
		const c = controller({
			historyMaxCount: 1,
			searchHistory: [item("A"), item("B"), item("C")],
		});
		c.history.record(text);
		assert.equal(c.settings.searchHistory.length, 1);
		assert.equal(c.settings.searchHistory[0].text, text);
	}
});

test("sorting is deterministic and does not mutate its input", () => {
	const items = [item("B"), item("A"), item(" A ")];
	assert.deepEqual(
		h.sortHistory(items, "count").map((i) => i.text),
		[" A ", "A", "B"],
	);
	assert.deepEqual(
		items.map((i) => i.text),
		["B", "A", " A "],
	);
});

test("limit parser accepts only full integers in 1–200", () => {
	for (const [value, expected] of [
		["1", 1],
		["200", 200],
		["20", 20],
	])
		assert.equal(h.parseHistoryLimit(value), expected);
	for (const value of ["", "0", "201", "2abc", "2.1", " 2", "2 ", "-2", "1e2", "Infinity"])
		assert.equal(h.parseHistoryLimit(value), null);
});

test("migration normalizes every mixed entry and preserves valid fields", () => {
	const raw = [
		item("normal"),
		{ text: "missingLast", createdAt: 30, count: 7 },
		"old",
		{ text: "legacy", timestamp: 40 },
		null,
		{},
		12,
		{ text: 42 },
		{ text: "" },
		{ text: "invalid", count: -2, createdAt: Infinity, lastUsedAt: -1 },
		{ text: " \n", count: 1.5, createdAt: 0, lastUsedAt: 0 },
	];
	const result = h.normalizeHistory(raw, 100);
	assert.deepEqual(result, [
		item("normal"),
		item("missingLast", 7, 30, 30),
		item("old", 1, 100, 100),
		item("legacy", 1, 40, 40),
		item("invalid", 1, 100, 100),
		item(" \n", 1, 0, 0),
	]);
});

test("duplicate migration merges exact texts with min creation, max usage and max count", () => {
	const result = h.normalizeHistory(
		[item("A", 3, 10, 20), item("A", 5, 5, 30), item(" A ")],
		100,
	);
	assert.deepEqual(result, [item("A", 5, 5, 30), item(" A ")]);
});

for (const raw of [null, [], "bad", { searchHistory: null }, { searchHistory: "bad" }]) {
	test(`invalid settings/history structure is safe: ${JSON.stringify(raw)}`, () => {
		assert.deepEqual(s.normalizeSettings(raw, 100).settings.searchHistory, []);
	});
}

test("settings validates boolean, capacity and sort values without coercion", () => {
	const { settings } = s.normalizeSettings({
		enableHistory: "false",
		clearAfterHidden: true,
		historyMaxCount: "2",
		historySortOrder: "bad",
	});
	assert.equal(settings.enableHistory, true);
	assert.equal(settings.clearAfterHidden, true);
	assert.equal(settings.historyMaxCount, 10);
	assert.equal(settings.historySortOrder, "lastUsedAt");
});

test("normalization is idempotent, trims on load and uses independent default arrays", () => {
	const first = s.normalizeSettings({ historyMaxCount: 1, searchHistory: ["A", "B", "C"] }, 100);
	assert.equal(first.settings.searchHistory.length, 1);
	assert.equal(first.changed, true);
	const second = s.normalizeSettings(first.settings, 500);
	assert.deepEqual(second.settings, first.settings);
	assert.equal(second.changed, false);
	first.settings.searchHistory.push(item("X"));
	assert.deepEqual(s.defaultSettings().searchHistory, []);
});

test("subscriptions update synchronously and unsubscribe reliably", () => {
	const c = controller();
	let calls = 0;
	const unsubscribe = c.history.subscribe(() => {
		calls++;
	});
	c.history.record("A");
	assert.equal(calls, 2);
	unsubscribe();
	c.history.remove(new Set(["A"]));
	assert.equal(calls, 2);
});

test("count overflow is saturated rather than persisting an invalid integer", () => {
	const c = controller({ searchHistory: [item("A", Number.MAX_SAFE_INTEGER)] });
	c.history.record("A");
	assert.equal(c.settings.searchHistory[0].count, Number.MAX_SAFE_INTEGER);
});

test("injected clock updates usage without modifying original creation time", () => {
	const settings = s.defaultSettings();
	let now = 10;
	const history = new h.HistoryController(
		() => settings,
		async () => {},
		() => now,
	);
	history.record("A");
	now = 20;
	history.record("A", false);
	assert.deepEqual(settings.searchHistory, [item("A", 1, 10, 20)]);
});

test("property order alone is not a migration and 200-item capacity is supported", () => {
	const settings = s.defaultSettings();
	settings.historyMaxCount = 200;
	settings.searchHistory = Array.from({ length: 200 }, (_, i) => item(String(i), 1, i, i));
	const first = s.normalizeSettings(settings, 500);
	const reordered = Object.fromEntries(Object.entries(first.settings).reverse());
	reordered.searchHistory = first.settings.searchHistory.map((i) =>
		Object.fromEntries(Object.entries(i).reverse()),
	);
	assert.equal(s.normalizeSettings(reordered, 600).changed, false);
	assert.equal(first.settings.searchHistory.length, 200);
});
