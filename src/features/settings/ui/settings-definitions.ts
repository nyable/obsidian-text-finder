import { Notice, type SettingDefinitionItem, type SettingDefinitionRender } from "obsidian";
import type { SettingsCommands } from "../application/settings-controller";
import { settingsFields } from "./settings-fields";
import { SettingsView, type AppearancePart, type AppearancePreview } from "./settings-view";
import { appearanceColors, colorKeys } from "../model/appearance";
import { i18n } from "../../../i18n";
import { toolbarLabels } from "../../finder";

/** Data-only indexing; DOM and subscriptions exist only while a row is rendered. */
export class SettingsDefinitions {
	private mounted = new Map<SettingsView, () => void>();
	private previews = new Map<Document, AppearancePreview>();
	constructor(
		private commands: SettingsCommands,
		private ensureDocument: (doc: Document) => void,
	) {}

	items(): SettingDefinitionItem[] {
		const fields = settingsFields(this.commands);
		const appearance = (
			part: AppearancePart,
			name: string,
			aliases: string[] = [],
		): SettingDefinitionRender => ({
			name,
			aliases,
			render: (setting) => {
				const root = setting.settingEl;
				const doc = root.ownerDocument;
				root.replaceChildren();
				root.classList.add("nya-settings-definition");
				const view = new SettingsView(
					root,
					this.commands,
					this.ensureDocument,
					() => (root.ownerDocument === doc ? this.previews.get(doc) : undefined),
					() => {
						for (const other of this.mounted.keys())
							if (other !== view && other.containerEl.ownerDocument === doc)
								other.closeInteractions();
					},
				);
				const win = root.ownerDocument.defaultView;
				let disposed = false;
				const cleanup = () => {
					if (disposed) return;
					disposed = true;
					win?.removeEventListener("pagehide", cleanup);
					const preview = view.appearancePreview;
					view.hide();
					this.mounted.delete(view);
					if (preview && this.previews.get(doc)?.view === preview.view) {
						this.previews.delete(doc);
						for (const other of this.mounted.keys())
							if (other.containerEl.ownerDocument === doc) other.closeInteractions();
					}
				};
				this.mounted.set(view, cleanup);
				try {
					view.displayAppearancePart(part);
				} catch (error) {
					cleanup();
					throw error;
				}
				const preview = view.appearancePreview;
				if (preview) {
					for (const other of this.mounted.keys())
						if (other !== view && other.containerEl.ownerDocument === doc)
							other.closeInteractions();
					this.previews.set(doc, preview);
				}
				// The SDK does not guarantee row cleanup when its window is destroyed.
				win?.addEventListener("pagehide", cleanup, { once: true });
				return cleanup;
			},
		});
		return [
			...fields.general,
			...(["find", "replace", "history"] as const).map((page) => ({
				type: "group" as const,
				heading: i18n.t(`settings.Tabs.${page}`),
				items: fields[page],
			})),
			{
				type: "page",
				name: i18n.t("settings.Tabs.toolbar"),
				items: [
					{
						...appearance("preview", i18n.t("settings.Toolbar.preview")),
						searchable: false,
					},
					{
						type: "group",
						heading: i18n.t("settings.Appearance.colors"),
						extraButtons: [
							(button) =>
								button
									.setIcon("undo-2")
									.setTooltip(i18n.t("settings.Toolbar.reset"))
									.onClick(() => {
										if (
											!button.extraSettingsEl.isConnected ||
											!this.mounted.size
										)
											return;
										for (const view of this.mounted.keys())
											view.closeInteractions();
										this.commands.resetColors();
										new Notice(i18n.t("settings.Toolbar.resetDone"), 2000);
										for (const view of this.mounted.keys())
											view.refreshColors();
									}),
						],
						items: colorKeys
							.filter((key) => appearanceColors[key].group !== "scope")
							.map((key) =>
								appearance(
									key,
									`${i18n.t(`settings.Appearance.${appearanceColors[key].group}`)}: ${i18n.t(`settings.Appearance.${key}`)}`,
								),
							),
					},
					appearance("scope", i18n.t("settings.Appearance.scope"), [
						i18n.t("settings.Appearance.scopeBackground"),
						i18n.t("settings.Appearance.scopeBorder"),
						i18n.t("settings.Appearance.scopeBorderEnabled"),
						i18n.t("settings.Appearance.scopeBorderWidth"),
					]),
					...(["search", "replace"] as const).map((kind) =>
						appearance(kind, i18n.t(`settings.Toolbar.${kind}`), [
							i18n.t("settings.Toolbar.defaultEnabled"),
							i18n.t("settings.Toolbar.inline"),
							i18n.t("settings.Toolbar.more"),
							i18n.t("settings.Toolbar.hidden"),
							...this.commands
								.preferences()
								[kind === "search" ? "searchToolbar" : "replaceToolbar"].map(
									(item) => i18n.t(toolbarLabels[item.id]),
								),
						]),
					),
				],
			},
		];
	}
	hide(): void {
		for (const cleanup of this.mounted.values()) cleanup();
		this.previews.clear();
	}
}
