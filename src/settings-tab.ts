import { App, Notice, PluginSettingTab, Setting, setIcon, setTooltip } from "obsidian";
import type TextFinderPlugin from "./main";
import { defaultSettings, type PluginSettings } from "./settings";
import { i18n } from "./i18n";
import { HistorySortOrder, type HistorySortOrderType } from "./constants";
import { parseHistoryLimit } from "./history";
import { defaultToolbar, moveToolbarItem, toolbarLabels, type ToolbarAction, type ToolbarKind, type ToolbarPlacement } from "./toolbar";
import ToolbarPreview from "./ToolbarPreview.vue";
import { mountView } from "./ui/mount";
import { appearanceColors, colorKeys, defaultScopeAppearance, resolvedAppearanceColor, type AppearanceColorKey } from "./appearance";
import { openColorPicker } from "./color-picker";
import { createSettingsSelect, type SettingsSelect } from "./settings-select";

type SettingsPage = "general" | "find" | "replace" | "history" | "toolbar";
type ToggleKey = { [K in keyof PluginSettings]: PluginSettings[K] extends boolean ? K : never }[keyof PluginSettings];
const pages: SettingsPage[] = ["general", "find", "replace", "history", "toolbar"];
const actionIcons: Record<ToolbarAction, string> = {
	regex: "regex", case: "case-sensitive", wholeWord: "whole-word", selection: "text-select", previous: "arrow-up", next: "arrow-down",
	history: "history", replace: "replace", replaceAll: "replace-all",
};

let nextSettingsId = 0;

export class SettingTab extends PluginSettingTab {
	private page: SettingsPage = "general";
	private cleanupDrag?: () => void;
	private preview?: ReturnType<typeof mountView>;
	private previewRoot?: HTMLElement;
	private cleanupColor?: () => void;
	private cleanupSelect?: () => void;
	private selectControls = new Set<SettingsSelect>();
	private labelId = `nya-settings-categories-${++nextSettingsId}`;
	private collapsed = new Set<"colors" | "scope" | ToolbarKind>(["colors", "scope", "search", "replace"]);
	private sectionId = 0;

	private clearPreview() {
		this.selectControls.forEach((control) => control.destroy()); this.selectControls.clear(); this.cleanupSelect = undefined;
		this.cleanupColor?.(); this.cleanupColor = undefined;
		this.preview?.destroy(); this.preview = undefined; this.previewRoot = undefined;
	}
	private refreshPreview() {
		const { searchToolbar, replaceToolbar, defaultRegexMode, defaultCaseSensitive, defaultWholeWord, enableHistory } = this.plugin.settings;
		this.preview?.update({ searchToolbar, replaceToolbar, defaultRegexMode, defaultCaseSensitive, defaultWholeWord, historyEnabled: enableHistory });
	}

	constructor(app: App, public plugin: TextFinderPlugin) { super(app, plugin); }

	display() {
		this.cleanupDrag?.();
		this.clearPreview();
		const root = this.containerEl;
		this.plugin.ensureAppearanceDocument(root.ownerDocument);
		root.empty();
		root.classList.add("nya-settings");
		const doc = root.ownerDocument;
		// The host may set containerEl.style.display when showing a tab. Keep
		// our flex layout on an inner element rather than fighting that value.
		const layout = doc.createElement("div"); layout.className = "nya-settings-layout"; root.append(layout);
		const tabs = doc.createElement("div");
		tabs.className = "nya-settings-tabs";
		tabs.setAttribute("role", "tablist");
		// Obsidian turns aria-label into hover tooltips, even on containers.
		const tabsLabel = doc.createElement("span"); tabsLabel.id = this.labelId; tabsLabel.className = "nya-settings-sr";
		tabsLabel.textContent = i18n.t("settings.Tabs.label"); layout.append(tabsLabel);
		tabs.setAttribute("aria-labelledby", tabsLabel.id);
		layout.append(tabs);
		const panel = doc.createElement("div");
		panel.className = "nya-settings-panel";
		panel.setAttribute("role", "tabpanel");
		panel.tabIndex = 0;
		layout.append(panel);
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
			root.classList.toggle("nya-settings--appearance", page === "toolbar");
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
		this.collapsed = new Set(["colors", "scope", "search", "replace"]);
		this.containerEl.classList.remove("nya-settings--appearance");
		const focused = this.containerEl.ownerDocument.activeElement;
		if (focused && this.containerEl.contains(focused)) (focused as HTMLElement).blur();
	}

