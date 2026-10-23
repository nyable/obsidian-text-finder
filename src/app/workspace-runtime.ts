import type { PluginRuntimeHost } from "./plugin-host";
import type { EditorContext } from "../platform/codemirror/editor-context";
import {
	CLS,
	textMatchMarker,
	searchScopeField,
	searchScopeDecoration,
} from "../platform/codemirror/search-highlight";
import { Editor, MarkdownView, Notice, Menu, WorkspaceLeaf, type MarkdownFileInfo } from "obsidian";
import {
	mountFinder,
	createCompositionInput,
	type Finder as SearchBox,
} from "../features/finder/ui";
import { i18n } from "../i18n";
import { generateUniqueId } from "../shared/lifecycle/unique-id";
import { HistoryModal } from "./history-modal";
import { ReadingSearch } from "../features/reading";
import { MatchEngine } from "../platform/browser/match-engine";
import { captureReadingSelection, ReadingSelectionTracker } from "../features/reading";
import { OwnerRegistry } from "./owner-registry";
import { Disposables } from "../shared/lifecycle/disposables";
import { createFinderEditor } from "../platform/codemirror/finder-editor";
import { createFinderHost } from "./create-finder-host";
import { registerWorkspaceCommands } from "./workspace-commands";
import { capturePreviewBody } from "../platform/obsidian/preview-renderer";
import { eventMenuFor } from "../platform/obsidian/event-menu";
import { editorContextFor } from "../platform/obsidian/editor-context";
import type { SearchRecipe } from "../features/presets";

export { CLS, searchCacheEffect } from "../platform/codemirror/search-highlight";

export { CMD } from "./workspace-commands";

interface OwnerResources {
	finder?: SearchBox;
	reading?: ReadingSearch;
	matcher?: MatchEngine;
	modeObserver?: MutationObserver;
	removeFinderEvents?: () => void;
	entryPath?: string;
	selection?: ReadingSelectionTracker;
	menu?: { root: HTMLElement; cleanup: () => void };
}

