import { loadSource } from "./source-loader.mjs";

export const constants = loadSource("../src/constants.ts");
export const historySource = loadSource("../src/history.ts", { "./constants": constants });
export const toolbarSource = loadSource("../src/toolbar.ts");
export const appearanceSource = loadSource("../src/appearance.ts");
export const settingsSource = loadSource("../src/settings.ts", { "./constants": constants, "./history": historySource, "./toolbar": toolbarSource, "./appearance": appearanceSource });
export const queueSource = loadSource("../src/save-queue.ts");

export function attachHistory(plugin) {
	plugin.history = new historySource.HistoryController(() => plugin.settings, async () => {
		try { await plugin.saveSettings(); }
		catch (error) { console.error("Text Finder: failed to save search history", error); throw error; }
	});
}