	private reset(trigger: HTMLButtonElement, action: () => void) {
		if (!this.preview || this.page !== "toolbar" || !trigger.isConnected || !this.containerEl.contains(trigger)) return;
		this.cleanupSelect?.(); this.cleanupColor?.(); this.cleanupDrag?.(); action();
		// Settings have been restored in memory; persistence is queued separately.
		new Notice(i18n.t("settings.Toolbar.resetDone"), 2000);
	}

	private section(root: HTMLElement, kind: "colors" | "scope" | ToolbarKind, className: string, title: string,
		reset: () => void, cancelGesture: () => void) {
		const doc = root.ownerDocument;
		const section = doc.createElement("section"); section.className = className; section.dataset.section = kind; root.append(section);
		const header = doc.createElement("div"); header.className = "nya-settings-section-header"; section.append(header);
		const heading = doc.createElement("h3"); header.append(heading);
		const toggle = doc.createElement("button"); toggle.type = "button"; toggle.className = "nya-settings-section-toggle"; heading.append(toggle);
		const arrow = doc.createElement("span"); arrow.className = "nya-settings-section-arrow"; arrow.setAttribute("aria-hidden", "true");
		setIcon(arrow, "chevron-down"); toggle.append(arrow);
		const label = doc.createElement("span"); label.textContent = title; toggle.append(label);
		const restore = doc.createElement("button"); restore.type = "button"; restore.className = "nya-settings-section-reset";
		restore.setAttribute("aria-label", i18n.t("settings.Toolbar.reset"));
		setIcon(restore, "undo-2"); setTooltip(restore, i18n.t("settings.Toolbar.reset")); header.append(restore);
		restore.addEventListener("click", () => this.reset(restore, reset));
		const body = doc.createElement("div"); body.className = "nya-settings-section-body";
		body.id = `nya-settings-section-${kind}-${++this.sectionId}`; section.append(body); toggle.setAttribute("aria-controls", body.id);
		const sync = () => { body.hidden = this.collapsed.has(kind); toggle.setAttribute("aria-expanded", String(!body.hidden)); };
		toggle.addEventListener("click", () => {
			if (this.collapsed.has(kind)) this.collapsed.delete(kind);
			else {
				this.cleanupSelect?.();
				cancelGesture();
				if (body.contains(doc.activeElement)) toggle.focus();
				this.collapsed.add(kind);
			}
			sync();
		});
		sync(); return body;
	}

	private toggle(root: HTMLElement, key: ToggleKey, name: string) {
		new Setting(root).setName(i18n.t(`settings.${name}.name`)).setDesc(i18n.t(`settings.${name}.desc`))
			.addToggle((toggle) => toggle.setValue(this.plugin.settings[key]).onChange((value) => {
				this.plugin.settings[key] = value;
				if (key === "finderAutoDock") this.plugin.editorSearch?.refreshToolbars();
				if (key === "showFloatingFinderOnOpen" && value) this.plugin.editorSearch?.syncFloatingEntries();
				if (key === "enableHistory") {
					this.plugin.history.notify();
					this.plugin.editorSearch?.refreshToolbars();
				}
				this.plugin.requestSaveSettings();
			}));
	}

