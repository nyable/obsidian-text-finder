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
	cache: SearchCache = { index: 0, matches: [], text: "" };
	options: SearchOptions = {
		enableRegexMode: false,
		enableCaseSensitive: false,
	};
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
					if (this.isVisible() && this.cache.text != "") {
						this.setFindText(this.cache.text);
						this.component.updateMatchedCache(this.cache);
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
			const searchStr = this.cache.text;
			if (searchStr !== "") {
				const cursorPos = edt.getCursor("to");
				this.setFindText(this.cache.text);
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
		this.plugin.addCommand({
			id: "text-finder-show",
			name: "Show Text Finder",
			editorCallback: (editor, ctx) => {
				this.component.setVisible(true, editor.getSelection());
			},
		});
		this.plugin.addCommand({
			id: "text-finder-hide",
			name: "Hide Text Finder",
			editorCallback: (editor, ctx) => {
				this.component.setVisible(false);
			},
		});

		this.plugin.addCommand({
			id: "text-finder-toggle",
			name: "Toggle Text Finder",
			editorCallback: (editor, ctx) => {
				this.component.toggleVisible();
			},
		});
	}

	isVisible() {
		return this.component.getVisible();
	}

	setOptions(options: SearchOptions) {
		this.options = options;
	}

	getActiveEditor() {
		const view =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const editor = view.editor;
			return {
				view: view,
				editor: editor,
				// eslint-disable-next-line
				editorView: (editor as any).cm as EditorView,
			};
		}
		return null;
	}

	setFindText(text: string) {
		const activeEditor = this.getActiveEditor();
		if (activeEditor) {
			const { editor } = activeEditor;
			const { cache, options } = this;
			const { enableRegexMode, enableCaseSensitive } = options;
			cache.text = text;

			if (cache.index > cache.matches.length - 1) {
				cache.index = 0;
			}

			if (text) {
				const content = editor.getValue();
				cache.matches = queryPositionList(
					content,
					text,
					enableRegexMode,
					enableCaseSensitive
				);

				if (cache.matches.length > 0) {
					this.scrollToMatch();
				} else {
					this.clearMatches();
				}
			} else {
				this.clearMatches();
			}
			this.component.updateMatchedCache(this.cache);
		}
		return this;
	}

	toNextMatch() {
		const { cache } = this;
		const matchSize = cache.matches.length;
		if (matchSize == 0) {
			cache.index = 0;
		} else {
			cache.index = (cache.index + 1) % matchSize;
		}
		this.scrollToMatch();
		return this;
	}
	toPreviousMatch() {
		const { cache } = this;
		const matchSize = cache.matches.length;
		if (matchSize == 0) {
			cache.index = 0;
		} else {
			cache.index = (cache.index - 1 + matchSize) % matchSize;
		}
		this.scrollToMatch();
		return this;
	}

	scrollToMatch() {
		const activeEditor = this.getActiveEditor();
		if (activeEditor) {
			const { editorView, editor } = activeEditor;

			const {
				cache: { matches, index },
			} = this;
			if (matches.length > 0) {
				const matched = matches[index];
				const { from, to } = matched;

				editorView.dispatch({
					selection: { anchor: from, head: to },
					// scrollIntoView: true,
				});
				editor.scrollIntoView(
					{
						from: editor.offsetToPos(from),
						to: editor.offsetToPos(to),
					},
					true
				);
			}
		}
	}

	clearMatches(clearText = false) {
		const { cache } = this;
		cache.matches = [];
		cache.index = 0;
		if (clearText) {
			cache.text = "";
		}
		const activeEditor = this.getActiveEditor();
		if (activeEditor) {
			const { editorView } = activeEditor;
			editorView.dispatch({
				selection: { anchor: 0, head: 0 },
			});
		}
	}

	replaceMatchedText(replaceText: string) {
		const {
			cache: { matches, text, index },
			options: {
				enableRegexMode: useRegex,
				enableCaseSensitive: ignoreCase,
			},
		} = this;
		if (matches.length > 0) {
			const activeEditor = this.getActiveEditor();
			if (activeEditor) {
				const { editor, editorView } = activeEditor;
				const current = matches[index];
				if (useRegex) {
					const regex = new RegExp(text, "g" + ignoreCase ? "i" : "");
					let replaceStr = replaceText;
					if (useRegex) {
						const rangeText = editor.getRange(
							editor.offsetToPos(current.from),
							editor.offsetToPos(current.to)
						);
						replaceStr = rangeText.replace(regex, replaceText);
					}
					editorView.dispatch({
						changes: {
							from: current.from,
							to: current.to,
							insert: replaceStr,
						},
					});
				} else {
					editorView.dispatch({
						changes: {
							from: current.from,
							to: current.to,
							insert: replaceText,
						},
					});
				}

				this.setFindText(text);
			}
		}
		return this;
	}

	replaceAllMatchedText(replaceText: string) {
		const activeEditor = this.getActiveEditor();
		if (activeEditor) {
			const { editor, editorView } = activeEditor;
			const {
				cache: { matches, text },
				options: {
					enableRegexMode: useRegex,
					enableCaseSensitive: ignoreCase,
				},
			} = this;
			if (matches.length > 0) {
				let result = [];
				if (useRegex) {
					const regex = new RegExp(text, "g" + ignoreCase ? "i" : "");
					result = matches.map((item) => {
						let replaceContent = replaceText;
						if (useRegex) {
							const rangeText = editor.getRange(
								editor.offsetToPos(item.from),
								editor.offsetToPos(item.to)
							);
							replaceContent = rangeText.replace(
								regex,
								replaceText
							);
						}
						return {
							from: item.from,
							to: item.to,
							insert: replaceContent,
						};
					});
				} else {
					result = matches.map((item) => {
						return {
							from: item.from,
							to: item.to,
							insert: replaceText,
						};
					});
				}

				editorView.dispatch({
					changes: result,
				});
				this.setFindText(text);
			}
		}
		return this;
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
				const { cache } = editorSearch;
				const builder = new RangeSetBuilder<Decoration>();
				if (editorSearch.isVisible()) {
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
				});
				startIndex += targetStr.length;
			}
		}
	}
	return matches;
}
