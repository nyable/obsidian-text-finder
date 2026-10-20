import { expect, it, vi } from "vitest";
import { SettingsController } from "../../src/features/settings/application/settings-controller";
import { defaultSettings } from "../../src/features/settings";

function environment() {
	const settings = defaultSettings(),
		calls: string[] = [];
	const effects = {
		save: vi.fn(() => {
			calls.push("save");
		}),
		historyChanged: vi.fn(() => {
			calls.push("history");
		}),
		resizeHistory: vi.fn(),
		replacementPreferencesChanged: vi.fn(),
		refreshToolbars: vi.fn(() => {
			calls.push("toolbar");
		}),
		syncFloatingEntries: vi.fn(() => {
			calls.push("entries");
		}),
		refreshAppearance: vi.fn(() => {
			calls.push("appearance");
		}),
	};
	return {
		settings,
		calls,
		effects,
		controller: new SettingsController(() => settings, effects),
	};
}
it("applies toggles synchronously with original notification and save ordering", () => {
	const h = environment();
	h.controller.toggle("enableHistory", false);
	expect(h.settings.enableHistory).toBe(false);
	expect(h.calls).toEqual(["history", "toolbar", "save"]);
	h.calls.length = 0;
	h.controller.toggle("showFloatingFinderOnOpen", true);
	expect(h.calls).toEqual(["entries", "save"]);
	h.calls.length = 0;
	h.controller.toggle("showFloatingFinderOnOpen", false);
	expect(h.calls).toEqual(["save"]);
});
it("invalidates replacement intents on every real escape preference change, including ABA", () => {
	const h = environment();
	h.controller.toggle("useEscapeCharInReplace", false);
	h.controller.toggle("useEscapeCharInReplace", true);
	h.controller.toggle("useEscapeCharInReplace", true);
	expect(h.effects.replacementPreferencesChanged).toHaveBeenCalledTimes(2);
});
it("restores only the requested appearance group and saves once", () => {
	const h = environment();
	h.settings.appearanceColors = {
		focusBorder: "#123456",
		scopeBackground: "#abcdef",
		scopeBorder: "#ffffff",
	};
	h.settings.scopeAppearance = { border: true, width: 3 };
	h.controller.resetColors();
	expect(h.settings.appearanceColors).toEqual({
		scopeBackground: "#abcdef",
		scopeBorder: "#ffffff",
	});
	expect(h.settings.scopeAppearance).toEqual({ border: true, width: 3 });
	expect(h.calls).toEqual(["appearance", "save"]);
	h.calls.length = 0;
	h.controller.resetScope();
	expect(h.settings.appearanceColors).toEqual({});
	expect(h.settings.scopeAppearance).toEqual({ border: false, width: 1 });
	expect(h.calls).toEqual(["appearance", "save"]);
});
it("keeps independent scope colors and disabled border preferences", () => {
	const h = environment();
	h.controller.color("scopeBorder", "#abcdef");
	h.controller.scopeWidth(3);
	h.controller.scopeBorder(false);
	expect(h.settings.appearanceColors.scopeBorder).toBe("#abcdef");
	expect(h.settings.scopeAppearance).toEqual({ border: false, width: 3 });
	h.controller.color("scopeBorder", null);
	expect(h.settings.appearanceColors).not.toHaveProperty("scopeBorder");
});
it("restores search defaults without resetting replacement or session settings", () => {
	const h = environment();
	h.settings.defaultRegexMode = true;
	h.settings.defaultWholeWord = true;
	h.settings.replaceToolbar.reverse();
	h.settings.clearAfterHidden = true;
	const replacement = h.settings.replaceToolbar;
	h.controller.resetToolbar("search");
	expect(h.settings.defaultRegexMode).toBe(false);
	expect(h.settings.defaultWholeWord).toBe(false);
	expect(h.settings.replaceToolbar).toBe(replacement);
	expect(h.settings.clearAfterHidden).toBe(true);
	expect(h.calls).toEqual(["toolbar", "save"]);
	expect(h.controller.toolbar("search", h.settings.searchToolbar)).toBe(false);
	expect(h.effects.save).toHaveBeenCalledOnce();
});
it("routes history capacity to history without duplicating its save", () => {
	const h = environment();
	h.controller.resizeHistory(10);
	expect(h.effects.resizeHistory).toHaveBeenCalledExactlyOnceWith(10);
	expect(h.effects.save).not.toHaveBeenCalled();
	h.controller.historyOrder("count");
	expect(h.settings.historySortOrder).toBe("count");
	expect(h.calls).toEqual(["history", "save"]);
});

it("accepts readonly toolbar values without lending their mutable identity to storage", () => {
	const h = environment();
	const items = [{ id: "regex", placement: "hidden" }] as const;
	expect(h.controller.toolbar("search", items)).toBe(true);
	expect(h.settings.searchToolbar).toEqual(items);
	expect(h.settings.searchToolbar).not.toBe(items);
	expect(h.settings.searchToolbar[0]).not.toBe(items[0]);
});