	private renderPage(root: HTMLElement) {
		if (this.page === "general") {
			this.toggle(root, "showFloatingFinderOnOpen", "ShowFloatingFinderOnOpen");
			this.toggle(root, "finderAutoDock", "FinderAutoDock");
		} else if (this.page === "find") {
			this.toggle(root, "clearAfterHidden", "ClearAfterHidden");
			this.toggle(root, "enableInputHotkeys", "EnableInputHotkeys");
			this.toggle(root, "useSelectionAsSearch", "UseSelectionAsSearch");
			this.toggle(root, "sourceModeWhenSearch", "SourceModeWhenSearch");
			this.toggle(root, "moveCursorToMatch", "MoveCursorToMatch");
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
			const preview = root.ownerDocument.createElement("div"); preview.className = "nya-appearance-preview"; root.append(preview);
			this.previewRoot = preview;
			this.preview = mountView(ToolbarPreview, preview, {
				searchToolbar: this.plugin.settings.searchToolbar, replaceToolbar: this.plugin.settings.replaceToolbar,
				defaultRegexMode: this.plugin.settings.defaultRegexMode, defaultCaseSensitive: this.plugin.settings.defaultCaseSensitive,
				defaultWholeWord: this.plugin.settings.defaultWholeWord,
				historyEnabled: this.plugin.settings.enableHistory,
			});
			const controls = root.ownerDocument.createElement("div"); controls.className = "nya-appearance-controls";
			controls.tabIndex = 0; controls.setAttribute("role", "region");
			controls.setAttribute("aria-labelledby", "nya-settings-tab-toolbar"); root.append(controls);
			this.colors(controls);
			this.scopeStyles(controls);
			this.toolbar(controls, "search"); this.toolbar(controls, "replace");
		}
	}

	private colors(root: HTMLElement) {
		const doc = root.ownerDocument;
		const updates = new Map<AppearanceColorKey, () => void>();
		const section = this.section(root, "colors", "nya-color-settings", i18n.t("settings.Appearance.colors"), () => {
			for (const key of colorKeys.filter((key) => appearanceColors[key].group !== "scope")) delete this.plugin.settings.appearanceColors[key];
			this.plugin.refreshAppearance(); updates.forEach((update) => update()); this.plugin.requestSaveSettings();
		}, () => this.cleanupColor?.());
		for (const group of ["panel", "match", "current"] as const) {
			const block = doc.createElement("div"); block.className = "nya-color-group"; section.append(block);
			const heading = doc.createElement("h4"); heading.textContent = i18n.t(`settings.Appearance.${group}`); block.append(heading);
			this.colorRows(block, group, updates);
		}
	}

