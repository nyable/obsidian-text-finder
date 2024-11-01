import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { i18n } from "./i18n";
import { editorExtensionProvider } from "./editor-extension";

interface PluginSettings {
	/**
	 * 隐藏窗口时清空输入项
	 */
	clearAfterHidden: boolean;
	/**
	 * 启用输入框的快捷键
	 */
	enableInputHotkeys: boolean;
	/**
	 * 在搜索启用时,强制进入source模式.在退出后,根据是否开启预览模式切换
	 */
	sourceModeWhenSearch: boolean;
	/**
	 * 是否移动光标至匹配项
	 */
	moveCursorToMatch: boolean;
	/**
	 * 是否使用选中文本作为搜索文本
	 */
	useSelectionAsSearch: boolean;
	/**
	 * 在阅读模式下,命令会调用Obsidian的搜索
	 */
	useObsidianSearchInRead: boolean;
	/**
	 * 在替换框中支持部分转义字符串:\n \t
	 */
	useEscapeCharInReplace: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	clearAfterHidden: false,
	enableInputHotkeys: true,
	sourceModeWhenSearch: true,
	moveCursorToMatch: true,
	useSelectionAsSearch: true,
	useObsidianSearchInRead: true,
	useEscapeCharInReplace: true,
};

export default class TextFinderPlugin extends Plugin {
	settings!: PluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		editorExtensionProvider(this);
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

		const pluginSetting = this.plugin.settings;
		new Setting(containerEl)
			.setName(i18n.t("settings.ClearAfterHidden.name"))
			.setDesc(i18n.t("settings.ClearAfterHidden.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.clearAfterHidden).onChange(
					async (value: boolean) => {
						pluginSetting.clearAfterHidden = value;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.EnableInputHotkeys.name"))
			.setDesc(i18n.t("settings.EnableInputHotkeys.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.enableInputHotkeys).onChange(
					async (value: boolean) => {
						pluginSetting.enableInputHotkeys = value;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.SourceModeWhenSearch.name"))
			.setDesc(i18n.t("settings.SourceModeWhenSearch.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.sourceModeWhenSearch).onChange(
					async (value: boolean) => {
						pluginSetting.sourceModeWhenSearch = value;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.MoveCursorToMatch.name"))
			.setDesc(i18n.t("settings.MoveCursorToMatch.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.moveCursorToMatch).onChange(
					async (value: boolean) => {
						pluginSetting.moveCursorToMatch = value;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.UseSelectionAsSearch.name"))
			.setDesc(i18n.t("settings.UseSelectionAsSearch.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.useSelectionAsSearch).onChange(
					async (value: boolean) => {
						pluginSetting.useSelectionAsSearch = value;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.UseObsidianSearchInRead.name"))
			.setDesc(
				i18n.t("settings.UseObsidianSearchInRead.desc", {
					name:
						i18n.t("plugin.name") +
						": " +
						i18n.t("commands.ShowFind.name"),
				})
			)
			.addToggle((cb) => {
				cb.setValue(pluginSetting.useObsidianSearchInRead).onChange(
					async (value: boolean) => {
						pluginSetting.useObsidianSearchInRead = value;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.UseEscapeCharInReplace.name"))
			.setDesc(i18n.t("settings.UseEscapeCharInReplace.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.useEscapeCharInReplace).onChange(
					async (value: boolean) => {
						pluginSetting.useEscapeCharInReplace = value;
						await this.plugin.saveSettings();
					}
				);
			});
	}
}
