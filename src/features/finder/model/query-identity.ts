import type { SearchOptions, SearchRange } from "../../../core/search/types";

export function searchIdentity(query: string, options: SearchOptions): string {
	return JSON.stringify([query, options.regexMode, options.caseSensitive, options.wholeWord]);
}

export function queryIdentity(
	query: string,
	options: SearchOptions,
	scopeEpoch: number,
	ranges: readonly SearchRange[] | undefined,
): string {
	return JSON.stringify([searchIdentity(query, options), scopeEpoch, ranges]);
}

export function decodeReplacementEscapes(text: string, enabled: boolean): string {
	return enabled
		? text.replace(/\\([\\nt])/g, (_, escaped: string) =>
				escaped === "n" ? "\n" : escaped === "t" ? "\t" : "\\",
			)
		: text;
}
