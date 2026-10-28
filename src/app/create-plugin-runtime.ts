import { addIcon, removeIcon, Notice, Plugin, normalizePath, moment } from "obsidian";
import { i18n, initializeLanguage } from "../i18n";
import { editorExtensionProvider, EditorSearch } from "./workspace-runtime";
import { HistoryController } from "../features/history";
import { defaultSettings, normalizeSettings, type PluginSettings } from "../features/settings";
import { SettingsStorage, SettingsConflictError } from "../platform/obsidian/settings-storage";
import { SettingTab } from "./settings-tab";
import { AppearanceStyles } from "../features/settings/ui";
import { Disposables } from "../shared/lifecycle/disposables";
import { REGEX_ICON_ID, REGEX_ICON_SVG } from "../shared/ui/icons/regex-icon";
import type { TranslationKey } from "../i18n/keys";
import { PresetController } from "../features/presets";
import { generateUniqueId } from "../shared/lifecycle/unique-id";

export default class TextFinderPlugin extends Plugin {
	settings!: PluginSettings;
	history = new HistoryController(
		() => this.settings,
		() => this.saveSettings(),
		Date.now,
		(error) => this.reportError("history.SubscriberFailed", error),
	);
	presets = new PresetController(
		() => this.settings,
		() => this.saveSettings(),
		generateUniqueId,
		Date.now,
		(error) => this.reportError("history.SubscriberFailed", error),
	);
	private storage?: SettingsStorage;
	private unloaded = false;
	private regexIconRegistered = false;
	private storageReadable = false;
	private storageConflict = false;
	private saveRevision = 0;
	private savedRevision = 0;
	private externalRefresh: Promise<void> | undefined;
	private externalRefreshRequested = false;
	private lastErrorNotice = -Infinity;
	private settingTab?: SettingTab;
	private appearance = new AppearanceStyles(
		() => this.settings?.appearanceColors ?? {},
		() => this.settings?.scopeAppearance,
	);
	editorSearch: EditorSearch | null = null;
	isUnloaded() {
		return this.unloaded;
	}
	async onload() {
		if (this.unloaded) return;
		addIcon(REGEX_ICON_ID, REGEX_ICON_SVG);
		this.regexIconRegistered = true;
		initializeLanguage(moment.locale());
		await this.loadSettings();
		if (this.unloaded) return;
		if (typeof document !== "undefined") this.appearance.addDocument(document);
		const workspace = this.app.workspace;
		const syncDocuments = () => {
			if (this.unloaded) return;
			workspace.iterateAllLeaves((leaf) =>
				this.appearance.addDocument(leaf.view.containerEl.ownerDocument),
			);
		};
		this.registerEvent(
			workspace.on("window-open", (_container, win) =>
				this.appearance.addDocument(win.document),
			),
		);
		this.registerEvent(
			workspace.on("window-close", (_container, win) =>
				this.appearance.removeDocument(win.document),
			),
		);
		this.registerEvent(workspace.on("layout-change", syncDocuments));
		workspace.onLayoutReady(syncDocuments);
		this.settingTab = new SettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		editorExtensionProvider(this);
	}
	onunload() {
		if (this.unloaded) return;
		this.unloaded = true;
		const scope = new Disposables();
		// Added first so it runs after UI teardown, even if another cleanup throws.
		scope.add(() => {
			if (!this.regexIconRegistered) return;
			this.regexIconRegistered = false;
			removeIcon(REGEX_ICON_ID);
		});
		scope.add(() => this.editorSearch?.dispose());
		scope.add(() => this.storage?.close());
		scope.add(() => this.appearance.destroy());
		scope.add(() => this.settingTab?.hide());
		scope.dispose();
	}
	private getStorage() {
		if (!this.storage) {
			const dir =
				this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
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
			this.presets.notify();
			this.reportError("history.LoadFailed", error);
			return;
		}
		const { settings, changed } = normalizeSettings(raw);
		this.settings = settings;
		this.storageConflict = false;
		this.savedRevision = this.saveRevision;
		this.appearance.refresh();
		this.history.notify();
		this.presets.notify();
		if (changed) await this.saveSettings().catch(() => {});
	}
	onExternalSettingsChange(): Promise<void> {
		this.externalRefreshRequested = true;
		if (this.externalRefresh) return this.externalRefresh;
		const refresh = (async () => {
			try {
				while (this.externalRefreshRequested) {
					this.externalRefreshRequested = false;
					await this.refreshExternalSettings();
				}
			} finally {
				this.externalRefresh = undefined;
			}
		})();
		this.externalRefresh = refresh;
		return refresh;
	}
	private async refreshExternalSettings() {
		if (this.unloaded || !this.storageReadable || this.storageConflict) return;
		const revision = this.saveRevision;
		try {
			let previous: PluginSettings | undefined;
			let normalized: ReturnType<typeof normalizeSettings> | undefined;
			await this.getStorage().readExternal((value) => {
				if (
					this.unloaded ||
					revision !== this.saveRevision ||
					revision !== this.savedRevision
				)
					return false;
				normalized = normalizeSettings(value);
				previous = this.settings;
				this.settings = normalized.settings;
				return true;
			});
			if (!normalized || !previous || this.unloaded) return;
			const { settings, changed } = normalized;
			const previousSettings = previous;
			// Reuse existing effect boundaries, isolating a broken view from the rest.
			for (const notify of [
				() => this.history.notify(),
				() => this.presets.notify(),
				() => this.appearance.refresh(),
				() => this.editorSearch?.refreshToolbars(),
				() => {
					if (previousSettings.useEscapeCharInReplace !== settings.useEscapeCharInReplace)
						this.editorSearch?.replacementPreferencesChanged();
				},
				() => {
					if (settings.showFloatingFinderOnOpen) this.editorSearch?.syncFloatingEntries();
				},
				() => this.settingTab?.refresh(),
			]) {
				try {
					notify();
				} catch (error) {
					this.reportError("history.SubscriberFailed", error);
				}
			}
			if (changed) await this.saveSettings().catch(() => {});
		} catch (error) {
			if (this.unloaded) return;
			if (error instanceof SettingsConflictError) {
				this.storageConflict = true;
				this.reportError("history.SettingsConflict", error);
			} else {
				this.storageReadable = false;
				this.reportError("history.LoadFailed", error);
			}
		}
	}

