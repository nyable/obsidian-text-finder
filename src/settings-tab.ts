import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type TextFinderPlugin from "./main";
import { defaultSettings, type PluginSettings } from "./settings";
import { i18n } from "./i18n";
import { HistorySortOrder, type HistorySortOrderType } from "./constants";
import { parseHistoryLimit } from "./history";
import { defaultToolbar, moveToolbarItem, toolbarLabels, type ToolbarAction, type ToolbarKind, type ToolbarPlacement } from "./toolbar";
import ToolbarPreview from "./ToolbarPreview.svelte";

type SettingsPage = "find" | "replace" | "history" | "toolbar";
type ToggleKey = { [K in keyof PluginSettings]: PluginSettings[K] extends boolean ? K : never }[keyof PluginSettings];
const pages: SettingsPage[] = ["find", "replace", "history", "toolbar"];
const actionIcons: Record<ToolbarAction, string> = {
	regex: "regex", case: "case-sensitive", previous: "arrow-up", next: "arrow-down",
	history: "history", replace: "replace", replaceAll: "replace-all",
};

export class SettingTab extends PluginSettingTab {
	private page: SettingsPage = "find";
	private cleanupDrag?: () => void;
	private preview?: ToolbarPreview;

	private clearPreview() { this.preview?.$destroy(); this.preview = undefined; }
	private refreshPreview() {
		const { searchToolbar, replaceToolbar, defaultRegexMode, defaultCaseSensitive, enableHistory } = this.plugin.settings;
		this.preview?.$set({ searchToolbar, replaceToolbar, defaultRegexMode, defaultCaseSensitive, historyEnabled: enableHistory });
	}

	constructor(app: App, public plugin: TextFinderPlugin) { super(app, plugin); }

	display() {
		this.cleanupDrag?.();
		this.clearPreview();
		const root = this.containerEl;
		root.empty();
		root.classList.add("nya-settings");
		const doc = root.ownerDocument;
		const tabs = doc.createElement("div");
		tabs.className = "nya-settings-tabs";
		tabs.setAttribute("role", "tablist");
		tabs.setAttribute("aria-label", i18n.t("settings.Tabs.label"));
		root.append(tabs);
		const panel = doc.createElement("div");
		panel.className = "nya-settings-panel";
		panel.setAttribute("role", "tabpanel");
		panel.tabIndex = 0;
		root.append(panel);
		const buttons = pages.map((page) => {
			const button = doc.createElement("button");
			button.type = "button";
			button.id = `nya-settings-tab-${page}`;
			button.textContent = i18n.t(`settings.Tabs.${page}`);
			button.setAttribute("role", "tab");
			button.setAttribute("aria-controls", `nya-settings-panel-${page}`);
			tabs.append(button);
			button.addEventListener("click", () => select(page));
			button.addEventListener("keydown", (event) => {
				let index = pages.indexOf(page);
				if (event.key === "ArrowRight") index = (index + 1) % pages.length;
				else if (event.key === "ArrowLeft") index = (index + pages.length - 1) % pages.length;
				else if (event.key === "Home") index = 0;
				else if (event.key === "End") index = pages.length - 1;
				else return;
				event.preventDefault(); select(pages[index]); buttons[index].focus();
			});
			return button;
		});
		const select = (page: SettingsPage) => {
			this.cleanupDrag?.();
			this.clearPreview();
			const focused = doc.activeElement;
			if (focused && panel.contains(focused)) (focused as HTMLElement).blur();
			this.page = page;
			buttons.forEach((button, index) => {
				button.setAttribute("aria-selected", String(pages[index] === page));
				button.tabIndex = pages[index] === page ? 0 : -1;
			});
			panel.replaceChildren();
			panel.id = `nya-settings-panel-${page}`;
			panel.setAttribute("aria-labelledby", `nya-settings-tab-${page}`);
			this.renderPage(panel);
		};
		select(this.page);
	}

	hide() {
		this.cleanupDrag?.();
		this.clearPreview();
		const focused = this.containerEl.ownerDocument.activeElement;
		if (focused && this.containerEl.contains(focused)) (focused as HTMLElement).blur();
	}

	private toggle(root: HTMLElement, key: ToggleKey, name: string) {
		new Setting(root).setName(i18n.t(`settings.${name}.name`)).setDesc(i18n.t(`settings.${name}.desc`))
			.addToggle((toggle) => toggle.setValue(this.plugin.settings[key]).onChange((value) => {
				this.plugin.settings[key] = value;
				if (key === "enableHistory") {
					this.plugin.history.notify();
					this.plugin.editorSearch?.refreshToolbars();
				}
				this.plugin.requestSaveSettings();
			}));
	}

