import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { i18n } from "./i18n";
import { editorExtensionProvider } from "./editor-extension";

interface PluginSettings {
	/**
	 * 隐藏窗口时清空输入项
	 */
	clearAfterHidden: boolean;
	/**
	 * 展示窗口时选中搜索框的文本
	 */
	selectWhenDisplay: boolean;
	/**
	 * 启用输入框的快捷键
	 */
	enableInputHotkeys: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	clearAfterHidden: false,
	selectWhenDisplay: true,
	enableInputHotkeys: false,
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
		new Setting(containerEl)
			.setName("Select When Display")
			.setDesc("Select when display.")
			.addToggle((cb) => {
				cb.setValue(pluginSetting.selectWhenDisplay).onChange(
					async (value: boolean) => {
						pluginSetting.selectWhenDisplay = value;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName("Enable Input Hotkeys")
			.setDesc("Enable input hotkeys")
			.addToggle((cb) => {
				cb.setValue(pluginSetting.enableInputHotkeys).onChange(
					async (value: boolean) => {
						pluginSetting.enableInputHotkeys = value;
						await this.plugin.saveSettings();
					}
				);
			});
	}
}
