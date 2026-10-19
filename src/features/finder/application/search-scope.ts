import { normalizeSearchRanges } from "../../../core/search/text-matching";
import type { SearchRange } from "../../../core/search/types";
import type { EditorPort, EditingSnapshot } from "./editor-port";
import type { FinderHost, ScopeSelection } from "./finder-host";

export interface ScopeState {
	disposed: boolean;
	scopeEnabled: boolean;
	scopeBlocked: boolean;
	scopeEmpty: boolean;
	scopeEpoch: number;
	scopeContext: EditingSnapshot | null;
	scopeWindow: object | null;
	readingScope: boolean;
}

/** Captured scope identity is independent from the current query and selection. */
export function createSearchScope(
	state: ScopeState,
	host: FinderHost,
	editor: EditorPort,
	capture: () => EditingSnapshot | null,
	cancel: () => void,
	invalidatePosition: () => void,
	resetIndex: () => void,
) {
	const reading = () => host.mode() === "preview";
	const stored = (snapshot: EditingSnapshot | null) =>
		snapshot ? editor.scope(snapshot) : undefined;
	const clearEditor = (snapshot: EditingSnapshot | null) => {
		if (!snapshot || stored(snapshot)?.ranges == null) return;
		try {
			editor.setScope(snapshot, null);
		} catch (error) {
			console.warn("Text Finder: could not clear detached search scope", error);
		}
	};
	const clear = (block = false) => {
		const previous = state.scopeContext;
		if (state.readingScope) host.reading().clearScope();
		state.readingScope = false;
		state.scopeContext = null;
		state.scopeEnabled = false;
		state.scopeBlocked = block;
		state.scopeEmpty = false;
		state.scopeEpoch++;
		clearEditor(previous);
	};
	const ranges = (): readonly SearchRange[] | undefined => {
		if (state.scopeBlocked || state.readingScope) return [];
		return state.scopeEnabled && state.scopeContext
			? normalizeSearchRanges(
					stored(state.scopeContext)?.ranges ?? [],
					editor.documentLength(state.scopeContext),
				)
			: undefined;
	};
	return {
		clear,
		ranges,
		sync(this: void, snapshot: EditingSnapshot | null) {
			if (state.readingScope) {
				if (!reading() || state.scopeWindow !== host.environment()) clear(true);
				return;
			}
			if (
				state.scopeEnabled &&
				(reading() ||
					!snapshot ||
					snapshot.file !== state.scopeContext?.file ||
					snapshot.editor !== state.scopeContext.editor ||
					snapshot.editorView !== state.scopeContext.editorView ||
					stored(snapshot)?.ranges == null ||
					state.scopeWindow !== host.environment())
			)
				clear(true);
			state.scopeEmpty = state.scopeEnabled && !ranges()?.length;
		},
		activate(this: void, selection?: ScopeSelection): boolean {
			if (state.disposed) return false;
			if (reading()) {
				const selected = selection ?? host.selection();
				if (!selected || !host.canRead()) {
					host.reportError(
						"search.SelectionRequired",
						new Error("No supported reading selection"),
					);
					return false;
				}
				if (!host.reading().setScope(selected)) {
					host.reportError(
						"search.SelectionRequired",
						new Error("Reading selection could not be mapped"),
					);
					return false;
				}
				clearEditor(state.scopeContext);
				state.scopeContext = null;
				state.scopeBlocked = false;
				state.scopeEpoch++;
				state.readingScope = true;
				state.scopeEnabled = true;
				state.scopeWindow = host.environment();
				state.scopeEmpty = false;
				resetIndex();
				return true;
			}
			const snapshot = capture(),
				current = stored(snapshot);
			const selected = snapshot
				? normalizeSearchRanges(
						(selection as readonly SearchRange[] | undefined) ??
							current?.candidate ??
							[],
						snapshot.doc.length,
					)
				: [];
			if (!snapshot || !current || !selected.length) {
				host.reportError(
					"search.SelectionRequired",
					new Error("No valid editor selection"),
				);
				return false;
			}
			cancel();
			invalidatePosition();
			clear();
			state.scopeContext = snapshot;
			state.scopeEnabled = true;
			state.scopeWindow = host.environment();
			editor.setScope(snapshot, selected);
			state.scopeEmpty = false;
			resetIndex();
			return true;
		},
	};
}