	private colorRows(block: HTMLElement, group: "panel" | "match" | "current" | "scope", updates: Map<AppearanceColorKey, () => void>,
		keys = colorKeys.filter((key) => appearanceColors[key].group === group)) {
		const doc = block.ownerDocument;
		const commit = (key: AppearanceColorKey, color: string | null) => {
			if (color === null) delete this.plugin.settings.appearanceColors[key];
			else this.plugin.settings.appearanceColors[key] = color;
			this.plugin.refreshAppearance(); this.plugin.requestSaveSettings();
		};
		for (const key of keys) {
			const row = doc.createElement("div"); row.className = "nya-color-row"; row.dataset.color = key; block.append(row);
			const name = i18n.t(`settings.Appearance.${key}`);
			const label = doc.createElement("span"); label.textContent = name; row.append(label);
			const controls = doc.createElement("div"); controls.className = "nya-color-controls"; row.append(controls);
			const picker = doc.createElement("button"); picker.type = "button"; picker.className = "nya-color-picker";
			const accessibleName = `${i18n.t(`settings.Appearance.${group}`)}: ${name}`;
			picker.setAttribute("aria-label", accessibleName); picker.setAttribute("aria-haspopup", "dialog"); picker.setAttribute("aria-expanded", "false");
			const swatch = doc.createElement("span"); swatch.className = "nya-color-swatch"; picker.append(swatch); controls.append(picker);
			const value = doc.createElement("span"); value.className = "nya-color-code"; controls.append(value);
			const reset = doc.createElement("button"); reset.type = "button"; reset.className = "nya-color-reset";
			reset.setAttribute("aria-label", i18n.t("settings.Appearance.resetColor", { name: accessibleName }));
			setTooltip(reset, i18n.t("settings.Toolbar.reset")); setIcon(reset, "undo-2"); controls.append(reset);
			let current = "";
			const update = () => {
				current = this.plugin.settings.appearanceColors[key] ?? resolvedAppearanceColor(block, key);
				value.textContent = current; swatch.style.backgroundColor = current;
				reset.disabled = !this.plugin.settings.appearanceColors[key];
			};
			updates.set(key, update); update();
			picker.addEventListener("click", () => {
				if (!this.preview || this.page !== "toolbar" || !this.containerEl.contains(picker) || picker.closest("[hidden]")) return;
				this.cleanupSelect?.();
				this.cleanupColor?.(); update();
				const previewRoot = this.previewRoot!;
				const variable = appearanceColors[key].variable;
				this.cleanupColor = openColorPicker({ trigger: picker, color: current, name: accessibleName,
					preview: (color) => {
						if (color === null) previewRoot.style.removeProperty(variable);
						else previewRoot.style.setProperty(variable, color);
					},
					apply: (color) => { if (this.plugin.settings.appearanceColors[key] !== color) commit(key, color); update(); },
				});
			});
			reset.addEventListener("click", () => this.reset(reset, () => { commit(key, null); update(); }));
		}
	}

