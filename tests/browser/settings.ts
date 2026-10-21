import { SettingTab } from "../../src/app/settings-tab";
import type { PluginRuntimeHost } from "../../src/app/plugin-host";
import { defaultSettings } from "../../src/features/settings";
import "../../src/styles/index.scss";

export function mountSettings(root: HTMLElement, modern = true) {
	const settings = defaultSettings();
	let saves = 0,
		refreshes = 0;
	const plugin = {
		containerEl: root,
		settings,
		requestSaveSettings: () => {
			saves++;
		},
		history: {
			notify() {},
			resize: (value: number) => {
				settings.historyMaxCount = value;
			},
		},
		editorSearch: {
			refreshToolbars: () => {
				refreshes++;
			},
			syncFloatingEntries() {},
			replacementPreferencesChanged() {},
		},
		refreshAppearance: () => {
			refreshes++;
		},
		ensureAppearanceDocument() {},
	} as unknown as PluginRuntimeHost;
	const tab = new SettingTab(plugin.app, plugin);
	// Simulate the public host dispatch rule, not Obsidian's internal renderer.
	if (modern && tab.getSettingDefinitions().length)
		throw new Error("New hosts must use the same imperative settings view");
	tab.display();
	return {
		state: () => ({ settings, saves, refreshes }),
		destroy() {
			tab.hide();
			root.replaceChildren();
		},
	};
}
