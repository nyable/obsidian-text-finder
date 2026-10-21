import { App, PluginSettingTab } from "obsidian";
import type { PluginRuntimeHost } from "./plugin-host";
import { SettingsController } from "../features/settings";
import { SettingsView } from "../features/settings/ui";

/** Host-owned shell; rendering and update policies belong to settings. */
export class SettingTab extends PluginSettingTab {
	private view: SettingsView;
	constructor(app: App, plugin: PluginRuntimeHost) {
		super(app, plugin);
		const commands = new SettingsController(() => plugin.settings, {
			save: () => plugin.requestSaveSettings(),
			historyChanged: () => plugin.history.notify(),
			resizeHistory: (limit) => plugin.history.resize(limit),
			refreshToolbars: () => plugin.editorSearch?.refreshToolbars(),
			syncFloatingEntries: () => plugin.editorSearch?.syncFloatingEntries(),
			refreshAppearance: () => plugin.refreshAppearance(),
			replacementPreferencesChanged: () =>
				plugin.editorSearch?.replacementPreferencesChanged(),
		});
		this.view = new SettingsView(this.containerEl, commands, (doc) =>
			plugin.ensureAppearanceDocument(doc),
		);
	}
	/** Use the same five-tab view on every supported host; no per-setting search index. */
	display(): void {
		this.view.display();
	}
	hide(): void {
		this.view.hide();
	}
}
