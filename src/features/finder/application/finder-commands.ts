import type { FinderSession } from "./finder-session";

const commandNames = [
	"findInSelection",
	"findInCapturedSelection",
	"findSelectedText",
	"hasSelectionScope",
	"showFloatingEntry",
	"resetFinderPosition",
	"refreshToolbar",
	"getSearchCache",
	"setVisible",
	"setVisibleFromHistory",
	"showReplace",
	"toggleReplaceFromCommand",
	"isVisible",
	"isDocked",
	"replaceOnce",
	"closeFinder",
	"toNextMatch",
	"toPreviousMatch",
	"replaceAllMatchedText",
	"matchAgain",
	"dockFinder",
	"expandFinder",
	"toggleFindInSelection",
	"setCollapse",
	"resetAll",
	"toggleVisible",
	"toggleCollapse",
	"toggleRegexMode",
	"toggleMatchCaseMode",
	"toggleWholeWordMode",
	"setFindText",
	"setReplacementText",
	"replaceMatchedText",
] as const satisfies readonly (keyof FinderSession)[];

export type FinderCommands = Pick<FinderSession, (typeof commandNames)[number]>;

/** Never expose application state, editor snapshots or effect ports to a host. */
export function finderCommands(session: FinderSession): FinderCommands {
	return Object.fromEntries(commandNames.map((name) => [name, session[name]])) as FinderCommands;
}
