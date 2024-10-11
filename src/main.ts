import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { i18n } from "./i18n";
import { editorExtensionProvider } from "./editor-extension";

interface PluginSettings {
	/**
	 * 隐藏窗口时清空输入项
	 */
	clearAfterHidden: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	clearAfterHidden: false,
};

export default class TextFinderPlugin extends Plugin {
	settings!: PluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		this.registerEditorExtension(editorExtensionProvider(this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: TextFinderPlugin;

	constructor(app: App, plugin: TextFinderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h1", {
			text: `${i18n.t("plugin.name")} ${this.plugin.manifest.version}`,
		});

		const pluginSetting = this.plugin.settings;
		new Setting(containerEl)
			.setName("Clear Input")
			.setDesc("Clear input when hidden.")
			.addToggle((cb) => {
				cb.setValue(pluginSetting.clearAfterHidden).onChange(
					async (value: boolean) => {
						pluginSetting.clearAfterHidden = value;
						await this.plugin.saveSettings();
					}
				);
			});
	}
}
