import type { SearchHistoryItem } from "../model/history";
import type { HistoryController } from "./history-controller";

export interface HistoryViewPreferences {
	historyMaxCount: number;
	historySortOrder: "createdAt" | "count" | "lastUsedAt";
}

/** Only the history capabilities needed by the modal; never the plugin instance. */
export interface HistoryView {
	preferences(): HistoryViewPreferences;
	controller: Pick<HistoryController, "subscribe" | "sorted" | "remove" | "record">;
	reuse(text: string): boolean;
	copy(text: string): Promise<void>;
	isDisposed(): boolean;
	reportError(key: "history.ReuseFailed" | "history.CopyFailed", error: unknown): void;
}

export type { SearchHistoryItem };