	private scopeStyles(root: HTMLElement) {
		const updates = new Map<AppearanceColorKey, () => void>();
		const section = this.section(root, "scope", "nya-scope-settings", i18n.t("settings.Appearance.scope"), () => {
			delete this.plugin.settings.appearanceColors.scopeBackground;
			delete this.plugin.settings.appearanceColors.scopeBorder;
			this.plugin.settings.scopeAppearance = defaultScopeAppearance();
			this.plugin.refreshAppearance(); updates.forEach((update) => update());
			renderOptions(); this.plugin.requestSaveSettings();
		}, () => this.cleanupColor?.());
		const block = root.ownerDocument.createElement("div"); block.className = "nya-color-group"; section.append(block);
		this.colorRows(block, "scope", updates, ["scopeBackground"]);
		const options = root.ownerDocument.createElement("div"); block.append(options);
		options.className = "nya-scope-options";
		let widthSelect: SettingsSelect | undefined;
		const commit = () => { this.plugin.refreshAppearance(); this.plugin.requestSaveSettings(); };
		const renderOptions = () => {
			if (widthSelect) { widthSelect.destroy(); this.selectControls.delete(widthSelect); }
			options.replaceChildren();
			const border = new Setting(options).setName(i18n.t("settings.Appearance.scopeBorderEnabled"));
			border.settingEl.classList.add("nya-scope-toggle");
			const details = root.ownerDocument.createElement("div"); details.className = "nya-scope-details";
			details.id = `nya-scope-details-${this.labelId}-${++this.sectionId}`;
			details.hidden = !this.plugin.settings.scopeAppearance.border;
			border.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.scopeAppearance.border);
				toggle.toggleEl.setAttribute("aria-label", i18n.t("settings.Appearance.scopeBorderEnabled"));
				toggle.toggleEl.setAttribute("aria-controls", details.id);
				toggle.onChange((value) => {
					if (!this.preview || this.page !== "toolbar" || !this.containerEl.contains(toggle.toggleEl)
						|| toggle.toggleEl.closest("[hidden]")) return;
					this.cleanupColor?.(); this.cleanupSelect?.();
					if (!value && details.contains(root.ownerDocument.activeElement)) toggle.toggleEl.focus({ preventScroll: true });
					details.hidden = !value;
					this.plugin.settings.scopeAppearance.border = value; commit();
				});
			});
			options.append(details);
			this.colorRows(details, "scope", updates, ["scopeBorder"]);
			const row = root.ownerDocument.createElement("div"); row.className = "nya-color-row"; row.dataset.scopeWidth = ""; details.append(row);
			const label = root.ownerDocument.createElement("span"); label.textContent = i18n.t("settings.Appearance.scopeBorderWidth"); row.append(label);
			const controls = root.ownerDocument.createElement("div"); controls.className = "nya-color-controls"; row.append(controls);
			widthSelect = createSettingsSelect({ container: controls, name: i18n.t("settings.Appearance.scopeBorderWidth"),
				value: String(this.plugin.settings.scopeAppearance.width), items: ["1", "2", "3"].map((value) => ({ value, label: `${value}px` })),
				valid: () => !!this.preview && this.page === "toolbar" && !details.hidden && this.containerEl.contains(row),
				beforeOpen: () => { this.cleanupColor?.(); this.cleanupSelect?.(); this.cleanupSelect = widthSelect!.close; },
				change: (value) => { this.plugin.settings.scopeAppearance.width = Number(value) as 1 | 2 | 3; commit(); },
			});
			this.selectControls.add(widthSelect);
		};
		renderOptions();
	}

	private toolbar(root: HTMLElement, kind: ToolbarKind) {
		const doc = root.ownerDocument;
		const section = this.section(root, kind, "nya-toolbar-settings", i18n.t(`settings.Toolbar.${kind}`), () => {
			if (kind === "search") {
				const defaults = defaultSettings();
				this.plugin.settings.defaultRegexMode = defaults.defaultRegexMode;
				this.plugin.settings.defaultCaseSensitive = defaults.defaultCaseSensitive;
				this.plugin.settings.defaultWholeWord = defaults.defaultWholeWord;
			}
			commit(defaultToolbar(kind)); render();
		}, () => this.cleanupDrag?.());
		const list = doc.createElement("div"); list.className = "nya-toolbar-list"; section.append(list);
		const live = doc.createElement("div"); live.className = "nya-settings-sr";
		live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); section.append(live);
		const key = kind === "search" ? "searchToolbar" : "replaceToolbar";
		const selectControls = new Set<SettingsSelect>();
		const commit = (items: PluginSettings[typeof key]) => {
			if (items === this.plugin.settings[key]) return;
			this.plugin.settings[key] = items;
			this.refreshPreview();
			this.plugin.editorSearch?.refreshToolbars();
			this.plugin.requestSaveSettings();
		};
		const render = (focusId?: string, control = "handle") => {
			selectControls.forEach((control) => { control.destroy(); this.selectControls.delete(control); }); selectControls.clear();
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
				const select = createSettingsSelect<ToolbarPlacement>({ container: placement,
					size: "sm", width: "content",
					name: i18n.t("settings.Toolbar.placement", { name }), value: item.placement,
					items: (["inline", "more", "hidden"] as const).map((value) => ({ value, label: i18n.t(`settings.Toolbar.${value}`) })),
					valid: () => !!this.preview && this.page === "toolbar" && this.containerEl.contains(placement),
					beforeOpen: () => { this.cleanupColor?.(); this.cleanupDrag?.(); this.cleanupSelect?.(); this.cleanupSelect = select.close; },
					change: (value) => commit(this.plugin.settings[key].map((entry) => entry.id === item.id ? { ...entry, placement: value } : entry)),
				});
				selectControls.add(select); this.selectControls.add(select);
				if (kind === "search" && (item.id === "regex" || item.id === "case" || item.id === "wholeWord")) {
					const defaultKey = item.id === "regex" ? "defaultRegexMode" : item.id === "case" ? "defaultCaseSensitive" : "defaultWholeWord";
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
					this.cleanupSelect?.();
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
	}
}
