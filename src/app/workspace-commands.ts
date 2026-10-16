import { MarkdownView, type Editor, type MarkdownFileInfo, type Command } from "obsidian";
import type { FinderCommands } from "../features/finder/contracts";
import { i18n } from "../i18n";

export const CMD = {
	SHOW_FIND: "text-finder-show-find",
	SHOW_FIND_AND_REPLACE: "text-finder-show-find-and-replace",
	HIDE_FIND: "text-finder-hide-find",
	TOGGLE_REPLACE: "text-finder-toggle-replace",
	TOGGLE_FIND: "text-finder-toggle-find",
	PREVIOUS_MATCH: "text-finder-previous-match",
	NEXT_MATCH: "text-finder-next-match",
	REPLACE: "text-finder-replace",
	REPLACE_ALL: "text-finder-replace-all",
	RESET_POSITION: "text-finder-reset-position",
	FIND_IN_SELECTION: "text-finder-find-in-selection",
	HISTORY: "show-search-history",
} as const;

interface CommandHost {
	addCommand(command: Command): unknown;
	activeView(): MarkdownView | null;
	isOpen(view: MarkdownView): boolean;
	finder(view: MarkdownView): FinderCommands;
	existingFinder(view: MarkdownView): FinderCommands | undefined;
	editorFinder(editor: Editor, info: MarkdownView | MarkdownFileInfo): FinderCommands | null;
	useSelection(): boolean;
	showFinder(view: MarkdownView): void;
	openHistory(): void;
	reportError(error: unknown): void;
}

/** Host command routing does not own sessions or resources. Checking availability
 * must never eagerly construct a Finder. Editor actions resolve their exact pane. */
export function registerWorkspaceCommands(host: CommandHost): void {
	const add = (command: Command) => host.addCommand(command);
	const ownerCommand = (checking: boolean, action: (view: MarkdownView) => void): boolean => {
		const view = host.activeView();
		if (!view || !host.isOpen(view)) return false;
		if (!checking) action(view);
		return true;
	};
	add({
		id: CMD.FIND_IN_SELECTION,
		name: i18n.t("commands.FindInSelection.name"),
		checkCallback: (checking) =>
			ownerCommand(checking, (view) => {
				host.finder(view).findInSelection();
			}),
	});
	add({
		id: CMD.RESET_POSITION,
		name: i18n.t("search.tip.ResetFinderPosition"),
		checkCallback: (checking) =>
			ownerCommand(checking, (view) => host.existingFinder(view)?.resetFinderPosition()),
	});
	add({
		id: CMD.SHOW_FIND,
		name: i18n.t("commands.ShowFind.name"),
		checkCallback: (checking) => {
			const view = host.activeView();
			if (!view || (view.getMode() !== "preview" && view.getMode() !== "source"))
				return false;
			if (!checking) host.showFinder(view);
			return true;
		},
	});
	add({
		id: CMD.SHOW_FIND_AND_REPLACE,
		name: i18n.t("commands.ShowFindAndReplace.name"),
		editorCallback: (editor, info) => {
			const finder = host.editorFinder(editor, info);
			if (!finder) return;
			const query = host.useSelection() ? editor.getSelection() : "";
			finder.showReplace(finder.hasSelectionScope?.() ? undefined : query);
		},
	});
	add({
		id: CMD.HIDE_FIND,
		name: i18n.t("commands.HideFind.name"),
		checkCallback: (checking) =>
			ownerCommand(checking, (view) => host.existingFinder(view)?.closeFinder()),
	});
	add({
		id: CMD.TOGGLE_FIND,
		name: i18n.t("commands.ToggleFind.name"),
		checkCallback: (checking) =>
			ownerCommand(checking, (view) => {
				const finder = host.existingFinder(view);
				if (finder?.isVisible() && !finder.isDocked()) finder.closeFinder();
				else host.showFinder(view);
			}),
	});
	add({
		id: CMD.TOGGLE_REPLACE,
		name: i18n.t("commands.ToggleReplace.name"),
		editorCallback: (editor, info) => {
			host.editorFinder(editor, info)?.toggleReplaceFromCommand();
		},
	});
	add({
		id: CMD.PREVIOUS_MATCH,
		name: i18n.t("commands.PreviousMatch.name"),
		checkCallback: (checking) =>
			ownerCommand(checking, (view) => host.finder(view).toPreviousMatch()),
	});
	add({
		id: CMD.NEXT_MATCH,
		name: i18n.t("commands.NextMatch.name"),
		checkCallback: (checking) =>
			ownerCommand(checking, (view) => host.finder(view).toNextMatch()),
	});
	add({
		id: CMD.REPLACE,
		name: i18n.t("commands.Replace.name"),
		editorCallback: (editor, info) => {
			const finder = host.editorFinder(editor, info);
			if (finder) void Promise.resolve(finder.replaceOnce()).catch(host.reportError);
		},
	});
	add({
		id: CMD.REPLACE_ALL,
		name: i18n.t("commands.ReplaceAll.name"),
		editorCallback: (editor, info) => {
			const finder = host.editorFinder(editor, info);
			if (finder)
				void Promise.resolve(
					finder.replaceAllMatchedText(finder.getSearchCache().replace),
				).catch(host.reportError);
		},
	});
	add({
		id: CMD.HISTORY,
		name: i18n.t("commands.ShowSearchHistory.name"),
		callback: () => host.openHistory(),
	});
}
