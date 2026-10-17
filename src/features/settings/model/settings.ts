import {
	HistorySortOrder,
	type HistorySortOrderType,
	normalizeHistory,
	trimHistory,
	type SearchHistoryItem,
} from "../../history";
import { defaultToolbar, normalizeToolbar, type ToolbarItem } from "../../finder";
import { normalizePresets, type SearchPreset } from "../../presets";
import {
	normalizeAppearanceColors,
	defaultScopeAppearance,
	normalizeScopeAppearance,
	type ScopeAppearance,
	type AppearanceColors,
} from "./appearance";

export interface PluginSettings {
	clearAfterHidden: boolean;
	enableInputHotkeys: boolean;
	sourceModeWhenSearch: boolean;
	moveCursorToMatch: boolean;
	useSelectionAsSearch: boolean;
	useEscapeCharInReplace: boolean;
	enableHistory: boolean;
	historyMaxCount: number;
	historySortOrder: HistorySortOrderType;
	historyRetention: HistorySortOrderType;
	searchHistory: SearchHistoryItem[];
	searchPresets: SearchPreset[];
	searchToolbar: ToolbarItem[];
	replaceToolbar: ToolbarItem[];
	defaultRegexMode: boolean;
	defaultCaseSensitive: boolean;
	defaultWholeWord: boolean;
	finderDockSide: "left" | "right";
	finderAutoDock: boolean;
	showFloatingFinderOnOpen: boolean;
	appearanceColors: AppearanceColors;
	scopeAppearance: ScopeAppearance;
}

export function defaultSettings(): PluginSettings {
	return {
		clearAfterHidden: false,
		enableInputHotkeys: true,
		sourceModeWhenSearch: true,
		moveCursorToMatch: true,
		useSelectionAsSearch: true,
		useEscapeCharInReplace: true,
		enableHistory: true,
		historyMaxCount: 10,
		historySortOrder: HistorySortOrder.LAST_USED_AT,
		historyRetention: HistorySortOrder.LAST_USED_AT,
		searchHistory: [],
		searchPresets: [],
		searchToolbar: defaultToolbar("search"),
		replaceToolbar: defaultToolbar("replace"),
		defaultRegexMode: false,
		defaultCaseSensitive: false,
		defaultWholeWord: false,
		appearanceColors: {},
		scopeAppearance: defaultScopeAppearance(),
		finderDockSide: "right",
		finderAutoDock: false,
		showFloatingFinderOnOpen: false,
	};
}

export function normalizeSettings(raw: unknown, now = Date.now()) {
	const settings = defaultSettings();
	const input =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	for (const key of [
		"clearAfterHidden",
		"enableInputHotkeys",
		"sourceModeWhenSearch",
		"moveCursorToMatch",
		"useSelectionAsSearch",
		"useEscapeCharInReplace",
		"enableHistory",
		"defaultRegexMode",
		"defaultCaseSensitive",
		"defaultWholeWord",
		"finderAutoDock",
		"showFloatingFinderOnOpen",
	] as const) {
		if (typeof input[key] === "boolean") settings[key] = input[key];
	}
	if (
		typeof input.historyMaxCount === "number" &&
		Number.isInteger(input.historyMaxCount) &&
		input.historyMaxCount >= 1 &&
		input.historyMaxCount <= 200
	)
		settings.historyMaxCount = input.historyMaxCount;
	if (Object.values(HistorySortOrder).includes(input.historySortOrder as HistorySortOrderType)) {
		settings.historySortOrder = input.historySortOrder as HistorySortOrderType;
	}
	// Keep the old eviction behavior on upgrade, including legacy createdAt preference.
	settings.historyRetention = Object.values(HistorySortOrder).includes(
		input.historyRetention as HistorySortOrderType,
	)
		? (input.historyRetention as HistorySortOrderType)
		: settings.historySortOrder;
	settings.searchPresets = normalizePresets(input.searchPresets, now);
	settings.searchHistory = trimHistory(
		normalizeHistory(input.searchHistory, now),
		settings.historyMaxCount,
		settings.historyRetention,
	);
	settings.searchToolbar = normalizeToolbar(input.searchToolbar, "search");
	if (input.finderDockSide === "left" || input.finderDockSide === "right")
		settings.finderDockSide = input.finderDockSide;
	settings.replaceToolbar = normalizeToolbar(input.replaceToolbar, "replace");
	settings.appearanceColors = normalizeAppearanceColors(input.appearanceColors);
	settings.scopeAppearance = normalizeScopeAppearance(input.scopeAppearance);
	return { settings, changed: raw != null && !sameData(raw, settings) };
}

// Object property order is not a migration, but array order and values are.
function sameData(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (
		!a ||
		!b ||
		typeof a !== "object" ||
		typeof b !== "object" ||
		Array.isArray(a) !== Array.isArray(b)
	)
		return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	return (
		keys.length === Object.keys(right).length &&
		keys.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(right, key) && sameData(left[key], right[key]),
		)
	);
}
