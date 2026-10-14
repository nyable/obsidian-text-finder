import { Notice, Plugin, normalizePath } from "obsidian";
import { i18n } from "./i18n";
import { editorExtensionProvider, EditorSearch } from "./editor-extension";
import { HistoryController } from "./history";
import { defaultSettings, normalizeSettings, type PluginSettings } from "./settings";
import { SettingsStorage } from "./settings-storage";
import { SettingTab } from "./settings-tab";
import { AppearanceStyles } from "./appearance";

export type { SearchHistoryItem } from "./history";

export default class TextFinderPlugin extends Plugin {
	settings!: PluginSettings;
	history = new HistoryController(() => this.settings, () => this.saveSettings());
	private storage?: SettingsStorage;
	private unloaded = false;
	private storageReadable = false;
	private lastErrorNotice = -Infinity;
	private settingTab?: SettingTab;
	private appearance = new AppearanceStyles(() => this.settings?.appearanceColors ?? {}, () => this.settings?.scopeAppearance);
	editorSearch: EditorSearch | null = null;
	isUnloaded() { return this.unloaded; }
	async onload() {
		await this.loadSettings();
		if (this.unloaded) return;
		if (typeof document !== "undefined") this.appearance.addDocument(document);
		const workspace = this.app.workspace;
		const syncDocuments = () => {
			if (this.unloaded) return;
			workspace.iterateAllLeaves((leaf) => this.appearance.addDocument(leaf.view.containerEl.ownerDocument));
		};
		this.registerEvent(workspace.on("window-open", (_container, win) => this.appearance.addDocument(win.document)));
		this.registerEvent(workspace.on("window-close", (_container, win) => this.appearance.removeDocument(win.document)));
		this.registerEvent(workspace.on("layout-change", syncDocuments));
		workspace.onLayoutReady(syncDocuments);
		this.settingTab = new SettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		editorExtensionProvider(this);
	}
	onunload() {
		this.unloaded = true;
		this.settingTab?.hide();
		this.appearance.destroy();
		this.storage?.close();
		this.editorSearch?.destoryAll();
	}
	private getStorage() {
		if (!this.storage) {
			const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
			this.storage = new SettingsStorage(this.app, normalizePath(`${dir}/data.json`));
		}
		return this.storage;
	}
	async loadSettings() {
		if (this.unloaded) return;
		let raw: unknown;
		try {
			raw = await this.getStorage().read();
			if (this.unloaded) return;
			this.storageReadable = true;
		} catch (error) {
			if (this.unloaded) return;
			this.storageReadable = false;
			this.settings = defaultSettings();
			this.appearance.refresh();
			this.history.notify();
			this.reportError("history.LoadFailed", error);
			return;
		}
		const { settings, changed } = normalizeSettings(raw);
		this.settings = settings;
		this.appearance.refresh();
		this.history.notify();
		if (changed) await this.saveSettings().catch(() => {});
	}

	async saveSettings() {
		try {
			if (this.unloaded) throw new Error("Plugin is unloaded; refusing a new settings write");
			if (!this.storageReadable) throw new Error("Settings were not read successfully; refusing to overwrite stored data");
			await this.getStorage().write(this.settings);
		} catch (error) {
			this.reportError(this.storageReadable ? "history.SaveFailed" : "history.LoadFailed", error);
			throw error;
		}
	}
	flushSettings() { return this.storage?.flush() ?? Promise.resolve(); }
	refreshAppearance() { this.appearance.refresh(); }
	ensureAppearanceDocument(doc: Document) { this.appearance.addDocument(doc); }
	requestSaveSettings() { void this.saveSettings().catch(() => {}); }
	reportError(key: string, error: unknown) {
		console.error(`Text Finder: ${key}`, error);
		if (this.unloaded) return;
		const now = Date.now();
		if (now - this.lastErrorNotice >= 5000) {
			this.lastErrorNotice = now;
			new Notice(i18n.t(key));
		}
	}
}
