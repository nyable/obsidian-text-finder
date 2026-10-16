import type { MarkdownView } from "obsidian";
import type { FinderHost } from "../features/finder/contracts";
import type { ReadingSelection, ReadingSearch } from "../features/reading";
import type { MatchExecutor } from "../core/search/match-protocol";
import type { PluginRuntimeHost } from "./plugin-host";

interface FinderOwnerRuntime {
	plugin: Pick<PluginRuntimeHost, "settings" | "history" | "reportError">;
	getReadingSearch(owner: MarkdownView): ReadingSearch;
	getReadingSelection(owner: MarkdownView): readonly ReadingSelection[] | null;
	canSearchReading(owner: MarkdownView): boolean;
	getMatchEngine(owner: MarkdownView): MatchExecutor;
	clearReadingSearch(owner: MarkdownView): void;
	activateFloatingFinder(owner: MarkdownView): boolean;
	openHistory(): void;
	openNativeSearch(owner: MarkdownView): void;
}

export function createFinderHost(runtime: FinderOwnerRuntime, owner: MarkdownView): FinderHost {
	const tokens = new WeakMap<Window, object>(),
		windows = new WeakMap<object, Window>();
	return {
		preferences: () => runtime.plugin.settings,
		history: runtime.plugin.history,
		reportError: (key, error) => runtime.plugin.reportError(key, error),
		mode: () => (owner.getMode?.() === "preview" ? "preview" : "source"),
		environment() {
			const win = owner.containerEl?.ownerDocument?.defaultView;
			if (!win) return null;
			let token = tokens.get(win);
			if (!token) {
				token = {};
				tokens.set(win, token);
				windows.set(token, win);
			}
			return token;
		},
		environmentClosed: (token) => {
			if (!token) return false;
			const win = windows.get(token);
			return !win || win.closed === true;
		},
		reading() {
			const reading = runtime.getReadingSearch(owner);
			return {
				setScope: (selection) => reading.setScope(selection as readonly ReadingSelection[]),
				clearScope: () => reading.clearScope(),
				blockScope: () => reading.blockScope(),
				pauseNavigation: () => reading.pauseNavigation(),
				retrySynchronously: () => reading.retrySynchronously(),
				search: (...args) => reading.search(...args),
			};
		},
		selection: () => runtime.getReadingSelection(owner),
		canRead: () => runtime.canSearchReading(owner),
		matcher: () => runtime.getMatchEngine(owner),
		clearReading: () => runtime.clearReadingSearch(owner),
		activate: () => runtime.activateFloatingFinder(owner),
		openHistory: () => runtime.openHistory(),
		openNativeSearch: () => runtime.openNativeSearch(owner),
	};
}
