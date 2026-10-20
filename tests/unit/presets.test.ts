import { describe, expect, it } from "vitest";
import {
	PresetController,
	normalizePresets,
	type SearchPreset,
	type SearchRecipe,
} from "../../src/features/presets";
import { defaultSettings, normalizeSettings } from "../../src/features/settings/model/settings";
import { HistoryController } from "../../src/features/history";

const recipe: SearchRecipe = {
	search: " \t ",
	options: { regexMode: true, caseSensitive: false, wholeWord: false },
	replacement: { text: "", interpretEscapes: false },
};

describe("portable presets", () => {
	it("removes an initially failing subscription instead of leaking a failed mount", () => {
		const settings = defaultSettings();
		let calls = 0;
		const broken = () => {
			calls++;
			throw new Error("mount failed");
		};
		const history = new HistoryController(
			() => settings,
			async () => {},
		);
		const presets = new PresetController(
			() => settings,
			async () => {},
			() => "id",
		);
		expect(() => history.subscribe(broken)).toThrow("mount failed");
		expect(() => presets.subscribe(broken)).toThrow("mount failed");
		history.notify();
		presets.notify();
		expect(calls).toBe(2);
	});
	it("rejects concurrent stale edits even with identical timestamps, but permits reordering", () => {
		const settings = { searchPresets: [] as SearchPreset[] };
		let saves = 0,
			id = 0;
		const controller = new PresetController(
			() => settings,
			async () => {
				saves++;
			},
			() => String(++id),
			() => 10,
		);
		controller.put("one", recipe);
		controller.put("two", recipe);
		const first = controller.list()[0]!;
		controller.move(first.id, null);
		expect(controller.put("renamed", { ...recipe, search: "new" }, first.id, first)).toBe(true);
		const before = saves;
		expect(controller.put("stale name", recipe, first.id, first)).toBe(false);
		expect(saves).toBe(before);
		expect(controller.list().find((item) => item.id === first.id)?.search).toBe("new");
	});
	it("isolates failed preset subscribers without skipping saving or other views", () => {
		const settings = { searchPresets: [] as SearchPreset[] };
		let fail = false,
			notified = 0,
			saved = 0;
		const errors: unknown[] = [];
		const controller = new PresetController(
			() => settings,
			async () => {
				saved++;
			},
			() => "one",
			() => 10,
			(error) => errors.push(error),
		);
		controller.subscribe(() => {
			if (fail) throw new Error("view failed");
		});
		controller.subscribe(() => {
			notified++;
		});
		fail = true;
		expect(controller.put("one", recipe)).toBe(true);
		expect(notified).toBe(2);
		expect(saved).toBe(1);
		expect(errors).toHaveLength(1);
	});
	it("isolates failed history subscribers without skipping persistence", () => {
		const settings = defaultSettings();
		let fail = false,
			notified = 0,
			saved = 0;
		const errors: unknown[] = [];
		const controller = new HistoryController(
			() => settings,
			async () => {
				saved++;
			},
			() => 10,
			(error) => errors.push(error),
		);
		controller.subscribe(() => {
			if (fail) throw new Error("view failed");
		});
		controller.subscribe(() => {
			notified++;
		});
		fail = true;
		expect(controller.record("cat")).toBe(true);
		expect(notified).toBe(2);
		expect(saved).toBe(1);
		expect(errors).toHaveLength(1);
	});
	it("enforces trimmed case-sensitive names for creation, renaming and undo without saving rejected changes", () => {
		const settings = { searchPresets: [] as SearchPreset[] };
		let ids = 0,
			saves = 0;
		const controller = new PresetController(
			() => settings,
			async () => {
				saves++;
			},
			() => `${++ids}`,
		);
		expect(controller.put(" Rule ", recipe)).toBe(true);
		expect(controller.put("Rule", recipe)).toBe(false);
		expect(controller.put(" Rule ", recipe)).toBe(false);
		expect(controller.put("rule", recipe)).toBe(true);
		expect(controller.put("Rule", recipe, "1")).toBe(true);
		expect(controller.put(" Rule ", recipe, "2")).toBe(false);
		expect(ids).toBe(2);
		expect(saves).toBe(3);
		const snapshot = controller.list()[0]!;
		controller.remove(snapshot.id);
		expect(controller.put("Rule", { ...recipe, search: "newer" })).toBe(true);
		const before = saves;
		expect(controller.restore(snapshot)).toBe(false);
		expect(saves).toBe(before);
		expect(controller.list().find((item) => item.name === "Rule")?.search).toBe("newer");
		controller.put("Renamed", recipe, "3");
		expect(controller.restore(snapshot)).toBe(true);
		expect(controller.restore(snapshot)).toBe(false);
	});
	it("retains legacy duplicate names losslessly but requires unique names on subsequent saves", () => {
		const old = ["one", "two"].map((id, order) => ({
			...recipe,
			id,
			name: "Same",
			search: id,
			order,
			createdAt: 0,
			updatedAt: 0,
		}));
		const settings = { searchPresets: normalizePresets(old, 10) };
		expect(settings.searchPresets.map((item) => item.search)).toEqual(["one", "two"]);
		const controller = new PresetController(
			() => settings,
			async () => {},
			() => "three",
		);
		expect(controller.put("Same", recipe, "one")).toBe(false);
		expect(controller.put("Different", recipe, "one")).toBe(true);
		expect(controller.put("Same", recipe, "two")).toBe(true);
	});
	it("keeps empty replacements distinct from find-only and exact whitespace intact", () => {
		const settings = { searchPresets: [] as SearchPreset[] };
		let id = 0;
		const controller = new PresetController(
			() => settings,
			async () => {},
			() => `id-${++id}`,
			() => 10,
		);
		expect(controller.put(" cleanup ", recipe)).toBe(true);
		expect(controller.put("find", { ...recipe, replacement: null })).toBe(true);
		expect(settings.searchPresets[0]?.replacement?.text).toBe("");
		expect(settings.searchPresets[1]?.replacement).toBeNull();
		expect(settings.searchPresets[0]?.search).toBe(recipe.search);
		const listed = controller.list();
		listed[0]!.options.regexMode = false;
		expect(settings.searchPresets[0]?.options.regexMode).toBe(true);
		expect(normalizePresets(settings.searchPresets, 100)).toEqual(settings.searchPresets);
	});
	it("updates by stable ID and refuses a stale update after deletion", () => {
		const settings = { searchPresets: [] as SearchPreset[] };
		const controller = new PresetController(
			() => settings,
			async () => {},
			() => "id",
			() => 10,
		);
		controller.put("one", recipe);
		expect(controller.put("renamed", recipe, "id")).toBe(true);
		controller.remove("id");
		expect(controller.put("stale", recipe, "id")).toBe(false);
		expect(settings.searchPresets).toEqual([]);
	});
	it("drops malformed and duplicate IDs without trimming rules or throwing", () => {
		const valid = { ...recipe, id: "x", name: "n", createdAt: 0, updatedAt: 0 };
		expect(
			normalizePresets([null, {}, valid, valid, { ...valid, id: "y", replacement: {} }], 5),
		).toEqual([{ ...valid, collapse: false, order: 0 }]);
	});
	it("keeps persistence failures non-blocking and presets independent of disabled history", async () => {
		const settings = defaultSettings();
		settings.enableHistory = false;
		let attempts = 0;
		const controller = new PresetController(
			() => settings,
			async () => {
				attempts++;
				throw new Error("write failed");
			},
			() => "p",
		);
		expect(controller.put("rule", recipe)).toBe(true);
		await Promise.resolve();
		expect(attempts).toBe(1);
		expect(controller.list()).toHaveLength(1);
	});
	it("does not serialize unknown option fields or document coordinates", () => {
		const input = {
			...recipe,
			id: "x",
			name: "rule",
			createdAt: 0,
			updatedAt: 0,
			file: "private.md",
			options: { ...recipe.options, from: 99 },
			replacement: { ...recipe.replacement, text: "", interpretEscapes: false, to: 100 },
		};
		const normalized = normalizePresets([input], 1)[0]!;
		expect(Object.keys(normalized)).not.toContain("file");
		expect(Object.keys(normalized.options)).not.toContain("from");
		expect(Object.keys(normalized.replacement!)).not.toContain("to");
	});
	it("migrates every legacy retention preference once, independently of future sorting", () => {
		for (const order of ["count", "lastUsedAt", "createdAt"] as const) {
			const result = normalizeSettings({ historySortOrder: order });
			expect(result.settings.historyRetention).toBe(order);
			result.settings.historySortOrder = "lastUsedAt";
			expect(normalizeSettings(result.settings).settings.historyRetention).toBe(order);
			expect(normalizeSettings(result.settings).changed).toBe(false);
		}
	});
	it("preserves old frequent entries when viewing and evicting use different priorities", () => {
		const settings = defaultSettings();
		settings.historyMaxCount = 2;
		settings.historyRetention = "count";
		settings.historySortOrder = "lastUsedAt";
		settings.searchHistory = [
			{ text: "frequent", count: 50, createdAt: 1, lastUsedAt: 1 },
			{ text: "recent", count: 1, createdAt: 2, lastUsedAt: 2 },
		];
		const history = new HistoryController(
			() => settings,
			async () => {},
			() => 100,
		);
		history.record("new");
		expect(history.sorted().map((item) => item.text)).toEqual(["new", "frequent"]);
		settings.searchPresets = [
			{ ...recipe, id: "p", name: "preset", createdAt: 1, updatedAt: 1 },
		];
		history.remove(new Set(["new", "frequent"]));
		expect(settings.searchPresets).toHaveLength(1);
	});
	it("undo merges with newer usage without rolling back statistics", () => {
		const settings = defaultSettings();
		const history = new HistoryController(
			() => settings,
			async () => {},
			() => 100,
		);
		history.record(" A ");
		const snapshot = history.sorted();
		history.remove(new Set([" A "]));
		history.record(" A ");
		history.record(" A ");
		history.restore(snapshot);
		expect(history.sorted()[0]?.count).toBe(2);
	});
	it("migrates alphabetical visible order, persists manual ranks, and restores deleted positions", () => {
		const normalized = normalizePresets(
			["Z", "A", "M"].map((name) => ({
				...recipe,
				id: name,
				name,
				createdAt: 0,
				updatedAt: 0,
			})),
			1,
		);
		expect(normalized.map((item) => item.name)).toEqual(["A", "M", "Z"]);
		const settings = { searchPresets: normalized };
		const controller = new PresetController(
			() => settings,
			async () => {},
			() => "new",
		);
		expect(controller.move("Z", "A")).toBe(true);
		expect(normalizePresets(settings.searchPresets, 1).map((item) => item.id)).toEqual([
			"Z",
			"A",
			"M",
		]);
		controller.put("Rename", recipe, "Z");
		expect(controller.list()[0]?.id).toBe("Z");
		const deleted = controller.list()[1]!;
		controller.remove(deleted.id);
		controller.restore(deleted);
		expect(controller.list().map((item) => item.id)).toEqual(["Z", "A", "M"]);
		expect(controller.move("missing", "A")).toBe(false);
		expect(controller.move("Z", "missing")).toBe(false);
		expect(controller.move("Z", "A")).toBe(false);
	});
});
