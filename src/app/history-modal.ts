import { Modal, App } from "obsidian";
import { HistoryPanel } from "../features/history/ui";
import { mountView, type MountedView } from "../shared/ui/mount-view";
import type { PluginRuntimeHost } from "./plugin-host";
import type { HistoryView } from "../features/history";

export class HistoryModal extends Modal {
	plugin: PluginRuntimeHost;
	component: MountedView<Record<string, unknown>> | undefined;

	constructor(
		app: App,
		plugin: PluginRuntimeHost,
		private closed: () => void = () => {},
	) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Fix double scrollbar issue
		contentEl.style.overflow = "hidden";
		contentEl.style.display = "flex";
		contentEl.style.flexDirection = "column";
		contentEl.style.height = "100%";
		contentEl.style.padding = "0"; // The Vue view owns the content padding.

		const view: HistoryView = {
			preferences: () => this.plugin.settings,
			controller: this.plugin.history,
			reuse: (text) =>
				this.plugin.editorSearch?.getFinder().setVisibleFromHistory(text) ?? false,
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
		});
	}

	onClose() {
		if (this.component) {
			this.component.destroy();
			this.component = undefined;
		}
		const { contentEl } = this;
		contentEl.empty();
		this.closed();
	}
}