	async saveSettings() {
		const revision = ++this.saveRevision;
		try {
			if (this.unloaded) throw new Error("Plugin is unloaded; refusing a new settings write");
			if (this.storageConflict) throw new SettingsConflictError();
			if (!this.storageReadable)
				throw new Error(
					"Settings were not read successfully; refusing to overwrite stored data",
				);
			await this.getStorage().write(this.settings);
			this.savedRevision = Math.max(this.savedRevision, revision);
		} catch (error) {
			if (error instanceof SettingsConflictError) this.storageConflict = true;
			this.reportError(
				this.storageConflict
					? "history.SettingsConflict"
					: this.storageReadable
						? "history.SaveFailed"
						: "history.LoadFailed",
				error,
			);
			throw error;
		}
	}
	flushSettings() {
		return this.storage?.flush() ?? Promise.resolve();
	}
	refreshAppearance() {
		this.appearance.refresh();
	}
	ensureAppearanceDocument(doc: Document) {
		this.appearance.addDocument(doc);
	}
	requestSaveSettings() {
		void this.saveSettings().catch(() => {});
	}
	reportError(key: TranslationKey, error: unknown) {
		console.error(`Text Finder: ${key}`, error);
		if (this.unloaded) return;
		const now = Date.now();
		if (now - this.lastErrorNotice >= 5000) {
			this.lastErrorNotice = now;
			new Notice(i18n.t(key));
		}
	}
}
