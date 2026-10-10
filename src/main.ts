import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { i18n } from "./i18n";
import { editorExtensionProvider, EditorSearch } from "./editor-extension";
import { HistorySortOrder, type HistorySortOrderType } from "./constants";
import { HistoryController, parseHistoryLimit } from "./history";
import { defaultSettings, normalizeSettings, type PluginSettings } from "./settings";
import { SaveQueue } from "./save-queue";

export type { SearchHistoryItem } from "./history";

export default class TextFinderPlugin extends Plugin {
	settings!: PluginSettings;
	history = new HistoryController(() => this.settings, () => this.saveSettings());
	private saveQueue = new SaveQueue<PluginSettings>((snapshot) => this.saveData(snapshot));
	private storageReadable = false;
	private lastErrorNotice = -Infinity;
	editorSearch: EditorSearch | null = null;
	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		editorExtensionProvider(this);
	}
	onunload() {
		// 在取消加载插件的时候销毁finder的svelte组件,不然重复开关会重复创建,虽然没有影响
		this.editorSearch?.destoryAll();
	}
	async loadSettings() {
		let raw: unknown;
		try {
			raw = await this.loadData();
			this.storageReadable = true;
		} catch (error) {
			this.storageReadable = false;
			this.settings = defaultSettings();
			this.history.notify();
			this.reportError("history.LoadFailed", error);
			return;
		}
		const { settings, changed } = normalizeSettings(raw);
		this.settings = settings;
		this.history.notify();
		if (changed) await this.saveSettings().catch(() => {});
	}

	async saveSettings() {
		try {
			if (!this.storageReadable) throw new Error("Settings were not read successfully; refusing to overwrite stored data");
			await this.saveQueue.enqueue(this.settings);
		} catch (error) {
			this.reportError(this.storageReadable ? "history.SaveFailed" : "history.LoadFailed", error);
			throw error;
		}
	}
	flushSettings() { return this.saveQueue.flush(); }
	requestSaveSettings() { void this.saveSettings().catch(() => {}); }
	reportError(key: string, error: unknown) {
		console.error(`Text Finder: ${key}`, error);
		const now = Date.now();
		if (now - this.lastErrorNotice >= 5000) {
			this.lastErrorNotice = now;
			new Notice(i18n.t(key));
		}
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
					(value: boolean) => {
						pluginSetting.clearAfterHidden = value;
						this.plugin.requestSaveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.EnableInputHotkeys.name"))
			.setDesc(i18n.t("settings.EnableInputHotkeys.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.enableInputHotkeys).onChange(
					(value: boolean) => {
						pluginSetting.enableInputHotkeys = value;
						this.plugin.requestSaveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.SourceModeWhenSearch.name"))
			.setDesc(i18n.t("settings.SourceModeWhenSearch.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.sourceModeWhenSearch).onChange(
					(value: boolean) => {
						pluginSetting.sourceModeWhenSearch = value;
						this.plugin.requestSaveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.MoveCursorToMatch.name"))
			.setDesc(i18n.t("settings.MoveCursorToMatch.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.moveCursorToMatch).onChange(
					(value: boolean) => {
						pluginSetting.moveCursorToMatch = value;
						this.plugin.requestSaveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.UseSelectionAsSearch.name"))
			.setDesc(i18n.t("settings.UseSelectionAsSearch.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.useSelectionAsSearch).onChange(
					(value: boolean) => {
						pluginSetting.useSelectionAsSearch = value;
						this.plugin.requestSaveSettings();
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
					(value: boolean) => {
						pluginSetting.useObsidianSearchInRead = value;
						this.plugin.requestSaveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.UseEscapeCharInReplace.name"))
			.setDesc(i18n.t("settings.UseEscapeCharInReplace.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.useEscapeCharInReplace).onChange(
					(value: boolean) => {
						pluginSetting.useEscapeCharInReplace = value;
						this.plugin.requestSaveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.EnableHistory.name"))
			.setDesc(i18n.t("settings.EnableHistory.desc"))
			.addToggle((cb) => {
				cb.setValue(pluginSetting.enableHistory).onChange(
					(value: boolean) => {
						pluginSetting.enableHistory = value;
						this.plugin.history.notify();
						this.plugin.requestSaveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.HistoryMaxCount.name"))
			.setDesc(i18n.t("settings.HistoryMaxCount.desc"))
			.addText((text) => {
				text.setValue(pluginSetting.historyMaxCount.toString()).setPlaceholder("1-200");
				const commit = () => {
					const limit = parseHistoryLimit(text.inputEl.value);
					if (limit !== null) this.plugin.history.resize(limit);
					text.setValue(pluginSetting.historyMaxCount.toString());
				};
				text.inputEl.addEventListener("blur", commit);
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(); }
				});
			});

		new Setting(containerEl)
			.setName(i18n.t("settings.HistorySortOrder.name"))
			.setDesc(i18n.t("settings.HistorySortOrder.desc"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption(HistorySortOrder.CREATED_AT, i18n.t("settings.HistorySortOrder.options.createdAt"))
					.addOption(HistorySortOrder.COUNT, i18n.t("settings.HistorySortOrder.options.count"))
					.addOption(HistorySortOrder.LAST_USED_AT, i18n.t("settings.HistorySortOrder.options.lastUsedAt"))
					.setValue(pluginSetting.historySortOrder)
					.onChange((value) => {
						pluginSetting.historySortOrder = value as HistorySortOrderType;
						this.plugin.history.notify();
						this.plugin.requestSaveSettings();
					});
			});
	}
}
