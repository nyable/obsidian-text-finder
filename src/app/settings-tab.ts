import { App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type { PluginRuntimeHost } from "./plugin-host";
import { SettingsController } from "../features/settings";
import { SettingsView, SettingsDefinitions } from "../features/settings/ui";

/** Host-owned shell; rendering and update policies belong to settings. */
export class SettingTab extends PluginSettingTab {
	private view: SettingsView;
	private definitions: SettingsDefinitions;
	constructor(app: App, plugin: PluginRuntimeHost) {
		super(app, plugin);
		const commands = new SettingsController(() => plugin.settings, {
			save: () => plugin.requestSaveSettings(),
			historyChanged: () => plugin.history.notify(),
			resizeHistory: (limit) => plugin.history.resize(limit),
			refreshToolbars: () => plugin.editorSearch?.refreshToolbars(),
			syncFloatingEntries: () => plugin.editorSearch?.syncFloatingEntries(),
			refreshAppearance: () => plugin.refreshAppearance(),
		});
		this.view = new SettingsView(this.containerEl, commands, (doc) =>
			plugin.ensureAppearanceDocument(doc),
		);
		this.definitions = new SettingsDefinitions(commands, (doc) =>
			plugin.ensureAppearanceDocument(doc),
		);
	}
	/** 1.13+ indexes/renders definitions; older hosts still call display(). */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.definitions.items();
	}
	display(): void {
		this.view.display();
	}
	hide(): void {
		this.definitions.hide();
		this.view.hide();
	}
}
