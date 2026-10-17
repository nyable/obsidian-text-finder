import type { Plugin } from "obsidian";
import type { PluginSettings } from "../features/settings";
import type { HistoryController } from "../features/history";
import type { Finder } from "../features/finder/ui";
import type { TranslationKey } from "../i18n/keys";
import type { PresetController } from "../features/presets";

export interface WorkspaceCommands {
	getFinder(): Pick<
		Finder,
		"setVisibleFromHistory" | "captureRecipe" | "applyRecipe" | "focusSearch"
	>;
	refreshToolbars(): void;
	syncFloatingEntries(): void;
	dispose(): void;
}

/** Host shell contract shared only by composition modules, not feature UI. */
export interface PluginRuntimeHost extends Plugin {
	settings: PluginSettings;
	history: HistoryController;
	presets: PresetController;
	editorSearch: WorkspaceCommands | null;
	isUnloaded(): boolean;
	saveSettings(): Promise<void>;
	requestSaveSettings(): void;
	refreshAppearance(): void;
	ensureAppearanceDocument(doc: Document): void;
	reportError(key: TranslationKey, error: unknown): void;
}
