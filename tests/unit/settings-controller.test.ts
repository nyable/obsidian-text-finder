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
		reportError: vi.fn(),
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

it.each([
	[
		"auto dock",
		"refreshToolbars",
		(h) => h.controller.toggle("finderAutoDock", true),
		(h) => expect(h.settings.finderAutoDock).toBe(true),
	],
	[
		"floating entry",
		"syncFloatingEntries",
		(h) => h.controller.toggle("showFloatingFinderOnOpen", true),
		(h) => expect(h.settings.showFloatingFinderOnOpen).toBe(true),
	],
	[
		"replacement escapes",
		"replacementPreferencesChanged",
		(h) => h.controller.toggle("useEscapeCharInReplace", false),
		(h) => expect(h.settings.useEscapeCharInReplace).toBe(false),
	],
	[
		"history order",
		"historyChanged",
		(h) => h.controller.historyOrder("count"),
		(h) => expect(h.settings.historySortOrder).toBe("count"),
	],
	[
		"history retention",
		"historyChanged",
		(h) => h.controller.historyRetention("count"),
		(h) => expect(h.settings.historyRetention).toBe("count"),
	],
	[
		"color",
		"refreshAppearance",
		(h) => h.controller.color("focusBorder", "#123456"),
		(h) => expect(h.settings.appearanceColors.focusBorder).toBe("#123456"),
	],
	[
		"scope border",
		"refreshAppearance",
		(h) => h.controller.scopeBorder(true),
		(h) => expect(h.settings.scopeAppearance.border).toBe(true),
	],
	[
		"scope width",
		"refreshAppearance",
		(h) => h.controller.scopeWidth(3),
		(h) => expect(h.settings.scopeAppearance.width).toBe(3),
	],
	[
		"toolbar",
		"refreshToolbars",
		(h) => h.controller.toolbar("search", [{ id: "regex", placement: "hidden" }]),
		(h) => expect(h.settings.searchToolbar).toEqual([{ id: "regex", placement: "hidden" }]),
	],
	[
		"reset toolbar",
		"refreshToolbars",
		(h) => {
			h.settings.defaultRegexMode = true;
			h.controller.resetToolbar("search");
		},
		(h) => expect(h.settings.defaultRegexMode).toBe(false),
	],
	[
		"reset colors",
		"refreshAppearance",
		(h) => {
			h.settings.appearanceColors.focusBorder = "#123456";
			h.controller.resetColors();
		},
		(h) => expect(h.settings.appearanceColors).toEqual({}),
	],
	[
		"reset scope",
		"refreshAppearance",
		(h) => {
			h.settings.scopeAppearance.border = true;
			h.controller.resetScope();
		},
		(h) => expect(h.settings.scopeAppearance.border).toBe(false),
	],
] satisfies [
	string,
	keyof ReturnType<typeof environment>["effects"],
	(h: ReturnType<typeof environment>) => unknown,
	(h: ReturnType<typeof environment>) => void,
][])("saves changed %s even when its notification throws", (_name, effect, change, check) => {
	const h = environment(),
		error = new Error("refresh failed");
	h.effects[effect].mockImplementationOnce(() => {
		throw error;
	});
	expect(() => change(h)).not.toThrow();
	check(h);
	expect(h.effects.reportError).toHaveBeenCalledExactlyOnceWith(error);
	expect(h.effects.save).toHaveBeenCalledOnce();
});

it("continues remaining notifications and saves after a history notification fails", () => {
	const h = environment(),
		error = new Error("history failed");
	h.effects.historyChanged.mockImplementationOnce(() => {
		throw error;
	});
	h.controller.toggle("enableHistory", false);
	expect(h.settings.enableHistory).toBe(false);
	expect(h.effects.reportError).toHaveBeenCalledExactlyOnceWith(error);
	expect(h.calls).toEqual(["toolbar", "save"]);
});

it("still requests saving when reporting the failed refresh also throws", () => {
	const h = environment(),
		error = new Error("reporting failed");
	h.effects.refreshAppearance.mockImplementationOnce(() => {
		throw new Error("refresh failed");
	});
	h.effects.reportError.mockImplementationOnce(() => {
		throw error;
	});
	expect(() => h.controller.scopeWidth(3)).toThrow(error);
	expect(h.settings.scopeAppearance.width).toBe(3);
	expect(h.effects.save).toHaveBeenCalledOnce();
});
