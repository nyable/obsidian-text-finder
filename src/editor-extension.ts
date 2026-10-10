import type TextFinderPlugin from "./main";
import type { EditorView } from "@codemirror/view";
import type { EditorContext } from "./editor-context";
import { CLS, textMatchMarker } from "./search-highlight";
import {
	Editor,
	MarkdownView,
	Notice,
	WorkspaceLeaf,
	type MarkdownFileInfo,
} from "obsidian";
import SearchBox from "./SearchBox.svelte";
import { i18n } from "./i18n";
import { generateUniqueId } from "./util/common-helper";
import { HistoryModal } from "./HistoryModal";
import { ReadingSearch } from "./reading-search";

export { CLS, searchCacheEffect } from "./search-highlight";

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
	// Finder resources are owned by their Markdown view and released on leaf close.
	finderCache: Map<string, SearchBox> = new Map();
	private finderViews: Map<MarkdownView, SearchBox> = new Map();
	private readingSearches = new Map<MarkdownView, ReadingSearch>();
	private modeObservers = new Map<MarkdownView, MutationObserver>();
	private finderEvents = new Map<MarkdownView, () => void>();
	private disposed = false;

	constructor(plugin: TextFinderPlugin) {
		this.plugin = plugin;
		this.registerEvent();
		this.registerCommand();
	}

	/**
	 * 获取Finder组件,如果不存在则创建
	 * @returns SearchBox
	 */
	getFinder(view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView)): SearchBox {
		if (!view) {
			throw new Error(
				"Get Text-Finder Error: plugin.app.workspace.getActiveViewOfType(MarkdownView) is null"
			);
		}
		const existing = this.finderViews.get(view);
		if (existing) return existing;
		const targetEl = view.containerEl;
		const finderEl = targetEl.querySelector(`.${CLS.FINDER}`);
		if (finderEl) {
			// 创建SearchBox组件的时候一定会传一个cid，因此这里可以放心取值
			const cid = finderEl.getAttribute("data-cid");
			if (cid) {
				const cachedFinder = this.finderCache.get(cid);
				if (cachedFinder) {
					this.finderViews.set(view, cachedFinder);
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
					ownerView: view,
				},
			});
			this.registerFinderEvent(view, finder);
			this.finderCache.set(cid, finder);
			this.finderViews.set(view, finder);
			const win = targetEl.ownerDocument?.defaultView;
			if (win) {
				const observer = new win.MutationObserver(() => finder.matchAgain(false));
				observer.observe(targetEl, { attributes: true, attributeFilter: ["data-mode"] });
				this.modeObservers.set(view, observer);
			}
			return finder;
		}
	}

	getEditorContext(view: MarkdownView): EditorContext | null {
		if (this.disposed) return null;
		let open = false;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view === view) open = true;
		});
		if (!open || view.getMode() !== "source") return null;
		const editor = view.editor;
		// Obsidian's Editor API does not expose its CodeMirror instance publicly.
		const editorView = (editor as unknown as { cm?: EditorView }).cm;
		if (!editorView) return null;
		return { view, editor, editorView, file: view.file, doc: editorView.state.doc };
	}

	isViewOpen(view: MarkdownView): boolean {
		if (this.disposed) return false;
		let open = false;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => { if (leaf.view === view) open = true; });
		return open;
	}

	canSearchReading(view: MarkdownView) {
		return this.isViewOpen(view) && view.getMode() === "preview" && ReadingSearch.supported(view);
	}

	getReadingSearch(view: MarkdownView) {
		let search = this.readingSearches.get(view);
		if (!search) {
			search = new ReadingSearch(view, () => this.isViewOpen(view), () => this.finderViews.get(view)?.matchAgain(false));
			this.readingSearches.set(view, search);
		}
		return search;
	}
	clearReadingSearch(view: MarkdownView) { this.readingSearches.get(view)?.clear(); }
	openNativeSearch(view: MarkdownView) {
		if (!this.isViewOpen(view)) return;
		this.finderViews.get(view)?.setVisible(false);
		view.showSearch();
	}

	private getCommandFinder(editor: Editor, info: MarkdownView | MarkdownFileInfo) {
		const view = info instanceof MarkdownView ? info : this.findViewForEditor(editor);
		return view && view.editor === editor && this.getEditorContext(view) ? this.getFinder(view) : null;
	}

	private findViewForEditor(editor: Editor): MarkdownView | null {
		let view: MarkdownView | null = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.editor === editor) view = leaf.view;
		});
		return view;
	}
	/**
	 * 销毁所有finder。在onunload的时候调用
	 */
	destoryAll() {
		this.disposed = true;
		this.readingSearches.forEach((search) => search.destroy());
		this.readingSearches.clear();
		this.modeObservers.forEach((observer) => observer.disconnect());
		this.modeObservers.clear();
		this.finderEvents.forEach((cleanup) => cleanup());
		this.finderEvents.clear();
		this.finderCache.forEach((finder) => {
			finder && finder.$destroy();
		});
		this.finderCache.clear();
		this.finderViews.clear();
	}

	/**
	 * 注册finder的事件
	 * @param mountEl 挂载的元素
	 * @param finder finder
	 */
	private registerFinderEvent(view: MarkdownView, finder: SearchBox) {
		const mountEl = view.containerEl;
		const listener = (e: KeyboardEvent) => {
			// press esc
			if (e.key == "Escape" && finder) {
				finder.closeFinder();
			}
		};
		mountEl.addEventListener("keydown", listener);
		this.finderEvents.set(view, () => mountEl.removeEventListener("keydown", listener));
	}
	private registerEvent() {
		const workspace = this.plugin.app.workspace;

		this.plugin.registerEvent(
			workspace.on(
				"active-leaf-change",
				(leaf: WorkspaceLeaf | null) => {
					if (!this.disposed && leaf?.view instanceof MarkdownView) {
						this.finderViews.get(leaf.view)?.matchAgain(false);
					}
				}
			)
		);

		this.plugin.registerEvent(
			workspace.on(
				"editor-change",
				(edt: Editor, info: MarkdownView | MarkdownFileInfo) => {
					if (this.disposed) return;
					const view = info instanceof MarkdownView ? info : this.findViewForEditor(edt);
					if (view?.editor === edt) this.finderViews.get(view)?.matchAgain(false);
				}
			)
		);
		// A leaf may open a different file without becoming active again.
		this.plugin.registerEvent(workspace.on("file-open", () => {
			if (this.disposed) return;
			this.finderViews.forEach((finder) => finder.matchAgain(false));
		}));
		this.plugin.registerEvent(workspace.on("css-change", () => {
			if (!this.disposed) this.readingSearches.forEach((search) => search.invalidate());
		}));
		this.plugin.registerEvent(workspace.on("layout-change", () => {
			if (this.disposed) return;
			this.finderViews.forEach((finder, view) => {
				if (this.isViewOpen(view)) finder.matchAgain(false);
				else {
					this.readingSearches.get(view)?.destroy();
					this.readingSearches.delete(view);
					this.modeObservers.get(view)?.disconnect();
					this.modeObservers.delete(view);
					this.finderEvents.get(view)?.();
					this.finderEvents.delete(view);
					finder.$destroy();
					this.finderViews.delete(view);
					this.finderCache.forEach((cached, cid) => { if (cached === finder) this.finderCache.delete(cid); });
				}
			});
		}));
	}

	private selectionText(view: MarkdownView): string | undefined {
		if (!this.plugin.settings.useSelectionAsSearch) return undefined;
		if (view.getMode() === "source") return view.editor.getSelection() || undefined;
		const root = view.previewMode.containerEl;
		const selection = root.ownerDocument.defaultView?.getSelection();
		if (!selection || !selection.rangeCount || !selection.anchorNode || !selection.focusNode
			|| !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return undefined;
		return selection.toString() || undefined;
	}

	private showFinder(view: MarkdownView) {
		const native = this.plugin.settings.useObsidianSearchInRead;
		if (view.getMode() === "preview" && (native || !this.canSearchReading(view))) {
			this.finderViews.get(view)?.setVisible(false);
			if (!native) new Notice(i18n.t("search.ReadingUnsupported"));
			view.showSearch();
			return;
		}
		this.getFinder(view).setVisible(true, this.selectionText(view));
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
					const previewCheck = mode === "preview";
					const sourceCheck = mode === "source";
					if (previewCheck || sourceCheck) {
						if (!checking) this.showFinder(view);
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
				const finder = this.getCommandFinder(editor, ctx);
				if (!finder) return;
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
			checkCallback: (checking) => this.finderCommand(checking, (finder) => finder.setVisible(false)),
		});

		plugin.addCommand({
			id: CMD.TOGGLE_FIND,
			name: i18n.t("commands.ToggleFind.name"),
			checkCallback: (checking) => {
				const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !this.isViewOpen(view)) return false;
				if (!checking) {
					const finder = this.finderViews.get(view);
					if (finder?.isVisible()) finder.setVisible(false);
					else this.showFinder(view);
				}
				return true;
			},
		});

		plugin.addCommand({
			id: CMD.TOGGLE_REPLACE,
			name: i18n.t("commands.ToggleReplace.name"),
			editorCallback: (editor, ctx) => {
				this.getCommandFinder(editor, ctx)?.toggleCollapse();
			},
		});

		plugin.addCommand({
			id: CMD.PREVIOUS_MATCH,
			name: i18n.t("commands.PreviousMatch.name"),
			checkCallback: (checking) => this.finderCommand(checking, (finder) => finder.toPreviousMatch()),
		});

		plugin.addCommand({
			id: CMD.NEXT_MATCH,
			name: i18n.t("commands.NextMatch.name"),
			checkCallback: (checking) => this.finderCommand(checking, (finder) => finder.toNextMatch()),
		});
		plugin.addCommand({
			id: CMD.REPLACE,
			name: i18n.t("commands.Replace.name"),
			editorCallback: (editor, ctx) => {
				const finder = this.getCommandFinder(editor, ctx);
				if (!finder) return;
				finder.replaceMatchedText(finder.getSearchCache().replace);
			},
		});
		plugin.addCommand({
			id: CMD.REPLACE_ALL,
			name: i18n.t("commands.ReplaceAll.name"),
			editorCallback: (editor, ctx) => {
				const finder = this.getCommandFinder(editor, ctx);
				if (!finder) return;
				finder.replaceAllMatchedText(finder.getSearchCache().replace);
			},
		});
		plugin.addCommand({
			id: "show-search-history",
			name: i18n.t("commands.ShowSearchHistory.name"),
			callback: () => {
				new HistoryModal(plugin.app, plugin).open();
			},
		});
	}

	private finderCommand(checking: boolean, action: (finder: SearchBox) => void): boolean {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !this.isViewOpen(view)) return false;
		if (!checking) action(this.getFinder(view));
		return true;
	}
}

export function editorExtensionProvider(plugin: TextFinderPlugin) {
	const workspace = plugin.app.workspace;

	workspace.onLayoutReady(() => {
		plugin.editorSearch = new EditorSearch(plugin);

		plugin.registerEditorExtension([textMatchMarker]);
	});
}
