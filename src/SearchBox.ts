import SearchBoxView from "./SearchBox.vue";
import { mountView } from "./ui/mount";
import type { EditorSearch } from "./editor-extension";
import type { MarkdownView } from "obsidian";
import type { FinderSession } from "./finder-session";

/** Host-facing commands, separate from the view's private state/DOM handlers. */
export type Finder = Pick<FinderSession,
	"findInSelection" | "findInCapturedSelection" | "findSelectedText" | "hasSelectionScope"
	| "showFloatingEntry" | "resetFinderPosition" | "refreshToolbar" | "getSearchCache"
	| "setVisible" | "setVisibleFromHistory" | "showReplace" | "toggleReplaceFromCommand"
	| "isVisible" | "isDocked" | "replaceOnce" | "closeFinder" | "toNextMatch"
	| "toPreviousMatch" | "replaceAllMatchedText" | "matchAgain"
	| "dockFinder" | "expandFinder" | "toggleFindInSelection" | "setCollapse"
	| "resetAll" | "toggleVisible" | "toggleCollapse" | "toggleRegexMode"
	| "toggleMatchCaseMode" | "toggleWholeWordMode" | "getEditorContext" | "emitChange"
	| "setFindText" | "scrollToMatch" | "resetMatches" | "replaceMatchedText"
> & { destroy(): void };
/** Obsidian owns the session lifetime; Vue only owns this mounted view. */
export function mountFinder(target: HTMLElement, props: {editorSearch: EditorSearch; ownerView: MarkdownView; cid: string}): Finder {
	const view = mountView(SearchBoxView, target, props);
	return Object.assign(view.exposed, { destroy: () => view.destroy() }) as unknown as Finder;
}
