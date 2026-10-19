import type { SearchOptions } from "../../../core/search/types";

/** Portable configuration only: never persist document identity or selection coordinates. */
export interface SearchRecipe {
	search: string;
	options: SearchOptions;
	replacement: {
		text: string;
		/** Legacy storage compatibility only; replacement parsing uses global preferences. */
		interpretEscapes: boolean;
	} | null;
	/** Missing on legacy recipes: find-only folds, replacements expand. */
	collapse?: boolean;
}

export interface SearchPreset extends SearchRecipe {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	order?: number;
}

/** Display names are trimmed, case-sensitive identities; legacy duplicates stay intact. */
export function presetNameTaken(
	items: readonly SearchPreset[],
	name: string,
	excludeId?: string,
): boolean {
	return items.some((item) => item.id !== excludeId && item.name.trim() === name.trim());
}

export function copyRecipe(recipe: SearchRecipe): SearchRecipe {
	return {
		search: recipe.search,
		collapse: typeof recipe.collapse === "boolean" ? recipe.collapse : !recipe.replacement,
		options: {
			regexMode: recipe.options.regexMode,
			caseSensitive: recipe.options.caseSensitive,
			wholeWord: recipe.options.wholeWord,
		},
		replacement: recipe.replacement
			? {
					text: recipe.replacement.text,
					interpretEscapes: recipe.replacement.interpretEscapes,
				}
			: null,
	};
}

export function normalizePresets(input: unknown, now: number): SearchPreset[] {
	if (!Array.isArray(input)) return [];
	const ids = new Set<string>();
	const result: SearchPreset[] = [];
	for (const raw of input) {
		if (!raw || typeof raw !== "object") continue;
		const item = raw as Partial<SearchPreset>;
		if (
			typeof item.id !== "string" ||
			!item.id ||
			ids.has(item.id) ||
			typeof item.name !== "string" ||
			!item.name.trim() ||
			typeof item.search !== "string" ||
			item.search === "" ||
			!item.options ||
			![item.options.regexMode, item.options.caseSensitive, item.options.wholeWord].every(
				(v) => typeof v === "boolean",
			) ||
			(item.replacement !== null &&
				(!item.replacement ||
					typeof item.replacement.text !== "string" ||
					typeof item.replacement.interpretEscapes !== "boolean"))
		)
			continue;
		const time = (value: unknown) =>
			typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : now;
		ids.add(item.id);
		result.push({
			...copyRecipe(item as SearchRecipe),
			id: item.id,
			name: item.name.trim(),
			createdAt: time(item.createdAt),
			updatedAt: time(item.updatedAt),
			...(typeof item.order === "number" &&
			Number.isSafeInteger(item.order) &&
			item.order >= 0
				? { order: item.order }
				: {}),
		});
	}
	// Preserve the order shown by the legacy alphabetical list on upgrade.
	const ordered = result.some((item) => item.order !== undefined)
		? result.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
		: result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
	return ordered.map((item, order) => ({ ...item, order }));
}
