export type ToolbarKind = "search" | "replace";
export type ToolbarPlacement = "inline" | "more" | "hidden";
export type ToolbarAction = "regex" | "case" | "wholeWord" | "previous" | "next" | "history" | "replace" | "replaceAll";
export interface ToolbarItem { id: ToolbarAction; placement: ToolbarPlacement; }

export const toolbarLabels: Record<ToolbarAction, string> = {
	regex: "search.tip.UseRegularExpression", case: "search.tip.MatchCase",
	wholeWord: "search.tip.MatchWholeWord",
	previous: "search.tip.PreviousMatch", next: "search.tip.NextMatch",
	history: "commands.ShowSearchHistory.name", replace: "search.tip.Replace", replaceAll: "search.tip.ReplaceAll",
};

export function defaultToolbar(kind: ToolbarKind): ToolbarItem[] {
	return kind === "search"
		? ["regex", "case", "wholeWord", "previous", "next", "history"].map((id) => ({ id: id as ToolbarAction, placement: id === "history" ? "hidden" : "inline" }))
		: ["replace", "replaceAll"].map((id) => ({ id: id as ToolbarAction, placement: "inline" }));
}

/** Keep valid user order, ignore duplicate/foreign actions, add new actions with their defaults. */
export function normalizeToolbar(raw: unknown, kind: ToolbarKind): ToolbarItem[] {
	const defaults = defaultToolbar(kind);
	// Only exact historical defaults are migrated. Customized orders/placements
	// still belong to the user, including a deliberately separated whole-word item.
	if (kind === "search" && Array.isArray(raw)) {
		const legacy = defaults.filter((item) => item.id !== "wholeWord");
		const appended = [...legacy, defaults.find((item) => item.id === "wholeWord")!];
		if ([legacy, appended].some((layout) => layout.length === raw.length && layout.every((item, index) =>
			raw[index]?.id === item.id && raw[index]?.placement === item.placement))) return defaults;
	}
	const items: ToolbarItem[] = [];
	if (Array.isArray(raw)) for (const item of raw) {
		if (!item || typeof item !== "object" || !defaults.some((entry) => entry.id === item.id)
			|| items.some((entry) => entry.id === item.id)) continue;
		const fallback = defaults.find((entry) => entry.id === item.id)!;
		items.push({ id: fallback.id, placement: ["inline", "more", "hidden"].includes(item.placement) ? item.placement : fallback.placement });
	}
	return [...items, ...defaults.filter((entry) => !items.some((item) => item.id === entry.id))];
}

/** Destination is the insertion boundary in the original list, not the final index. */
export function moveToolbarItem(items: ToolbarItem[], from: number, boundary: number): ToolbarItem[] {
	if (from < 0 || from >= items.length || boundary < 0 || boundary > items.length) return items;
	const to = boundary > from ? boundary - 1 : boundary;
	if (to === from) return items;
	const next = items.slice();
	next.splice(to, 0, next.splice(from, 1)[0]);
	return next;
}
