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

const CLS = {
	MATCH: "nya-text-finder-match",
	MATCH_CURRENT: "nya-text-finder-match-current",
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
					if (this.component.isVisible() && cache.search != "") {
						this.component.setFindText(cache.search);
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
			const searchStr = this.component.getSearchCache().search;
			if (searchStr !== "") {
				const cursorPos = edt.getCursor("to");
				this.component.setFindText(searchStr);
				edt.setCursor(cursorPos);
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
				this.component.setVisible(false);
			}
		});
	}

	private registerCommand() {
		const { plugin, component } = this;
		plugin.addCommand({
			id: "text-finder-show-find",
			name: "Search in current file",
			editorCallback: (editor, ctx) => {
				component.setVisible(true, editor.getSelection());
			},
		});
		plugin.addCommand({
			id: "text-finder-show-find-and-replace",
			name: "Search & replace in current file",
			editorCallback: (editor, ctx) => {
				component.setCollapse(false);
				component.setVisible(true, editor.getSelection());
			},
		});
		plugin.addCommand({
			id: "text-finder-hide-find",
			name: "Hide finder",
			editorCallback: (editor, ctx) => {
				component.setVisible(false);
			},
		});

		plugin.addCommand({
			id: "text-finder-toggle-replace",
			name: "Toggle replacer",
			editorCallback: (editor, ctx) => {
				component.toggleCollapse();
			},
		});

		plugin.addCommand({
			id: "text-finder-toggle-find",
			name: "Toggle finder",
			editorCallback: (editor, ctx) => {
				component.toggleVisible();
			},
		});

		plugin.addCommand({
			id: "text-finder-previous-match",
			name: "Previous match",
			editorCallback: (editor, ctx) => {
				component.toPreviousMatch();
			},
		});

		plugin.addCommand({
			id: "text-finder-next-match",
			name: "Next match",
			editorCallback: (editor, ctx) => {
				component.toNextMatch();
			},
		});
		plugin.addCommand({
			id: "text-finder-replace",
			name: "Replace in current file",
			editorCallback: (editor, ctx) => {
				component.replaceMatchedText(
					component.getSearchCache().replace
				);
			},
		});
		plugin.addCommand({
			id: "text-finder-replace-all",
			name: "Replace all in current file",
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
					cache.matches.forEach((item, index) => {
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
					});
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
