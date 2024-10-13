import type TextFinderPlugin from "./main";
import {
	RangeSetBuilder,
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

const CLS = {
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

	private registerCommand() {
		const { plugin, component } = this;
		plugin.addCommand({
			id: CMD.SHOW_FIND,
			name: i18n.t("commands.ShowFind.name"),
			editorCallback: (editor, ctx) => {
				const { useSelectionAsSearch } = plugin.settings;
				const defaultSearchText = useSelectionAsSearch
					? editor.getSelection()
					: "";
				component.setVisible(true, defaultSearchText);
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

export function editorExtensionProvider(plugin: TextFinderPlugin) {
	const workspace = plugin.app.workspace;
	workspace.onLayoutReady(() => {
		const mountEl = plugin.app.workspace.containerEl;
		const editorSearch = new EditorSearch(plugin, mountEl);

		const textMathcer = StateField.define<DecorationSet>({
			create(state): DecorationSet {
				return Decoration.none;
			},
			update(
				oldState: DecorationSet,
				transaction: Transaction
			): DecorationSet {
				const cache = editorSearch.component.getSearchCache();
				const builder = new RangeSetBuilder<Decoration>();
				if (editorSearch.component.isVisible()) {
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
			},
			provide(field: StateField<DecorationSet>): Extension {
				return EditorView.decorations.from(field);
			},
		});
		plugin.registerEditorExtension([textMathcer]);
	});

	return [];
}

/**
 * 从source中查找target的offset坐标
 * @param source  source字符串
 * @param target  target字符串
 * @param enableRegexMode 是否使用正则表达式
 * @param enableCaseSensitive  是否大小写敏感
 * @returns offset数组
 */
export function queryPositionList(
	source: string,
	target: string,
	enableRegexMode: boolean,
	enableCaseSensitive: boolean
): EditorOffset[] {
	const matches: EditorOffset[] = [];
	if (source != "" && target != "") {
		let index = 0;
		if (enableRegexMode) {
			try {
				const flags = "g" + (enableCaseSensitive ? "" : "i");
				const regex = new RegExp(target, flags);

				// for (const match of source.matchAll(regex)) {
				// 	matches.push({
				// 		from: match.index,
				// 		to: match.index + match[0].length,
				// 	});
				// }
				let match;
				// 可能有一些正则表达式会导致无限循环,考虑弄个黑名单直接返回[]

				while ((match = regex.exec(source)) !== null) {
					if (match[0] == "") {
						regex.lastIndex++;
					} else {
						matches.push({
							from: match.index,
							to: match.index + match[0].length,
							index: index++,
						});
					}
				}
			} catch (error) {
				console.log(`Finder match error!`, error);
				return [];
			}
		} else {
			const targetStr = enableCaseSensitive
				? target
				: target.toLowerCase();
			const sourceStr = enableCaseSensitive
				? source
				: source.toLowerCase();

			let startIndex = 0;
			while (
				(startIndex = sourceStr.indexOf(targetStr, startIndex)) !== -1
			) {
				const endIndex = startIndex + targetStr.length;
				matches.push({
					from: startIndex,
					to: endIndex,
					index: index++,
				});
				startIndex += targetStr.length;
			}
		}
	}
	return matches;
}
