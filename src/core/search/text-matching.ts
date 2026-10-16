import type { MatchOffset, SearchRange } from "./types";

/**
 * 从source中查找target的offset坐标数组
 * @param source  source字符串
 * @param target  target字符串
 * @param enableRegexMode 是否使用正则表达式
 * @param enableCaseSensitive  是否大小写敏感
 * @param enableWholeWord 是否使用 VS Code 默认分隔符检查完整匹配的边界
 * @returns offset数组
 */
export function findTextOffsets(
	source: string,
	target: string,
	enableRegexMode: boolean,
	enableCaseSensitive: boolean,
	enableWholeWord = false,
	ranges?: readonly SearchRange[],
): MatchOffset[] {
	return findTextMatches(
		source,
		target,
		enableRegexMode,
		enableCaseSensitive,
		enableWholeWord,
		ranges,
	).map((match, index) => ({
		from: match.index,
		to: match.index + match[0].length,
		index,
	}));
}

// VS Code's default editor.wordSeparators (wordHelper.ts:USUAL_WORD_SEPARATORS).
// Deliberately not Unicode segmentation or JS \b: underscore, CJK punctuation,
// NBSP and combining marks remain regular characters. Offsets stay UTF-16.
const wordSeparators = new Set("`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/? \t");
const outsideWordBoundary = (char: string) =>
	char === "\r" || char === "\n" || wordSeparators.has(char);
function isWholeWordMatch(source: string, from: number, to: number): boolean {
	// Like VS Code, CR/LF delimit a match only when outside its range.
	return (
		(from === 0 ||
			outsideWordBoundary(source.charAt(from - 1)) ||
			wordSeparators.has(source.charAt(from))) &&
		(to === source.length ||
			outsideWordBoundary(source.charAt(to)) ||
			wordSeparators.has(source.charAt(to - 1)))
	);
}

function findTextMatches(
	source: string,
	target: string,
	enableRegexMode: boolean,
	enableCaseSensitive: boolean,
	enableWholeWord: boolean,
	ranges?: readonly SearchRange[],
): RegExpExecArray[] {
	if (source === "" || target === "") {
		return [];
	}
	const matches: RegExpExecArray[] = [];
	try {
		// Both search and replacement match the original text with identical
		// flags. Lowercasing first would invalidate some Unicode offsets.
		const pattern = enableRegexMode ? target : target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const flags = "g" + (enableRegexMode ? "m" : "") + (enableCaseSensitive ? "" : "i");
		const regex = new RegExp(pattern, flags);
		// Scan each range in the original document: lookarounds, anchors, word
		// boundaries and replacement templates retain their full-document context.
		for (const range of normalizeSearchRanges(
			ranges ?? [{ from: 0, to: source.length }],
			source.length,
		)) {
			regex.lastIndex = range.from;
			let match;
			while ((match = regex.exec(source)) !== null && match.index < range.to) {
				// Preserve the existing exclusion of zero-width matches.
				if (match[0] === "") {
					regex.lastIndex++;
				} else if (match.index + match[0].length > range.to) {
					// A crossing alternative must not consume a later, contained match.
					regex.lastIndex = match.index + 1;
				} else if (
					!enableWholeWord ||
					isWholeWordMatch(source, match.index, match.index + match[0].length)
				) {
					matches.push(match);
				}
			}
		}
	} catch (error) {
		console.log(`Finder match error!`, error);
		return [];
	}
	return matches;
}

/** Invalid scopes fail closed; adjacent selections remain separate boundaries. */
export function normalizeSearchRanges(
	ranges: readonly SearchRange[],
	length: number,
): SearchRange[] {
	const sorted = ranges
		.filter(
			(range) =>
				Number.isSafeInteger(range.from) &&
				Number.isSafeInteger(range.to) &&
				range.from >= 0 &&
				range.to > range.from &&
				range.to <= length,
		)
		.map((range) => ({ from: range.from, to: range.to }))
		.sort((a, b) => a.from - b.from || a.to - b.to);
	const result: SearchRange[] = [];
	for (const range of sorted) {
		const previous = result[result.length - 1];
		if (previous && range.from < previous.to) previous.to = Math.max(previous.to, range.to);
		else result.push(range);
	}
	return result;
}

export interface ReplacementChange {
	from: number;
	to: number;
	insert: string;
}

/** Build changes against one original document, retaining regex context. */
export function findReplacementChanges(
	source: string,
	target: string,
	replacement: string,
	enableRegexMode: boolean,
	enableCaseSensitive: boolean,
	enableWholeWord = false,
	ranges?: readonly SearchRange[],
): ReplacementChange[] {
	return prepareReplacements(
		source,
		target,
		replacement,
		enableRegexMode,
		enableCaseSensitive,
		enableWholeWord,
		ranges,
	).all();
}

/** Match once against the complete original text, expand only requested inserts. */
export function prepareReplacements(
	source: string,
	target: string,
	replacement: string,
	enableRegexMode: boolean,
	enableCaseSensitive: boolean,
	enableWholeWord = false,
	ranges?: readonly SearchRange[],
) {
	const matches = findTextMatches(
		source,
		target,
		enableRegexMode,
		enableCaseSensitive,
		enableWholeWord,
		ranges,
	);
	const change = (match: RegExpExecArray): ReplacementChange => ({
		from: match.index,
		to: match.index + match[0].length,
		insert: enableRegexMode ? expandReplacement(source, match, replacement) : replacement,
	});
	return {
		matches: matches.map((match, index) => ({
			from: match.index,
			to: match.index + match[0].length,
			index,
		})),
		one: (index: number) => (matches[index] ? change(matches[index]) : undefined),
		all: () => matches.map(change),
	};
}

// String.replace template semantics, evaluated using the original match and
// document. Do not re-run a regex on a slice: lookarounds and anchors lose context.
function expandReplacement(source: string, match: RegExpExecArray, replacement: string): string {
	const groups = (
		match as RegExpExecArray & {
			groups?: Record<string, string | undefined>;
		}
	).groups;
	return replacement.replace(/\$([$&`']|[0-9]{1,2}|<[^>]*>)/g, (token, key: string) => {
		switch (key) {
			case "$":
				return "$";
			case "&":
				return match[0];
			case "`":
				return source.slice(0, match.index);
			case "'":
				return source.slice(match.index + match[0].length);
		}
		if (key[0] === "<") {
			return groups === undefined ? token : (groups[key.slice(1, -1)] ?? "");
		}
		const capture = Number(key);
		if (capture > 0 && capture < match.length) {
			return match[capture] ?? "";
		}
		// With fewer than nn captures, $nn falls back to $n + literal n.
		const first = Number(key[0]);
		if (key.length === 2 && first > 0 && first < match.length) {
			return (match[first] ?? "") + key[1];
		}
		return token;
	});
}

/**
 * 找出list中,位于target之后的第一个符合结果
 * @param target 目标Offset
 * @param list Offset数组
 * @param extraOffset 偏移量 额外偏移量
 * @returns index
 */
export function findIndexAfterOffset(
	target: MatchOffset,
	list: MatchOffset[],
	extraOffset: number,
): number {
	return list.findIndex((item) => item.to >= target.from + extraOffset);
}
