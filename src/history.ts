import { HistorySortOrder, type HistorySortOrderType } from "./constants";

export interface SearchHistoryItem {
	text: string;
	lastUsedAt: number;
	createdAt: number;
	count: number;
}

export function sortHistory(items: SearchHistoryItem[], order: HistorySortOrderType) {
	return [...items].sort((a, b) => {
		const primary = order === HistorySortOrder.COUNT ? b.count - a.count
			: order === HistorySortOrder.CREATED_AT ? b.createdAt - a.createdAt
				: b.lastUsedAt - a.lastUsedAt;
		return primary || b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt
			|| (a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
	});
}

export function trimHistory(items: SearchHistoryItem[], limit: number, order: HistorySortOrderType) {
	return sortHistory(items, order).slice(0, limit);
}

const timestamp = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const count = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

export function normalizeHistory(input: unknown, now: number): SearchHistoryItem[] {
	if (!Array.isArray(input)) return [];
	const byText = new Map<string, SearchHistoryItem>();
	for (const raw of input) {
		const item = typeof raw === "string" ? { text: raw }
			: raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
		if (!item || typeof item.text !== "string" || item.text === "") continue;
		const legacy = timestamp(item.timestamp) ? item.timestamp : now;
		const createdAt = timestamp(item.createdAt) ? item.createdAt
			: timestamp(item.lastUsedAt) ? item.lastUsedAt : legacy;
		const lastUsedAt = timestamp(item.lastUsedAt) ? item.lastUsedAt
			: timestamp(item.createdAt) ? item.createdAt : legacy;
		const next = { text: item.text, createdAt, lastUsedAt, count: count(item.count) ? item.count : 1 };
		const previous = byText.get(next.text);
		byText.set(next.text, previous ? {
			text: next.text, createdAt: Math.min(previous.createdAt, next.createdAt),
			lastUsedAt: Math.max(previous.lastUsedAt, next.lastUsedAt),
			count: Math.max(previous.count, next.count),
		} : next);
	}
	return [...byText.values()];
}

export function parseHistoryLimit(value: string): number | null {
	if (!/^[0-9]+$/.test(value)) return null;
	const limit = Number(value);
	return Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : null;
}

interface HistorySettings {
	searchHistory: SearchHistoryItem[];
	historySortOrder: HistorySortOrderType;
	historyMaxCount: number;
	enableHistory: boolean;
}

// Mutations and notifications are synchronous; persistence never gates the UI.
export class HistoryController {
	private listeners = new Set<() => void>();
	constructor(private settings: () => HistorySettings, private save: () => Promise<void>, private clock = Date.now) {}

	subscribe(listener: () => void) {
		this.listeners.add(listener);
		listener();
		return () => { this.listeners.delete(listener); };
	}
	notify() { this.listeners.forEach((listener) => listener()); }
	sorted() {
		const settings = this.settings();
		return sortHistory(settings.searchHistory, settings.historySortOrder);
	}
	private commit(items: SearchHistoryItem[]) {
		this.settings().searchHistory = items;
		this.notify();
		// saveSettings reports failures; this prevents abandoned UI promises.
		void this.save().catch(() => {});
	}
	record(text: string, increment = true, existingOnly = false): boolean {
		const settings = this.settings();
		if (!settings.enableHistory || text === "") return false;
		const existing = settings.searchHistory.find((item) => item.text === text);
		if (!existing && existingOnly) return false;
		const now = this.clock();
		const next = existing ? {
			...existing, lastUsedAt: now,
			count: increment ? Math.min(Number.MAX_SAFE_INTEGER, existing.count + 1) : existing.count,
		} : { text, createdAt: now, lastUsedAt: now, count: 1 };
		this.commit(trimHistory([
			...settings.searchHistory.filter((item) => item.text !== text), next,
		], settings.historyMaxCount, settings.historySortOrder));
		return true;
	}
	remove(texts: Set<string>) {
		const current = this.settings().searchHistory;
		const next = current.filter((item) => !texts.has(item.text));
		if (next.length !== current.length) this.commit(next);
	}
	resize(limit: number) {
		if (!Number.isInteger(limit) || limit < 1 || limit > 200) return;
		const settings = this.settings();
		if (settings.historyMaxCount === limit && settings.searchHistory.length <= limit) return;
		settings.historyMaxCount = limit;
		this.commit(trimHistory(settings.searchHistory, limit, settings.historySortOrder));
	}
}
