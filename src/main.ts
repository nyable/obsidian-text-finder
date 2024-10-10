import { App, Plugin, PluginSettingTab } from "obsidian";

interface PluginSettings {
	scrollToCenter: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	scrollToCenter: false,
};

export default class TextFinderPlugin extends Plugin {
	settings!: PluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));
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
	}
}
