import { App, PluginSettingTab, Setting } from "obsidian";
import type TextFinderPlugin from "./main";
import type { PluginSettings } from "./settings";
import { i18n } from "./i18n";
import { HistorySortOrder, type HistorySortOrderType } from "./constants";
import { parseHistoryLimit } from "./history";
import { defaultToolbar, moveToolbarItem, toolbarLabels, type ToolbarKind, type ToolbarPlacement } from "./toolbar";

type SettingsPage = "find" | "replace" | "history" | "toolbar";
type ToggleKey = { [K in keyof PluginSettings]: PluginSettings[K] extends boolean ? K : never }[keyof PluginSettings];
const pages: SettingsPage[] = ["find", "replace", "history", "toolbar"];

export class SettingTab extends PluginSettingTab {
	private page: SettingsPage = "find";
	private cleanupDrag?: () => void;

	constructor(app: App, public plugin: TextFinderPlugin) { super(app, plugin); }

	display() {
		this.cleanupDrag?.();
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
			const description = root.ownerDocument.createElement("p");
			description.className = "nya-settings-description";
			description.textContent = i18n.t("settings.Toolbar.desc"); root.append(description);
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
			this.plugin.editorSearch?.refreshToolbars();
			this.plugin.requestSaveSettings();
		};
		const render = (focusId?: string, control = "handle") => {
			list.replaceChildren();
			this.plugin.settings[key].forEach((item, index, items) => {
				const row = doc.createElement("div"); row.className = "nya-toolbar-row"; row.dataset.action = item.id; list.append(row);
				const name = i18n.t(toolbarLabels[item.id]);
				const button = (text: string, label: string, controlName: string) => {
					const el = doc.createElement("button"); el.type = "button"; el.textContent = text;
					el.setAttribute("aria-label", label); el.dataset.control = controlName; row.append(el); return el;
				};
				const handle = button("⠿", i18n.t("settings.Toolbar.drag", { name }), "handle");
				handle.className = "nya-toolbar-handle";
				const label = doc.createElement("span"); label.className = "nya-toolbar-name"; label.textContent = name; row.append(label);
				const select = doc.createElement("select"); select.setAttribute("aria-label", i18n.t("settings.Toolbar.placement", { name }));
				for (const placement of ["inline", "more", "hidden"] as const) {
					const option = doc.createElement("option"); option.value = placement; option.textContent = i18n.t(`settings.Toolbar.${placement}`); select.append(option);
				}
				select.value = item.placement; row.append(select);
				select.addEventListener("change", () => commit(this.plugin.settings[key].map((entry) => entry.id === item.id ? { ...entry, placement: select.value as ToolbarPlacement } : entry)));
				const move = (boundary: number, controlName: string) => {
					commit(moveToolbarItem(this.plugin.settings[key], index, boundary));
					render(item.id, controlName); live.textContent = i18n.t("settings.Toolbar.moved", { name });
				};
				const up = button("↑", i18n.t("settings.Toolbar.up", { name }), "up"); up.disabled = index === 0;
				const down = button("↓", i18n.t("settings.Toolbar.down", { name }), "down"); down.disabled = index === items.length - 1;
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
		reset.addEventListener("click", () => { this.cleanupDrag?.(); commit(defaultToolbar(kind)); render(); });
	}
}
