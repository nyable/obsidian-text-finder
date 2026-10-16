import type { PluginSettings } from "../model/settings";
import { defaultSettings } from "../model/settings";
import {
	appearanceColors,
	colorKeys,
	defaultScopeAppearance,
	type AppearanceColorKey,
} from "../model/appearance";
import type { HistorySortOrderType } from "../../history";
import { defaultToolbar, type ToolbarItem, type ToolbarKind } from "../../finder";

export type ToggleKey = {
	[K in keyof PluginSettings]: PluginSettings[K] extends boolean ? K : never;
}[keyof PluginSettings];
export type SettingsPreferences = Readonly<
	Omit<
		PluginSettings,
		| "searchHistory"
		| "appearanceColors"
		| "scopeAppearance"
		| "searchToolbar"
		| "replaceToolbar"
	>
> & {
	readonly appearanceColors: Readonly<PluginSettings["appearanceColors"]>;
	readonly scopeAppearance: Readonly<PluginSettings["scopeAppearance"]>;
	readonly searchToolbar: readonly Readonly<ToolbarItem>[];
	readonly replaceToolbar: readonly Readonly<ToolbarItem>[];
};
interface SettingsEffects {
	save(): void;
	historyChanged(): void;
	resizeHistory(limit: number): void;
	refreshToolbars(): void;
	syncFloatingEntries(): void;
	refreshAppearance(): void;
}

/** Synchronous updates and notifications precede a non-blocking save request.
 * Only the composition root supplies the mutable persistence DTO. */
export class SettingsController {
	constructor(
		private settings: () => PluginSettings,
		private effects: SettingsEffects,
	) {}
	preferences(): SettingsPreferences {
		return this.settings();
	}
	toggle(key: ToggleKey, value: boolean): void {
		this.settings()[key] = value;
		if (key === "finderAutoDock") this.effects.refreshToolbars();
		if (key === "showFloatingFinderOnOpen" && value) this.effects.syncFloatingEntries();
		if (key === "enableHistory") {
			this.effects.historyChanged();
			this.effects.refreshToolbars();
		}
		this.effects.save();
	}
	historyOrder(order: HistorySortOrderType): void {
		this.settings().historySortOrder = order;
		this.effects.historyChanged();
		this.effects.save();
	}
	resizeHistory(limit: number): void {
		this.effects.resizeHistory(limit);
	}
	color(key: AppearanceColorKey, value: string | null): void {
		if (value === null) delete this.settings().appearanceColors[key];
		else this.settings().appearanceColors[key] = value;
		this.appearanceChanged();
	}
	resetColors(): void {
		for (const key of colorKeys)
			if (appearanceColors[key].group !== "scope")
				delete this.settings().appearanceColors[key];
		this.appearanceChanged();
	}
	resetScope(): void {
		const settings = this.settings();
		delete settings.appearanceColors.scopeBackground;
		delete settings.appearanceColors.scopeBorder;
		settings.scopeAppearance = defaultScopeAppearance();
		this.appearanceChanged();
	}
	scopeBorder(value: boolean): void {
		this.settings().scopeAppearance.border = value;
		this.appearanceChanged();
	}
	scopeWidth(value: 1 | 2 | 3): void {
		this.settings().scopeAppearance.width = value;
		this.appearanceChanged();
	}
	private appearanceChanged(): void {
		this.effects.refreshAppearance();
		this.effects.save();
	}
	toolbar(kind: ToolbarKind, items: readonly Readonly<ToolbarItem>[]): boolean {
		const key = kind === "search" ? "searchToolbar" : "replaceToolbar";
		if (items === this.settings()[key]) return false;
		this.settings()[key] = items.map((item) => ({ ...item }));
		this.effects.refreshToolbars();
		this.effects.save();
		return true;
	}
	resetToolbar(kind: ToolbarKind): void {
		if (kind === "search") {
			const defaults = defaultSettings(),
				settings = this.settings();
			settings.defaultRegexMode = defaults.defaultRegexMode;
			settings.defaultCaseSensitive = defaults.defaultCaseSensitive;
			settings.defaultWholeWord = defaults.defaultWholeWord;
		}
		this.toolbar(kind, defaultToolbar(kind));
	}
}

export type SettingsCommands = Pick<
	SettingsController,
	| "preferences"
	| "toggle"
	| "historyOrder"
	| "resizeHistory"
	| "color"
	| "resetColors"
	| "resetScope"
	| "scopeBorder"
	| "scopeWidth"
	| "toolbar"
	| "resetToolbar"
>;
