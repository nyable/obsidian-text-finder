import type { MatchExecutor } from "../../../core/search/match-protocol";
import type { MatchOffset, SearchOptions, SearchRange } from "../../../core/search/types";
import type { ToolbarItem } from "../model/toolbar";
import type { HistoryController } from "../../history";
import type { TranslationKey } from "../../../i18n/keys";

/** Owner-bound capabilities. Neither the plugin nor a mutable host view is exposed. */
export interface FinderPreferences {
	clearAfterHidden: boolean;
	enableInputHotkeys: boolean;
	enableHistory: boolean;
	sourceModeWhenSearch: boolean;
	moveCursorToMatch: boolean;
	useEscapeCharInReplace: boolean;
	defaultRegexMode: boolean;
	defaultCaseSensitive: boolean;
	defaultWholeWord: boolean;
	finderDockSide: "left" | "right";
	finderAutoDock: boolean;
	searchToolbar: readonly Readonly<ToolbarItem>[];
	replaceToolbar: readonly Readonly<ToolbarItem>[];
}

export interface ReadingResult {
	matches: MatchOffset[];
	index: number;
	pending: boolean;
	unsupported: boolean;
	error?: "failed" | "timeout";
	workerError?: boolean;
	scopeInvalid?: boolean;
}

/** Opaque captured DOM boundaries are interpreted only by the reading adapter. */
export type CapturedSelection = readonly unknown[];
export interface ReadingPort {
	setScope(selection: CapturedSelection): boolean;
	clearScope(): void;
	blockScope(): void;
	pauseNavigation(): void;
	search(
		text: string,
		options: SearchOptions,
		index: number,
		scroll: boolean,
		changed: (result: ReadingResult) => void,
		direction: number,
		synchronous?: boolean,
	): void;
}

export interface FinderHost {
	preferences(): Readonly<FinderPreferences>;
	history: Pick<HistoryController, "subscribe" | "sorted" | "record">;
	reportError(key: TranslationKey, error: unknown): void;
	mode(): "source" | "preview";
	environment(): object | null;
	environmentClosed(environment: object | null): boolean;
	reading(): ReadingPort;
	selection(): CapturedSelection | null;
	canRead(): boolean;
	matcher(): MatchExecutor;
	clearReading(): void;
	activate(): boolean;
	openHistory(): void;
	openNativeSearch(): void;
}

export type ScopeSelection = readonly SearchRange[] | CapturedSelection;
