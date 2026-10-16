import { HistorySortOrder, type HistorySortOrderType } from "./history-order";

export interface SearchHistoryItem {
	text: string;
	lastUsedAt: number;
	createdAt: number;
	count: number;
}

export function sortHistory(items: SearchHistoryItem[], order: HistorySortOrderType) {
	return [...items].sort((a, b) => {
		const primary =
			order === HistorySortOrder.COUNT
				? b.count - a.count
				: order === HistorySortOrder.CREATED_AT
					? b.createdAt - a.createdAt
					: b.lastUsedAt - a.lastUsedAt;
		return (
			primary ||
			b.lastUsedAt - a.lastUsedAt ||
			b.createdAt - a.createdAt ||
			(a.text < b.text ? -1 : a.text > b.text ? 1 : 0)
		);
	});
}

export function trimHistory(
	items: SearchHistoryItem[],
	limit: number,
	order: HistorySortOrderType,
) {
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
		const item =
			typeof raw === "string"
				? { text: raw }
				: raw && typeof raw === "object" && !Array.isArray(raw)
					? raw
					: null;
		if (!item || typeof item.text !== "string" || item.text === "") continue;
		const legacy = timestamp(item.timestamp) ? item.timestamp : now;
		const createdAt = timestamp(item.createdAt)
			? item.createdAt
			: timestamp(item.lastUsedAt)
				? item.lastUsedAt
				: legacy;
		const lastUsedAt = timestamp(item.lastUsedAt)
			? item.lastUsedAt
			: timestamp(item.createdAt)
				? item.createdAt
				: legacy;
		const next = {
			text: item.text,
			createdAt,
			lastUsedAt,
			count: count(item.count) ? item.count : 1,
		};
		const previous = byText.get(next.text);
		byText.set(
			next.text,
			previous
				? {
						text: next.text,
						createdAt: Math.min(previous.createdAt, next.createdAt),
						lastUsedAt: Math.max(previous.lastUsedAt, next.lastUsedAt),
						count: Math.max(previous.count, next.count),
					}
				: next,
		);
	}
	return [...byText.values()];
}

export function parseHistoryLimit(value: string): number | null {
	if (!/^[0-9]+$/.test(value)) return null;
	const limit = Number(value);
	return Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : null;
}

/** History identity is exact text; ordering may change while browsing. */
export class HistoryNavigation {
	private selected: string | null = null;
	private previous: string[] = [];
	private draft = "";

	reset() {
		this.selected = null;
		this.previous = [];
		this.draft = "";
	}
	select(text: string, items: SearchHistoryItem[]) {
		this.selected = items.some((item) => item.text === text) ? text : null;
		this.previous = items.map((item) => item.text);
		this.draft = "";
	}
	reconcile(items: SearchHistoryItem[]): string | undefined {
		const texts = items.map((item) => item.text);
		let replacement: string | undefined;
		if (this.selected !== null && !texts.includes(this.selected)) {
			const index = this.previous.indexOf(this.selected);
			const survivors = new Set(texts);
			const neighbour =
				this.previous.slice(index + 1).find((text) => survivors.has(text)) ??
				this.previous
					.slice(0, Math.max(0, index))
					.reverse()
					.find((text) => survivors.has(text)) ??
				texts[0];
			this.selected = neighbour ?? null;
			replacement = neighbour ?? this.draft;
		}
		this.previous = texts;
		return replacement;
	}
	move(direction: -1 | 1, current: string, items: SearchHistoryItem[]): string | undefined {
		const repaired = this.reconcile(items);
		// One key action repairs a removed item without skipping its neighbour.
		if (repaired !== undefined) return repaired;
		if (this.selected === null) {
			if (direction === -1) return current ? "" : undefined;
			const first = items[0];
			if (!first) return undefined;
			this.draft = current;
			this.selected = first.text;
		} else {
			const index = items.findIndex((item) => item.text === this.selected) + direction;
			if (index < 0) {
				this.selected = null;
				return this.draft;
			}
			this.selected = items[Math.min(index, items.length - 1)]?.text ?? null;
		}
		return this.selected ?? this.draft;
	}
}
