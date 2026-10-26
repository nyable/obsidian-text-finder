import { SettingTab } from "../../src/app/settings-tab";
import type { PluginRuntimeHost } from "../../src/app/plugin-host";
import { defaultSettings } from "../../src/features/settings";
import "../../src/styles/index.scss";
import { addIcon, removeIcon } from "obsidian";
import { REGEX_ICON_ID, REGEX_ICON_SVG } from "../../src/shared/ui/icons/regex-icon";

export function mountSettings(root: HTMLElement, modern = true) {
	addIcon(REGEX_ICON_ID, REGEX_ICON_SVG);
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
			removeIcon(REGEX_ICON_ID);
			root.replaceChildren();
		},
	};
}
