import { sortHistory, trimHistory, type SearchHistoryItem } from "../model/history";
import type { HistorySortOrderType } from "../model/history-order";

interface HistorySettings {
	searchHistory: SearchHistoryItem[];
	historySortOrder: HistorySortOrderType;
	historyRetention?: HistorySortOrderType;
	historyMaxCount: number;
	enableHistory: boolean;
}

// Mutations and notifications are synchronous; persistence never gates the UI.
export class HistoryController {
	private listeners = new Set<() => void>();
	constructor(
		private settings: () => HistorySettings,
		private save: () => Promise<void>,
		private clock = Date.now,
		private reportError: (error: unknown) => void = (error) =>
			console.error("Text Finder: history subscriber failed", error),
	) {}

	subscribe(listener: () => void) {
		this.listeners.add(listener);
		try {
			listener();
		} catch (error) {
			this.listeners.delete(listener);
			throw error;
		}
		return () => {
			this.listeners.delete(listener);
		};
	}
	notify() {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				this.reportError(error);
			}
		}
	}
	sorted() {
		const settings = this.settings();
		return sortHistory(settings.searchHistory, settings.historySortOrder);
	}
	private commit(items: SearchHistoryItem[]) {
		this.settings().searchHistory = items;
		try {
			this.notify();
		} finally {
			// saveSettings reports failures; this prevents abandoned UI promises.
			void this.save().catch(() => {});
		}
	}
	record(text: string, increment = true, existingOnly = false): boolean {
		const settings = this.settings();
		if (!settings.enableHistory || text === "") return false;
		const existing = settings.searchHistory.find((item) => item.text === text);
		if (!existing && existingOnly) return false;
		const now = this.clock();
		const next = existing
			? {
					...existing,
					lastUsedAt: now,
					count: increment
						? Math.min(Number.MAX_SAFE_INTEGER, existing.count + 1)
						: existing.count,
				}
			: { text, createdAt: now, lastUsedAt: now, count: 1 };
		this.commit(
			trimHistory(
				[...settings.searchHistory.filter((item) => item.text !== text), next],
				settings.historyMaxCount,
				settings.historyRetention ?? settings.historySortOrder,
			),
		);
		return true;
	}
	remove(texts: Set<string>) {
		const current = this.settings().searchHistory;
		const next = current.filter((item) => !texts.has(item.text));
		if (next.length !== current.length) this.commit(next);
	}
	/** Merge deleted snapshots without overwriting later usage of the same exact text. */
	restore(items: SearchHistoryItem[]) {
		const settings = this.settings();
		const current = new Map(settings.searchHistory.map((item) => [item.text, item]));
		for (const item of items) {
			const newer = current.get(item.text);
			current.set(
				item.text,
				newer
					? {
							text: item.text,
							createdAt: Math.min(item.createdAt, newer.createdAt),
							lastUsedAt: Math.max(item.lastUsedAt, newer.lastUsedAt),
							count: Math.max(item.count, newer.count),
						}
					: { ...item },
			);
		}
		this.commit(
			trimHistory(
				[...current.values()],
				settings.historyMaxCount,
				settings.historyRetention ?? settings.historySortOrder,
			),
		);
	}
	resize(limit: number) {
		if (!Number.isInteger(limit) || limit < 1 || limit > 200) return;
		const settings = this.settings();
		if (settings.historyMaxCount === limit && settings.searchHistory.length <= limit) return;
		settings.historyMaxCount = limit;
		this.commit(
			trimHistory(
				settings.searchHistory,
				limit,
				settings.historyRetention ?? settings.historySortOrder,
			),
		);
	}
}