	private renderPage(root: HTMLElement) {
		if (this.page === "find") {
			this.toggle(root, "clearAfterHidden", "ClearAfterHidden");
			this.toggle(root, "enableInputHotkeys", "EnableInputHotkeys");
			this.toggle(root, "useSelectionAsSearch", "UseSelectionAsSearch");
			this.toggle(root, "sourceModeWhenSearch", "SourceModeWhenSearch");
			this.toggle(root, "moveCursorToMatch", "MoveCursorToMatch");
			this.toggle(root, "useObsidianSearchInRead", "UseObsidianSearchInRead");
		} else if (this.page === "replace") {
			this.toggle(root, "useEscapeCharInReplace", "UseEscapeCharInReplace");
		} else if (this.page === "history") {
			this.toggle(root, "enableHistory", "EnableHistory");
			new Setting(root).setName(i18n.t("settings.HistoryMaxCount.name")).setDesc(i18n.t("settings.HistoryMaxCount.desc"))
				.addText((text) => {
					text.setValue(String(this.plugin.settings.historyMaxCount)).setPlaceholder("1-200");
					const commit = () => {
						const limit = parseHistoryLimit(text.inputEl.value);
						if (limit !== null) this.plugin.history.resize(limit);
						text.setValue(String(this.plugin.settings.historyMaxCount));
					};
					text.inputEl.addEventListener("blur", commit);
					text.inputEl.addEventListener("keydown", (event) => {
						if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(); }
					});
				});
			new Setting(root).setName(i18n.t("settings.HistorySortOrder.name")).setDesc(i18n.t("settings.HistorySortOrder.desc"))
				.addDropdown((dropdown) => {
					for (const order of Object.values(HistorySortOrder)) dropdown.addOption(order, i18n.t(`settings.HistorySortOrder.options.${order}`));
					dropdown.setValue(this.plugin.settings.historySortOrder).onChange((value) => {
						this.plugin.settings.historySortOrder = value as HistorySortOrderType;
						this.plugin.history.notify(); this.plugin.requestSaveSettings();
					});
				});
		} else {
			const preview = root.ownerDocument.createElement("div"); root.append(preview);
			this.preview = new ToolbarPreview({ target: preview, props: {
				searchToolbar: this.plugin.settings.searchToolbar, replaceToolbar: this.plugin.settings.replaceToolbar,
				defaultRegexMode: this.plugin.settings.defaultRegexMode, defaultCaseSensitive: this.plugin.settings.defaultCaseSensitive,
				historyEnabled: this.plugin.settings.enableHistory,
			} });
			this.toolbar(root, "search"); this.toolbar(root, "replace");
		}
	}

	private toolbar(root: HTMLElement, kind: ToolbarKind) {
		const doc = root.ownerDocument;
		const section = doc.createElement("section");
		section.className = "nya-toolbar-settings"; root.append(section);
		const title = doc.createElement("h3"); title.textContent = i18n.t(`settings.Toolbar.${kind}`); section.append(title);
		const list = doc.createElement("div"); list.className = "nya-toolbar-list"; section.append(list);
		const live = doc.createElement("div"); live.className = "nya-settings-sr";
		live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); section.append(live);
		const key = kind === "search" ? "searchToolbar" : "replaceToolbar";
		const commit = (items: PluginSettings[typeof key]) => {
			if (items === this.plugin.settings[key]) return;
			this.plugin.settings[key] = items;
			this.refreshPreview();
			this.plugin.editorSearch?.refreshToolbars();
			this.plugin.requestSaveSettings();
		};
		const render = (focusId?: string, control = "handle") => {
			list.replaceChildren();
			this.plugin.settings[key].forEach((item, index, items) => {
				const row = doc.createElement("div"); row.className = "nya-toolbar-row"; row.dataset.action = item.id; list.append(row);
				const name = i18n.t(toolbarLabels[item.id]);
				const button = (parent: HTMLElement, text: string, label: string, controlName: string) => {
					const el = doc.createElement("button"); el.type = "button"; el.textContent = text;
					el.setAttribute("aria-label", label); el.dataset.control = controlName; parent.append(el); return el;
				};
				const handle = button(row, "", i18n.t("settings.Toolbar.drag", { name }), "handle");
				handle.className = "nya-toolbar-handle";
				setIcon(handle, "grip-vertical");
				const controls = doc.createElement("div"); controls.className = "nya-toolbar-row-controls"; row.append(controls);
				const icon = doc.createElement("span"); icon.className = "nya-toolbar-item-icon";
				icon.setAttribute("aria-hidden", "true"); setIcon(icon, actionIcons[item.id]); controls.append(icon);
				const label = doc.createElement("span"); label.className = "nya-toolbar-name"; label.textContent = name; controls.append(label);
				const options = doc.createElement("div"); options.className = "nya-toolbar-row-options"; row.append(options);
				const placement = doc.createElement("div"); placement.className = "nya-toolbar-placement"; options.append(placement);
				const select = doc.createElement("select"); select.setAttribute("aria-label", i18n.t("settings.Toolbar.placement", { name }));
				for (const placement of ["inline", "more", "hidden"] as const) {
					const option = doc.createElement("option"); option.value = placement; option.textContent = i18n.t(`settings.Toolbar.${placement}`); select.append(option);
				}
				select.value = item.placement; placement.append(select);
				const arrow = doc.createElement("span"); arrow.className = "nya-toolbar-select-arrow";
				arrow.setAttribute("aria-hidden", "true"); setIcon(arrow, "chevron-down"); placement.append(arrow);
				select.addEventListener("change", () => {
					commit(this.plugin.settings[key].map((entry) => entry.id === item.id ? { ...entry, placement: select.value as ToolbarPlacement } : entry));
				});
				if (kind === "search" && (item.id === "regex" || item.id === "case")) {
					const defaultKey = item.id === "regex" ? "defaultRegexMode" : "defaultCaseSensitive";
					const option = new Setting(options).setName(i18n.t("settings.Toolbar.defaultEnabled"));
					option.settingEl.classList.add("nya-toolbar-default");
					option.addToggle((toggle) => {
						toggle.setValue(this.plugin.settings[defaultKey]);
						toggle.toggleEl.setAttribute("aria-label", i18n.t("settings.Toolbar.defaultEnabledLabel", { name }));
						toggle.toggleEl.setAttribute("title", i18n.t("settings.Toolbar.defaultsDesc"));
						toggle.onChange((value) => {
							this.plugin.settings[defaultKey] = value;
							this.refreshPreview(); this.plugin.requestSaveSettings();
						});
					});
				}
				const move = (boundary: number, controlName: string) => {
					commit(moveToolbarItem(this.plugin.settings[key], index, boundary));
					render(item.id, controlName); live.textContent = i18n.t("settings.Toolbar.moved", { name });
				};
				const up = button(controls, "↑", i18n.t("settings.Toolbar.up", { name }), "up"); up.disabled = index === 0;
				const down = button(controls, "↓", i18n.t("settings.Toolbar.down", { name }), "down"); down.disabled = index === items.length - 1;
				up.addEventListener("click", () => move(index - 1, "up"));
				down.addEventListener("click", () => move(index + 2, "down"));
				handle.addEventListener("keydown", (event) => {
					if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); move(index - 1, "handle"); }
					if (event.key === "ArrowDown" && index < items.length - 1) { event.preventDefault(); move(index + 2, "handle"); }
				});
				handle.addEventListener("pointerdown", (event) => {
					if (event.button !== 0 || !event.isPrimary) return;
					this.cleanupDrag?.();
					let boundary = index;
					let dragging = false;
					const startY = event.clientY;
					const clearMarkers = () => list.querySelectorAll(".nya-drop-before, .nya-drop-after").forEach((el) => el.classList.remove("nya-drop-before", "nya-drop-after"));
					const cleanup = () => {
						clearMarkers(); row.classList.remove("nya-toolbar-dragging");
						doc.removeEventListener("pointermove", pointerMove); doc.removeEventListener("pointerup", pointerUp);
						doc.removeEventListener("pointercancel", cancel); doc.removeEventListener("keydown", escape);
						doc.defaultView?.removeEventListener("blur", cancel);
						this.cleanupDrag = undefined;
					};
					const pointerMove = (e: PointerEvent) => {
						if (e.pointerId !== event.pointerId) return;
						if (!dragging && Math.abs(e.clientY - startY) < 4) return;
						dragging = true; row.classList.add("nya-toolbar-dragging"); e.preventDefault();
						const rows = Array.from(list.children) as HTMLElement[];
						boundary = rows.findIndex((el) => { const box = el.getBoundingClientRect(); return e.clientY < box.top + box.height / 2; });
						if (boundary === -1) boundary = rows.length;
						clearMarkers();
						if (boundary < rows.length) rows[boundary].classList.add("nya-drop-before");
						else rows[rows.length - 1].classList.add("nya-drop-after");
					};
					const pointerUp = (e: PointerEvent) => {
						if (e.pointerId !== event.pointerId) return;
						cleanup();
						if (dragging) move(boundary, "handle");
					};
					const cancel = () => cleanup();
					const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); cleanup(); handle.focus(); } };
					this.cleanupDrag = cleanup;
					doc.addEventListener("pointermove", pointerMove, { passive: false }); doc.addEventListener("pointerup", pointerUp);
					doc.addEventListener("pointercancel", cancel); doc.addEventListener("keydown", escape);
					doc.defaultView?.addEventListener("blur", cancel);
				});
			});
			if (focusId) {
				const row = list.querySelector<HTMLElement>(`[data-action="${focusId}"]`);
				const button = row?.querySelector<HTMLButtonElement>(`[data-control="${control}"]`);
				(button?.disabled ? row?.querySelector<HTMLButtonElement>('[data-control="handle"]') : button)?.focus();
			}
		};
		render();
		const reset = doc.createElement("button"); reset.type = "button";
		reset.textContent = i18n.t("settings.Toolbar.reset"); section.append(reset);
		reset.addEventListener("click", () => {
			this.cleanupDrag?.();
			if (kind === "search") {
				const defaults = defaultSettings();
				this.plugin.settings.defaultRegexMode = defaults.defaultRegexMode;
				this.plugin.settings.defaultCaseSensitive = defaults.defaultCaseSensitive;
			}
			commit(defaultToolbar(kind)); render();
		});
	}
}
