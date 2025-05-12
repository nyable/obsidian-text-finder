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
import { generateUniqueId } from "./util/common-helper";

export const CLS = {
	FINDER: "nya-finder",
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
	// 用来缓存各个窗口的finder，适配在新窗口打开的情况；暂时没对新窗口打开后关闭进行缓存清理，不过问题应该不大。
	finderCache: Map<string, SearchBox> = new Map();

	constructor(plugin: TextFinderPlugin) {
		this.plugin = plugin;
		this.registerEvent();
		this.registerCommand();
	}

	/**
	 * 获取Finder组件,如果不存在则创建
	 * @returns SearchBox
	 */
	getFinder(): SearchBox {
		// const targetEl = this.plugin.app.workspace.containerEl;
		const view =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			throw new Error(
				"Get Text-Finder Error: plugin.app.workspace.getActiveViewOfType(MarkdownView) is null"
			);
		}
		const targetEl = view.containerEl;
		const finderEl = targetEl.querySelector(`.${CLS.FINDER}`);
		if (finderEl) {
			// 创建SearchBox组件的时候一定会传一个cid，因此这里可以放心取值
			const cid = finderEl.getAttribute("data-cid");
			if (cid) {
				const cachedFinder = this.finderCache.get(cid);
				if (cachedFinder) {
					return cachedFinder;
				} else {
					finderEl.remove();
					throw new Error(
						"Get Text-Finder Error: this.finderCache.get(cid) is null"
					);
				}
			} else {
				finderEl.remove();
				throw new Error(
					"Get Text-Finder Error: finderEl.getAttribute('data-cid') is null"
				);
			}
		} else {
			const cid = generateUniqueId();
			const finder = new SearchBox({
				target: targetEl,
				props: {
					editorSearch: this,
					cid: cid,
				},
			});
			this.registerFinderEvent(targetEl, finder);
			this.finderCache.set(cid, finder);
			return finder;
		}
	}
	/**
	 * 销毁所有finder。在onunload的时候调用
	 */
	destoryAll() {
		this.finderCache.forEach((finder) => {
			finder && finder.$destroy();
		});
		this.finderCache.clear();
	}

	/**
	 * 注册finder的事件
	 * @param mountEl 挂载的元素
	 * @param finder finder
	 */
	private registerFinderEvent(mountEl: HTMLElement, finder: SearchBox) {
		this.plugin.registerDomEvent(mountEl, "keydown", (e) => {
			// press esc
			if (e.key == "Escape" && finder) {
				finder.closeFinder();
			}
		});
	}
	private registerEvent() {
		const workspace = this.plugin.app.workspace;

		this.plugin.registerEvent(
			workspace.on(
				"active-leaf-change",
				debounce(
					(leaf: WorkspaceLeaf | null) => {
						if (leaf?.view instanceof MarkdownView) {
							this.getFinder().matchAgain();
						}
					},
					250,
					true
				)
			)
		);

		this.plugin.registerEvent(
			workspace.on(
				"editor-change",
				(edt: Editor, info: MarkdownView | MarkdownFileInfo) => {
					this.getFinder().matchAgain(false);
				}
			)
		);
	}

	private openObsidianSearch() {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(this.plugin.app as any).commands.commands[
			"editor:open-search"
		].checkCallback();
	}

	private registerCommand() {
		const { plugin } = this;
		plugin.addCommand({
			id: CMD.SHOW_FIND,
			name: i18n.t("commands.ShowFind.name"),
			checkCallback: (checking: boolean) => {
				const view =
					plugin.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					const mode = view.getMode();
					const { useObsidianSearchInRead, useSelectionAsSearch } =
						plugin.settings;
					const previewCheck =
						useObsidianSearchInRead && mode === "preview";
					const sourceCheck = mode === "source";
					if (previewCheck || sourceCheck) {
						if (!checking) {
							if (mode === "preview") {
								this.openObsidianSearch();
							} else if (mode === "source") {
								const defaultSearchText = useSelectionAsSearch
									? view.editor.getSelection()
									: "";
								this.getFinder().setVisible(
									true,
									defaultSearchText
								);
							}
						}
						return true;
					}
				}
				return false;
			},
		});
		plugin.addCommand({
			id: CMD.SHOW_FIND_AND_REPLACE,
			name: i18n.t("commands.ShowFindAndReplace.name"),
			editorCallback: (editor, ctx) => {
				const finder = this.getFinder();
				finder.setCollapse(false);
				const { useSelectionAsSearch } = plugin.settings;
				const defaultSearchText = useSelectionAsSearch
					? editor.getSelection()
					: "";
				finder.setVisible(true, defaultSearchText);
			},
		});
		plugin.addCommand({
			id: CMD.HIDE_FIND,
			name: i18n.t("commands.HideFind.name"),
			editorCallback: (editor, ctx) => {
				this.getFinder().setVisible(false);
			},
		});

		plugin.addCommand({
			id: CMD.TOGGLE_FIND,
			name: i18n.t("commands.ToggleFind.name"),
			editorCallback: (editor, ctx) => {
				this.getFinder().toggleVisible();
			},
		});

		plugin.addCommand({
			id: CMD.TOGGLE_REPLACE,
			name: i18n.t("commands.ToggleReplace.name"),
			editorCallback: (editor, ctx) => {
				this.getFinder().toggleCollapse();
			},
		});

		plugin.addCommand({
			id: CMD.PREVIOUS_MATCH,
			name: i18n.t("commands.PreviousMatch.name"),
			editorCallback: (editor, ctx) => {
				this.getFinder().toPreviousMatch();
			},
		});

		plugin.addCommand({
			id: CMD.NEXT_MATCH,
			name: i18n.t("commands.NextMatch.name"),
			editorCallback: (editor, ctx) => {
				this.getFinder().toNextMatch();
			},
		});
		plugin.addCommand({
			id: CMD.REPLACE,
			name: i18n.t("commands.Replace.name"),
			editorCallback: (editor, ctx) => {
				const finder = this.getFinder();
				finder.replaceMatchedText(finder.getSearchCache().replace);
			},
		});
		plugin.addCommand({
			id: CMD.REPLACE_ALL,
			name: i18n.t("commands.ReplaceAll.name"),
			editorCallback: (editor, ctx) => {
				const finder = this.getFinder();
				finder.replaceAllMatchedText(finder.getSearchCache().replace);
			},
		});
	}
}
export const searchCacheEffect = StateEffect.define<SearchCache>();

export function editorExtensionProvider(plugin: TextFinderPlugin) {
	const workspace = plugin.app.workspace;

	workspace.onLayoutReady(() => {
		plugin.editorSearch = new EditorSearch(plugin);

		const textMatchMarker = StateField.define<DecorationSet>({
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
								(item: MatchOffset, index: number) => {
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

		plugin.registerEditorExtension([textMatchMarker]);
	});
}
