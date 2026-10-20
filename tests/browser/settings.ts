import { Setting, type SettingDefinitionItem, type SettingDefinitionRender } from "obsidian";
import { SettingsDefinitions } from "../../src/features/settings/ui";
import { SettingsController, defaultSettings } from "../../src/features/settings";
import "../../src/styles/index.scss";

export function mountSettings(root: HTMLElement) {
	const settings = defaultSettings();
	let saves = 0,
		refreshes = 0;
	const commands = new SettingsController(() => settings, {
		save: () => {
			saves++;
		},
		historyChanged() {},
		replacementPreferencesChanged() {},
		resizeHistory: (value) => {
			settings.historyMaxCount = value;
			saves++;
		},
		refreshToolbars: () => {
			refreshes++;
		},
		syncFloatingEntries() {},
		refreshAppearance: () => {
			refreshes++;
		},
	});
	const definitions = new SettingsDefinitions(commands, () => {});
	const items = definitions.items();
	const collect = (items: SettingDefinitionItem[]): SettingDefinitionRender[] =>
		items.flatMap((item) =>
			"items" in item && item.items
				? collect(item.items)
				: "render" in item
					? [item as SettingDefinitionRender]
					: [],
		);
	const all = collect(items),
		cleanups: (() => void)[] = [];
	let rows = new Map<string, HTMLElement>();
	const clear = () => {
		cleanups.splice(0).forEach((fn) => fn());
		root.replaceChildren();
		rows = new Map();
	};
	const render = (items: SettingDefinitionRender[]) => {
		clear();
		for (const def of items) {
			const setting = new Setting(root).setName(def.name).setDesc(def.desc ?? "");
			rows.set(def.name, setting.settingEl);
			const cleanup = def.render(setting, {} as never);
			if (cleanup) cleanups.push(cleanup);
		}
	};
	return {
		names: all.map((def) => def.name),
		search(query: string) {
			const def = all.find(
				(def) =>
					def.searchable !== false &&
					[def.name, ...(def.aliases ?? [])].some((term) =>
						term.toLowerCase().includes(query.toLowerCase()),
					),
			);
			if (!def) throw new Error(`Missing setting: ${query}`);
			const page = items.find((item) => "type" in item && item.type === "page");
			const appearance = page && "items" in page && page.items ? collect(page.items) : [];
			render(
				appearance.includes(def)
					? appearance
					: all.filter((item) => !appearance.includes(item)),
			);
			const row = rows.get(def.name)!;
			row.dataset.target = "true";
			row.scrollIntoView({ block: "center" });
			return def.name;
		},
		state: () => ({ settings, saves, refreshes }),
		destroy() {
			clear();
			definitions.hide();
		},
	};
}
