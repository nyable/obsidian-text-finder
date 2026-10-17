import type { SearchHistoryItem } from "../model/history";
import type { HistoryController } from "./history-controller";
import type { PresetController, SearchRecipe } from "../../presets";
import type { ToolbarItem } from "../../finder";

export interface HistoryViewPreferences {
	historyMaxCount: number;
	historySortOrder: "createdAt" | "count" | "lastUsedAt";
	searchToolbar?: readonly Readonly<ToolbarItem>[];
	replaceToolbar?: readonly Readonly<ToolbarItem>[];
}

/** Only the history capabilities needed by the modal; never the plugin instance. */
export interface HistoryView {
	preferences(): HistoryViewPreferences;
	controller: Pick<HistoryController, "subscribe" | "sorted" | "remove" | "record" | "restore">;
	presets?: Pick<
		PresetController,
		"subscribe" | "list" | "put" | "remove" | "restore" | "move" | "nameTaken"
	>;
	capture?: () => SearchRecipe | null;
	apply?: (recipe: SearchRecipe) => boolean;
	reading?: () => boolean;
	reuse(text: string): boolean;
	copy(text: string): Promise<void>;
	isDisposed(): boolean;
	reportError(key: "history.ReuseFailed" | "history.CopyFailed", error: unknown): void;
}

export type { SearchHistoryItem };
