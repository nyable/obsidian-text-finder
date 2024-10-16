import type TextFinderPlugin from "./main";
import {
	RangeSetBuilder,
	StateEffect,
	StateField,
	Transaction,
	type Extension,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import {
	debounce,
	Editor,
	MarkdownView,
	WorkspaceLeaf,
	type MarkdownFileInfo,
} from "obsidian";
import SearchBox from "./SearchBox.svelte";
import { i18n } from "./i18n";

export const CLS = {
	MATCH: "nya-text-finder-match",
	MATCH_CURRENT: "nya-text-finder-match-current",
};
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
};

export class EditorSearch {
	plugin: TextFinderPlugin;
	mountEl: HTMLElement;
	component: SearchBox;
	constructor(plugin: TextFinderPlugin, mountEl: HTMLElement) {
		this.plugin = plugin;

		this.mountEl = mountEl;
		this.component = new SearchBox({
			target: this.mountEl,
			props: {
				editorSearch: this,
			},
		});

		this.registerEvent();
		this.registerCommand();
	}
	private registerEvent() {
		const ACTIVE_LEAF_CHANGE = "active-leaf-change";
		const EDITOR_CHANGE = "editor-change";

		const workspace = this.plugin.app.workspace;

		const onActiveLeafChange = debounce(
			(leaf: WorkspaceLeaf | null) => {
				if (leaf?.view instanceof MarkdownView) {
					const cache = this.component.getSearchCache();
					const searchKey = cache.search;
					if (this.component.isVisible() && searchKey != "") {
						this.component.setFindText(searchKey);
					}
				}
			},
			250,
			true
		);
		workspace.on(ACTIVE_LEAF_CHANGE, onActiveLeafChange);

		const onEditorChange = (
			edt: Editor,
			info: MarkdownView | MarkdownFileInfo
		) => {
			const cache = this.component.getSearchCache();
			const searchKey = cache.search;
			if (this.component.isVisible() && searchKey != "") {
				this.component.setFindText(searchKey, false);
			}
		};
		workspace.on(EDITOR_CHANGE, onEditorChange);

		this.plugin.onunload = () => {
			workspace.off(
				EDITOR_CHANGE,
				onEditorChange as (...data: unknown[]) => unknown
			);
			workspace.off(
				ACTIVE_LEAF_CHANGE,
				onActiveLeafChange as (...data: unknown[]) => unknown
			);
		};

		this.plugin.registerDomEvent(this.mountEl, "keydown", (e) => {
			// press esc
			if (e.key == "Escape") {
				this.component.closeSearch();
			}
		});
	}

	private openObsidianSearch() {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(this.plugin.app as any).commands.commands[
			"editor:open-search"
		].checkCallback();
	}

	private registerCommand() {
		const { plugin, component } = this;
		plugin.addCommand({
			id: CMD.SHOW_FIND,
			name: i18n.t("commands.ShowFind.name"),
			callback: () => {
				const view =
					plugin.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					const mode = view.getMode();
					const { useObsidianSearchInRead, useSelectionAsSearch } =
						plugin.settings;
					if (mode == "preview" && useObsidianSearchInRead) {
						this.openObsidianSearch();
					} else if (mode == "source") {
						const defaultSearchText = useSelectionAsSearch
							? view.editor.getSelection()
							: "";
						component.setVisible(true, defaultSearchText);
					}
				}
			},
		});
		plugin.addCommand({
			id: CMD.SHOW_FIND_AND_REPLACE,
			name: i18n.t("commands.ShowFindAndReplace.name"),
			editorCallback: (editor, ctx) => {
				component.setCollapse(false);
				const { useSelectionAsSearch } = plugin.settings;
				const defaultSearchText = useSelectionAsSearch
					? editor.getSelection()
					: "";
				component.setVisible(true, defaultSearchText);
			},
		});
		plugin.addCommand({
			id: CMD.HIDE_FIND,
			name: i18n.t("commands.HideFind.name"),
			editorCallback: (editor, ctx) => {
				component.setVisible(false);
			},
		});

		plugin.addCommand({
			id: CMD.TOGGLE_FIND,
			name: i18n.t("commands.ToggleFind.name"),
			editorCallback: (editor, ctx) => {
				component.toggleVisible();
			},
		});

		plugin.addCommand({
			id: CMD.TOGGLE_REPLACE,
			name: i18n.t("commands.ToggleReplace.name"),
			editorCallback: (editor, ctx) => {
				component.toggleCollapse();
			},
		});

		plugin.addCommand({
			id: CMD.PREVIOUS_MATCH,
			name: i18n.t("commands.PreviousMatch.name"),
			editorCallback: (editor, ctx) => {
				component.toPreviousMatch();
			},
		});

		plugin.addCommand({
			id: CMD.NEXT_MATCH,
			name: i18n.t("commands.NextMatch.name"),
			editorCallback: (editor, ctx) => {
				component.toNextMatch();
			},
		});
		plugin.addCommand({
			id: CMD.REPLACE,
			name: i18n.t("commands.Replace.name"),
			editorCallback: (editor, ctx) => {
				component.replaceMatchedText(
					component.getSearchCache().replace
				);
			},
		});
		plugin.addCommand({
			id: CMD.REPLACE_ALL,
			name: i18n.t("commands.ReplaceAll.name"),
			editorCallback: (editor, ctx) => {
				component.replaceAllMatchedText(
					component.getSearchCache().replace
				);
			},
		});
	}
}
export const searchCacheEffect = StateEffect.define<SearchCache>();

export function editorExtensionProvider(plugin: TextFinderPlugin) {
	const workspace = plugin.app.workspace;
	workspace.onLayoutReady(() => {
		const mountEl = plugin.app.workspace.containerEl;
		new EditorSearch(plugin, mountEl);

		const textMathcer = StateField.define<DecorationSet>({
			create(state): DecorationSet {
				return Decoration.none;
			},
			update(
				oldState: DecorationSet,
				transaction: Transaction
			): DecorationSet {
				for (const effect of transaction.effects) {
					if (effect.is(searchCacheEffect)) {
						const cache = effect.value;
						const builder = new RangeSetBuilder<Decoration>();
						if (cache.visible) {
							const length = transaction.state.doc.length;
							cache.matches.forEach(
								(item: EditorOffset, index: number) => {
									const from = item.from;
									const to = item.to;
									if (to <= length) {
										const classStr = `
										${CLS.MATCH} 
										${cache.index == index ? CLS.MATCH_CURRENT : ""} 
										`;
										builder.add(
											from,
											to,
											Decoration.mark({
												class: classStr,
											})
										);
									}
								}
							);
						}
						return builder.finish();
					}
				}
				return oldState;
			},
			provide(field: StateField<DecorationSet>): Extension {
				return EditorView.decorations.from(field);
			},
		});
		plugin.registerEditorExtension([textMathcer]);
	});
}
