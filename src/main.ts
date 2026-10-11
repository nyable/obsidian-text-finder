import { Notice, Plugin } from "obsidian";
import { i18n } from "./i18n";
import { editorExtensionProvider, EditorSearch } from "./editor-extension";
import { HistoryController } from "./history";
import { defaultSettings, normalizeSettings, type PluginSettings } from "./settings";
import { SaveQueue } from "./save-queue";
import { SettingTab } from "./settings-tab";

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
