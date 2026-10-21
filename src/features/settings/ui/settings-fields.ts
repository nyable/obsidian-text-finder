import type { Setting } from "obsidian";
import type { SettingsCommands, ToggleKey } from "../application/settings-controller";
import { HistorySortOrder, type HistorySortOrderType, parseHistoryLimit } from "../../history";
import { i18n } from "../../../i18n";

export type BasicSettingsPage = "general" | "find" | "replace" | "history";
export interface SettingsField {
	name: string;
	desc: string;
	render: (setting: Setting) => void;
}

/** Basic fields for the five-tab settings view; writes always use commands. */
export function settingsFields(
	commands: SettingsCommands,
): Record<BasicSettingsPage, SettingsField[]> {
	const toggle = (
		key: ToggleKey,
		name:
			| "ShowFloatingFinderOnOpen"
			| "FinderAutoDock"
			| "ClearAfterHidden"
			| "EnableInputHotkeys"
			| "UseSelectionAsSearch"
			| "SourceModeWhenSearch"
			| "MoveCursorToMatch"
			| "UseEscapeCharInReplace"
			| "EnableHistory",
	): SettingsField => ({
		name: i18n.t(`settings.${name}.name`),
		desc: i18n.t(`settings.${name}.desc`),
		render: (setting) => {
			setting.addToggle((control) =>
				control
					.setValue(commands.preferences()[key])
					.onChange((value) => commands.toggle(key, value)),
			);
		},
	});
	const order = (retention: boolean): SettingsField => {
		const name = retention ? "HistoryRetention" : "HistorySortOrder";
		return {
			name: i18n.t(`settings.${name}.name`),
			desc: i18n.t(`settings.${name}.desc`),
			render: (setting) => {
				setting.addDropdown((dropdown) => {
					for (const value of Object.values(HistorySortOrder))
						dropdown.addOption(value, i18n.t(`settings.${name}.options.${value}`));
					dropdown
						.setValue(
							commands.preferences()[
								retention ? "historyRetention" : "historySortOrder"
							],
						)
						.onChange((value) => {
							if (
								!Object.values(HistorySortOrder).includes(
									value as HistorySortOrderType,
								)
							)
								return;
							if (retention) commands.historyRetention(value as HistorySortOrderType);
							else commands.historyOrder(value as HistorySortOrderType);
						});
				});
			},
		};
	};
	return {
		general: [
			toggle("showFloatingFinderOnOpen", "ShowFloatingFinderOnOpen"),
			toggle("finderAutoDock", "FinderAutoDock"),
		],
		find: [
			toggle("clearAfterHidden", "ClearAfterHidden"),
			toggle("enableInputHotkeys", "EnableInputHotkeys"),
			toggle("useSelectionAsSearch", "UseSelectionAsSearch"),
			toggle("sourceModeWhenSearch", "SourceModeWhenSearch"),
			toggle("moveCursorToMatch", "MoveCursorToMatch"),
		],
		replace: [toggle("useEscapeCharInReplace", "UseEscapeCharInReplace")],
		history: [
			toggle("enableHistory", "EnableHistory"),
			{
				name: i18n.t("settings.HistoryMaxCount.name"),
				desc: i18n.t("settings.HistoryMaxCount.desc"),
				render: (setting) => {
					setting.addText((text) => {
						text.setValue(
							String(commands.preferences().historyMaxCount),
						).setPlaceholder("1-200");
						const commit = () => {
							const limit = parseHistoryLimit(text.inputEl.value);
							if (limit !== null) commands.resizeHistory(limit);
							text.setValue(String(commands.preferences().historyMaxCount));
						};
						text.inputEl.addEventListener("blur", commit);
						text.inputEl.addEventListener("keydown", (event) => {
							if (event.key === "Enter" && !event.isComposing) {
								event.preventDefault();
								commit();
							}
						});
					});
				},
			},
			order(false),
			order(true),
		],
	};
}
