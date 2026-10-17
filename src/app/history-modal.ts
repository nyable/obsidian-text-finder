import { Modal, App, MarkdownView } from "obsidian";
import { HistoryPanel } from "../features/history/ui";
import { mountView } from "../shared/ui/mount-view";
import type { PluginRuntimeHost } from "./plugin-host";
import type { HistoryView } from "../features/history";
import type { SearchRecipe } from "../features/presets";

export class HistoryModal extends Modal {
	plugin: PluginRuntimeHost;
	component: ReturnType<typeof mountView> | undefined;
	private focusAppliedFinder: (() => void) | undefined;

	constructor(
		app: App,
		plugin: PluginRuntimeHost,
		private closed: () => void = () => {},
		private options: { tab?: "history" | "presets"; recipe?: SearchRecipe | undefined } = {},
	) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.classList.add("nya-library-host");

		// Fix double scrollbar issue
		contentEl.style.overflow = "hidden";
		contentEl.style.display = "flex";
		contentEl.style.flexDirection = "column";
		contentEl.style.height = "100%";
		contentEl.style.padding = "0"; // The Vue view owns the content padding.

		const view: HistoryView = {
			preferences: () => this.plugin.settings,
			controller: this.plugin.history,
			presets: this.plugin.presets,
			capture: () => {
				const owner = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
				return owner
					? (this.plugin.editorSearch?.getFinder().captureRecipe() ?? null)
					: null;
			},
			apply: (recipe) => {
				const finder = this.plugin.editorSearch?.getFinder();
				if (!finder?.applyRecipe(recipe)) return false;
				this.focusAppliedFinder = () => finder.focusSearch();
				return true;
			},
			reading: () =>
				this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() ===
				"preview",
			reuse: (text) => {
				const finder = this.plugin.editorSearch?.getFinder();
				if (!finder?.setVisibleFromHistory(text)) return false;
				this.focusAppliedFinder = () => finder.focusSearch();
				return true;
			},
			copy: (text) => {
				const clipboard = contentEl.ownerDocument.defaultView?.navigator.clipboard;
				return clipboard
					? clipboard.writeText(text)
					: Promise.reject(new Error("Clipboard unavailable"));
			},
			isDisposed: () => this.plugin.isUnloaded(),
			reportError: (key, error) => this.plugin.reportError(key, error),
		};
		this.component = mountView(HistoryPanel, contentEl, {
			view,
			close: () => this.close(),
			initialTab: this.options.tab,
			initialRecipe: this.options.recipe,
		});
	}
	close(force = false) {
		const exposed = this.component?.exposed as { canClose?: () => boolean } | undefined;
		if (!force && !this.plugin.isUnloaded() && exposed?.canClose?.() === false) return;
		super.close();
	}

	onClose() {
		if (this.component) {
			this.component.destroy();
			this.component = undefined;
		}
		const { contentEl } = this;
		contentEl.empty();
		this.closed();
		// The host may restore its pre-modal focus while closing. Request Finder
		// focus afterwards, without a second match or borrowing the active pane.
		if (!this.plugin.isUnloaded()) this.focusAppliedFinder?.();
		this.focusAppliedFinder = undefined;
	}
}