export class EditorSearch {
	plugin: PluginRuntimeHost;
	// Finder resources are owned by their Markdown view and released on leaf close.
	private owners = new OwnerRegistry<MarkdownView, OwnerResources>(
		() => ({}),
		(owner) => {
			const scope = new Disposables();
			scope.add(() => owner.finder?.destroy());
			scope.add(() => owner.removeFinderEvents?.());
			scope.add(() => owner.modeObserver?.disconnect());
			scope.add(() => owner.reading?.destroy());
			scope.add(() => owner.matcher?.destroy());
			scope.add(() => owner.selection?.destroy());
			scope.add(() => owner.menu?.cleanup());
			scope.dispose();
		},
	);
	private disposed = false;
	private historyModals = new Set<HistoryModal>();
	private populatedMenus = new WeakMap<Menu, Set<string>>();
	private openMenus = new Set<Menu>();
	private syncReadingSelections() {
		if (this.disposed) return;
		const open = new Set<MarkdownView>();
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView) || leaf.view.getMode() !== "preview") return;
			const view = leaf.view,
				root = view.previewMode?.containerEl;
			if (!root) return;
			open.add(view);
			const resources = this.owners.ensure(view);
			const tracker =
				resources.selection ?? (resources.selection = new ReadingSelectionTracker());
			tracker.connect(root, view.file, view.getViewData?.(), view.previewMode);
			this.connectReadingMenu(view, root);
		});
		for (const [view, resources] of this.owners.entries()) {
			if (open.has(view)) continue;
			resources.selection?.destroy();
			delete resources.selection;
			resources.menu?.cleanup();
			delete resources.menu;
		}
	}
	private connectReadingMenu(view: MarkdownView, root: HTMLElement) {
		const resources = this.owners.ensure(view);
		const old = resources.menu;
		if (old?.root === root) return;
		old?.cleanup();
		const listener = (event: MouseEvent) => {
			if (view.getMode() !== "preview" || !this.isViewOpen(view)) return;
			const target = event.target as Node | null;
			const element = target?.nodeType === 1 ? (target as Element) : target?.parentElement;
			const preview = capturePreviewBody(view);
			const body = preview?.body;
			const excluded =
				"input, textarea, button, select, [contenteditable=true], .internal-embed, .markdown-embed, .metadata-container, .frontmatter, .mod-header, .mod-footer, script, style, svg, canvas, iframe, mjx-container, .mermaid, .math, .block-language-dataview, .block-language-dataviewjs, [hidden], [aria-hidden=true]";
			if (
				!preview ||
				!body ||
				typeof body.contains !== "function" ||
				!target ||
				!body.contains(target) ||
				element?.closest(excluded)
			)
				return;
			const link = element?.closest("a.internal-link, a.external-link");
			// Known host link handlers use the shared event menu. For unrelated
			// consumed events, leave another control/plugin's menu alone.
			if (event.defaultPrevented && !link) return;
			const selection = captureReadingSelection(body);
			if (!selection) return;
			if (
				selection.some((range) =>
					[range.start.node, range.end.node].some((node) =>
						(node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest(
							excluded,
						),
					),
				)
			)
				return;
			const text = body.ownerDocument.defaultView?.getSelection()?.toString();
			if (!text) return;
			const tracker = this.owners.get(view)?.selection,
				stamp = tracker?.stamp();
			const source = view.getViewData?.();
			const current = this.menuOwner(view);
			const valid = () =>
				current() &&
				preview.current() &&
				view.getViewData?.() === source &&
				tracker?.stamp() === stamp &&
				selection.every((r) => body.contains(r.start.node) && body.contains(r.end.node));
			const menu = eventMenuFor(event);
			if (!menu) return;
			this.selectionMenu(menu, view, text, valid, () =>
				this.getFinder(view).findInCapturedSelection(selection),
			);
			// Joining an event menu suppresses the browser's default menu. Plain
			// body text has no host link menu, so retain a selection-copy action.
			if (!link && this.markMenu(menu, "copy"))
				menu.addItem((item) =>
					item
						.setTitle(i18n.t("search.menu.CopySelection"))
						.setIcon("copy")
						.setSection("clipboard")
						.onClick(async () => {
							if (this.disposed) return;
							try {
								const clipboard =
									body.ownerDocument.defaultView?.navigator.clipboard;
								if (!clipboard) throw new Error("Clipboard unavailable");
								await clipboard.writeText(text);
							} catch {
								if (!this.disposed) new Notice(i18n.t("search.menu.CopyFailed"));
							}
						}),
				);
		};
		root.addEventListener("contextmenu", listener);
		resources.menu = { root, cleanup: () => root.removeEventListener("contextmenu", listener) };
	}
	private menuOwner(view: MarkdownView) {
		const file = view.file,
			mode = view.getMode(),
			doc = view.containerEl?.ownerDocument;
		return () =>
			this.isViewOpen(view) &&
			view.file === file &&
			view.getMode() === mode &&
			view.containerEl?.ownerDocument === doc;
	}
	private markMenu(menu: Menu, key: string) {
		let keys = this.populatedMenus.get(menu);
		if (!keys) {
			keys = new Set();
			this.populatedMenus.set(menu, keys);
			this.openMenus.add(menu);
			menu.onHide(() => this.openMenus.delete(menu));
		}
		if (keys.has(key)) return false;
		keys.add(key);
		return true;
	}
	private selectionMenu(
		menu: Menu,
		view: MarkdownView,
		text: string,
		valid: () => boolean,
		scope: () => unknown,
	) {
		if (!this.markMenu(menu, "selection")) return;
		const run = (action: () => unknown) => {
			if (!valid()) {
				if (!this.disposed) new Notice(i18n.t("search.menu.SelectionChanged"));
				return;
			}
			action();
		};
		menu.addItem((item) =>
			item
				.setTitle(i18n.t("search.menu.FindSelectedText"))
				.setIcon("search")
				.setSection("selection")
				.onClick(() => run(() => this.showSelectedText(view, text))),
		);
		menu.addItem((item) =>
			item
				.setTitle(i18n.t("search.menu.FindInSelection"))
				.setIcon("text-select")
				.setSection("selection")
				.onClick(() => run(scope)),
		);
	}
	private showSelectedText(view: MarkdownView, text: string) {
		if (this.activateFloatingFinder(view)) this.getFinder(view).findSelectedText(text);
		else {
			// Shape-checked DOM bridge: showSearch has opened the owner native
			// control. Do not use activeWindow or borrow another pane's input.
			const input = view.previewMode.containerEl.querySelector<HTMLInputElement>(
				".document-search-input input",
			);
			const win = input?.ownerDocument.defaultView;
			if (input && win) {
				input.value = text;
				input.dispatchEvent(new win.Event("input", { bubbles: true }));
				input.select();
			} else new Notice(i18n.t("search.menu.NativeQueryUnavailable"));
		}
	}
	getReadingSelection(view: MarkdownView) {
		this.syncReadingSelections();
		return (
			this.owners
				.get(view)
				?.selection?.get(
					view.previewMode.containerEl,
					view.file,
					view.getViewData?.(),
					view.previewMode,
				) ?? null
		);
	}

	constructor(plugin: PluginRuntimeHost) {
		this.plugin = plugin;
		this.registerEvent();
		this.registerCommand();
		this.syncFloatingEntries();
	}

	/** Apply the opening default once per owner/file, not on every activation. */
	syncFloatingEntries() {
		if (this.disposed || !this.plugin.settings?.showFloatingFinderOnOpen) return;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) return;
			const path = view.file.path;
			if (this.owners.get(view)?.entryPath === path) return;
			try {
				const finder = this.getFinder(view);
				if (!finder.isVisible()) finder.showFloatingEntry();
				this.owners.ensure(view).entryPath = path;
			} catch (error) {
				this.plugin.reportError("history.SubscriberFailed", error);
			}
		});
	}

	/**
	 * 获取Finder组件,如果不存在则创建
	 * @returns SearchBox
	 */
	getFinder(view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView)): SearchBox {
		if (this.disposed) throw new Error("Text Finder is disposed");
		if (!view) {
			throw new Error(
				"Get Text-Finder Error: plugin.app.workspace.getActiveViewOfType(MarkdownView) is null",
			);
		}
		const resources = this.owners.ensure(view);
		const existing = resources.finder;
		if (existing) return existing;
		const targetEl = view.containerEl;
		const finderEl = targetEl.querySelector(`.${CLS.FINDER}`);
		if (finderEl) {
			finderEl.remove();
			throw new Error("Text Finder: unowned Finder root found in Markdown view");
		} else {
			const cid = generateUniqueId();
			const finder = mountFinder(targetEl, {
				editor: createFinderEditor(
					() => this.getEditorContext(view),
					() => this.plugin.app.vault,
					() => view.file,
				),
				host: createFinderHost(this, view),
				cid: cid,
				owner: targetEl,
			});
			this.registerFinderEvent(view, finder);
			resources.finder = finder;
			const win = targetEl.ownerDocument?.defaultView;
			if (win) {
				const observer = new win.MutationObserver(() => {
					this.syncReadingSelections();
					finder.matchAgain(false);
				});
				observer.observe(targetEl, { attributes: true, attributeFilter: ["data-mode"] });
				resources.modeObserver = observer;
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
		return editorContextFor(view);
	}

	isViewOpen(view: MarkdownView): boolean {
		if (this.disposed) return false;
		let open = false;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view === view) open = true;
		});
		return open;
	}

	canSearchReading(view: MarkdownView) {
		return (
			this.isViewOpen(view) && view.getMode() === "preview" && ReadingSearch.supported(view)
		);
	}

	getReadingSearch(view: MarkdownView) {
		const resources = this.owners.ensure(view);
		let search = resources.reading;
		if (!search) {
			search = new ReadingSearch(
				view,
				() => this.isViewOpen(view),
				() => this.owners.get(view)?.finder?.matchAgain(false),
				5000,
				this.createMatchEngine(view),
			);
			resources.reading = search;
		}
		return search;
	}
	private createMatchEngine(view: MarkdownView) {
		return new MatchEngine(
			() =>
				this.isViewOpen(view)
					? (view.containerEl?.ownerDocument.defaultView ?? null)
					: null,
			(error) => {
				console.warn(
					"Text Finder: Worker unavailable before query submission; using synchronous compatibility mode",
					error,
				);
				new Notice(i18n.t("search.WorkerCompatibility"));
			},
		);
	}
	getMatchEngine(view: MarkdownView) {
		const resources = this.owners.ensure(view);
		let engine = resources.matcher;
		if (!engine) {
			engine = this.createMatchEngine(view);
			resources.matcher = engine;
		}
		return engine;
	}
	clearReadingSearch(view: MarkdownView) {
		this.owners.get(view)?.reading?.clear();
	}
	refreshToolbars() {
		for (const [, resources] of this.owners.entries()) {
			try {
				resources.finder?.refreshToolbar();
			} catch (error) {
				this.plugin.reportError("history.SubscriberFailed", error);
			}
		}
	}
	replacementPreferencesChanged() {
		for (const [, resources] of this.owners.entries()) {
			try {
				resources.finder?.replacementPreferencesChanged();
			} catch (error) {
				this.plugin.reportError("history.SubscriberFailed", error);
			}
		}
	}
	openHistory(tab: "history" | "presets" = "history", recipe?: SearchRecipe) {
		if (this.disposed) return;
		const modal = new HistoryModal(
			this.plugin.app,
			this.plugin,
			() => this.historyModals.delete(modal),
			{ tab, recipe },
		);
		this.historyModals.add(modal);
		modal.open();
	}
	openNativeSearch(view: MarkdownView) {
		if (!this.isViewOpen(view)) return;
		this.owners.get(view)?.finder?.setVisible(false);
		view.showSearch();
	}

	private getCommandFinder(editor: Editor, info: MarkdownView | MarkdownFileInfo) {
		const view = info instanceof MarkdownView ? info : this.findViewForEditor(editor);
		return view && view.editor === editor && this.getEditorContext(view)
			? this.getFinder(view)
			: null;
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
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const scope = new Disposables();
		scope.add(() => this.owners.dispose());
		for (const modal of this.historyModals) scope.add(() => modal.close(true));
		for (const menu of this.openMenus) scope.add(() => menu.hide());
		this.openMenus.clear();
		this.historyModals.clear();
		scope.dispose();
	}

	/**
	 * 注册finder的事件
	 * @param mountEl 挂载的元素
	 * @param finder finder
	 */
	private registerFinderEvent(view: MarkdownView, finder: SearchBox) {
		const mountEl = view.containerEl;
		const composition = createCompositionInput();
		const tracker = composition.track(mountEl);
		const listener = (e: KeyboardEvent) => {
			// press esc
			if (
				e.key === "Escape" &&
				!e.defaultPrevented &&
				!composition.isComposing(e) &&
				!e.altKey &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.shiftKey &&
				finder.isVisible()
			) {
				e.preventDefault();
				finder.closeFinder();
			}
		};
		mountEl.addEventListener("keydown", listener);
		this.owners.ensure(view).removeFinderEvents = () => {
			mountEl.removeEventListener("keydown", listener);
			tracker.destroy();
		};
	}
	private registerEvent() {
		const workspace = this.plugin.app.workspace;
		workspace.onLayoutReady?.(() => this.syncReadingSelections());
		this.plugin.registerEvent(
			workspace.on("file-menu", (menu, file, source, leaf) => {
				const view = leaf?.view;
				if (
					source !== "more-options" ||
					!(view instanceof MarkdownView) ||
					view.file !== file ||
					!this.isViewOpen(view)
				)
					return;
				if (!this.markMenu(menu, "open")) return;
				const valid = this.menuOwner(view);
				menu.addItem((item) =>
					item
						.setTitle(i18n.t("search.menu.OpenFind"))
						.setIcon("search")
						.setSection("find")
						.onClick(() => {
							if (valid()) this.showFinder(view);
						}),
				);
			}),
		);
		this.plugin.registerEvent(
			workspace.on("editor-menu", (menu, editor, info) => {
				const view = info instanceof MarkdownView ? info : this.findViewForEditor(editor);
				if (!view || view.editor !== editor || (info.file && info.file !== view.file))
					return;
				const context = this.getEditorContext(view),
					text = editor.getSelection();
				if (!context || !text) return;
				const ranges = context.editorView.state.selection.ranges
					.filter((r) => !r.empty)
					.map(({ from, to }) => ({ from, to }));
				if (!ranges.length) return;
				const current = this.menuOwner(view);
				const valid = () => {
					const next = this.getEditorContext(view);
					return (
						current() &&
						next?.editorView === context.editorView &&
						next.doc === context.doc
					);
				};
				this.selectionMenu(menu, view, text, valid, () =>
					this.getFinder(view).findInCapturedSelection(ranges),
				);
			}),
		);

		this.plugin.registerEvent(
			workspace.on("active-leaf-change", (leaf: WorkspaceLeaf | null) => {
				if (!this.disposed && leaf?.view instanceof MarkdownView) {
					this.syncReadingSelections();
					this.syncFloatingEntries();
					this.owners.get(leaf.view)?.finder?.matchAgain(false);
				}
			}),
		);

		this.plugin.registerEvent(
			workspace.on("editor-change", (edt: Editor, info: MarkdownView | MarkdownFileInfo) => {
				if (this.disposed) return;
				const view = info instanceof MarkdownView ? info : this.findViewForEditor(edt);
				if (view?.editor === edt) this.owners.get(view)?.finder?.matchAgain(false);
			}),
		);
		// A leaf may open a different file without becoming active again.
		this.plugin.registerEvent(
			workspace.on("file-open", () => {
				if (this.disposed) return;
				this.syncReadingSelections();
				this.syncFloatingEntries();
				for (const [, resources] of this.owners.entries())
					resources.finder?.matchAgain(false);
			}),
		);
		this.plugin.registerEvent(
			workspace.on("css-change", () => {
				if (!this.disposed)
					for (const [, resources] of this.owners.entries())
						resources.reading?.invalidate();
			}),
		);
		this.plugin.registerEvent(
			workspace.on("layout-change", () => {
				if (this.disposed) return;
				this.syncReadingSelections();
				this.syncFloatingEntries();
				for (const [view, resources] of this.owners.entries()) {
					if (this.isViewOpen(view)) resources.finder?.matchAgain(false);
					else this.owners.remove(view);
				}
			}),
		);
	}

	private selectionText(view: MarkdownView): string | undefined {
		if (!this.plugin.settings.useSelectionAsSearch) return undefined;
		if (view.getMode() === "source") return view.editor.getSelection() || undefined;
		const root = view.previewMode.containerEl;
		const selection = root.ownerDocument.defaultView?.getSelection();
		if (
			!selection ||
			!selection.rangeCount ||
			!selection.anchorNode ||
			!selection.focusNode ||
			!root.contains(selection.anchorNode) ||
			!root.contains(selection.focusNode)
		)
			return undefined;
		return selection.toString() || undefined;
	}

	/** Shared by explicit find commands and clicks on automatic entries. */
	activateFloatingFinder(view: MarkdownView): boolean {
		if (!this.isViewOpen(view)) return false;
		if (view.getMode() === "preview" && !this.canSearchReading(view)) {
			this.owners.get(view)?.finder?.setVisible(false);
			new Notice(i18n.t("search.ReadingUnsupported"));
			view.showSearch();
			return false;
		}
		return true;
	}
	private showFinder(view: MarkdownView) {
		if (!this.activateFloatingFinder(view)) return;
		const finder = this.getFinder(view);
		finder.setVisible(
			true,
			finder.isDocked() || finder.hasSelectionScope?.()
				? undefined
				: this.selectionText(view),
		);
	}

	private registerCommand() {
		const { plugin } = this;
		registerWorkspaceCommands({
			addCommand: (command) => plugin.addCommand(command),
			activeView: () => plugin.app.workspace.getActiveViewOfType(MarkdownView),
			isOpen: (view) => this.isViewOpen(view),
			finder: (view) => this.getFinder(view),
			existingFinder: (view) => this.owners.get(view)?.finder,
			editorFinder: (editor, info) => this.getCommandFinder(editor, info),
			useSelection: () => plugin.settings.useSelectionAsSearch,
			showFinder: (view) => this.showFinder(view),
			openHistory: () => this.openHistory(),
			openPresets: () => this.openHistory("presets"),
			savePreset: (view) => this.openHistory("presets", this.getFinder(view).captureRecipe()),
			reportError: (error) => plugin.reportError("search.EditorFailed", error),
		});
	}
}

export function editorExtensionProvider(plugin: PluginRuntimeHost) {
	const workspace = plugin.app.workspace;

	workspace.onLayoutReady(() => {
		if (plugin.isUnloaded() || plugin.editorSearch) return;
		plugin.editorSearch = new EditorSearch(plugin);

		plugin.registerEditorExtension([textMatchMarker, searchScopeField, searchScopeDecoration]);
	});
}
