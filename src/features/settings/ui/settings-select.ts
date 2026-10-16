import { setIcon } from "obsidian";

let nextSelectId = 0;

export type SettingsSelectSize = "sm" | "md";
export type SettingsSelectWidth = "content" | "fill";

export interface SettingsSelect {
	trigger: HTMLButtonElement;
	close: () => void;
	destroy: () => void;
}

// A small select-only combobox. Navigation is provisional; only explicit
// selection calls change(). All popup resources belong to the trigger's window.
export function createSettingsSelect<T extends string>(options: {
	container: HTMLElement;
	name: string;
	value: T;
	size?: SettingsSelectSize;
	width?: SettingsSelectWidth;
	items: readonly { value: T; label: string }[];
	valid: () => boolean;
	beforeOpen: () => void;
	change: (value: T) => void;
}): SettingsSelect {
	const { container, items } = options;
	const doc = container.ownerDocument,
		win = doc.defaultView!;
	const id = `nya-settings-select-${++nextSelectId}`;
	const trigger = doc.createElement("button");
	trigger.type = "button";
	trigger.className = "nya-settings-select";
	trigger.dataset.size = options.size ?? "sm";
	trigger.dataset.width = options.width ?? "content";
	trigger.id = id;
	trigger.dataset.control = "placement";
	trigger.setAttribute("role", "combobox");
	trigger.setAttribute("aria-label", options.name);
	trigger.setAttribute("aria-haspopup", "listbox");
	trigger.setAttribute("aria-expanded", "false");
	const label = doc.createElement("span");
	label.className = "nya-settings-select-value";
	trigger.append(label);
	// Intrinsic grid sizing works even while a section is hidden, follows font
	// changes and keeps the width stable when a shorter option is selected.
	const sizing = doc.createElement("span");
	sizing.className = "nya-settings-select-sizing";
	sizing.setAttribute("aria-hidden", "true");
	items.forEach((item) => {
		const text = doc.createElement("span");
		text.textContent = item.label;
		sizing.append(text);
	});
	trigger.append(sizing);
	const arrow = doc.createElement("span");
	arrow.className = "nya-toolbar-select-arrow";
	arrow.setAttribute("aria-hidden", "true");
	setIcon(arrow, "chevron-down");
	trigger.append(arrow);
	container.append(trigger);
	let value = options.value,
		active = 0,
		panel: HTMLDivElement | undefined,
		destroyed = false;
	const available = () =>
		!destroyed && trigger.isConnected && !trigger.closest("[hidden]") && options.valid();
	const update = () => {
		label.textContent = items.find((item) => item.value === value)!.label;
		trigger.dataset.value = value;
	};
	update();
	const close = (restoreFocus = false) => {
		if (!panel) return;
		doc.removeEventListener("pointerdown", outside, true);
		doc.removeEventListener("scroll", scroll, true);
		doc.removeEventListener("focusin", focus, true);
		win.removeEventListener("blur", leave);
		win.removeEventListener("pagehide", leave);
		win.removeEventListener("resize", leave);
		panel.remove();
		panel = undefined;
		trigger.setAttribute("aria-expanded", "false");
		trigger.removeAttribute("aria-controls");
		trigger.removeAttribute("aria-activedescendant");
		if (restoreFocus && available()) trigger.focus();
	};
	const leave = () => close();
	const outside = (event: PointerEvent) => {
		if (!event.composedPath().includes(trigger) && !event.composedPath().includes(panel!))
			close();
	};
	const scroll = (event: Event) => {
		if (event.target !== panel && !panel?.contains(event.target as Node)) close();
	};
	const focus = (event: FocusEvent) => {
		if (event.target !== trigger && !panel?.contains(event.target as Node)) close();
	};
	const highlight = (reveal = true) => {
		if (!panel) return;
		Array.from(panel.children).forEach((node, index) => {
			(node as HTMLElement).dataset.highlighted = String(index === active);
		});
		trigger.setAttribute("aria-activedescendant", `${id}-option-${active}`);
		// Scroll only this list, never an ancestor settings page or the document.
		const row = panel.children[active] as HTMLElement;
		if (reveal && row.offsetTop < panel.scrollTop) panel.scrollTop = row.offsetTop;
		else if (
			reveal &&
			row.offsetTop + row.offsetHeight > panel.scrollTop + panel.clientHeight
		) {
			panel.scrollTop = row.offsetTop + row.offsetHeight - panel.clientHeight;
		}
	};
	const choose = (index: number) => {
		if (!panel || !available()) {
			close();
			return;
		}
		const item = items[index];
		if (!item) {
			close();
			return;
		}
		const next = item.value;
		close(true);
		if (next !== value) {
			value = next;
			update();
			options.change(value);
		}
	};
	const open = () => {
		if (panel || !available()) return;
		options.beforeOpen();
		if (!available()) return;
		active = items.findIndex((item) => item.value === value);
		panel = doc.createElement("div");
		panel.className = "nya-settings-select-popover";
		panel.id = `${id}-list`;
		panel.dataset.size = trigger.dataset.size;
		// The portal cannot inherit typography or local tokens from the settings
		// container. Resolve them in the owner window on every open (theme-safe).
		const style = win.getComputedStyle(trigger);
		for (const property of [
			"font-family",
			"font-size",
			"font-weight",
			"font-style",
			"font-variant",
			"letter-spacing",
			"line-height",
			"--nya-select-height",
			"--nya-select-option-height",
			"--nya-select-padding-inline",
			"--nya-select-icon-size",
			"--nya-select-gap",
		]) {
			panel.style.setProperty(property, style.getPropertyValue(property));
		}
		panel.setAttribute("role", "listbox");
		panel.setAttribute("aria-labelledby", trigger.id);
		const currentPanel = panel;
		items.forEach((item, index) => {
			const row = doc.createElement("div");
			row.className = "nya-settings-select-option";
			row.id = `${id}-option-${index}`;
			row.setAttribute("role", "option");
			row.setAttribute("aria-selected", String(item.value === value));
			row.dataset.value = item.value;
			const text = doc.createElement("span");
			text.textContent = item.label;
			row.append(text);
			const check = doc.createElement("span");
			check.className = "nya-settings-select-check";
			check.setAttribute("aria-hidden", "true");
			setIcon(check, "check");
			row.append(check);
			panel!.append(row);
			row.addEventListener("pointerdown", (event) => event.preventDefault());
			row.addEventListener("pointermove", () => {
				if (panel === currentPanel) {
					active = index;
					highlight(false);
				}
			});
			row.addEventListener("click", () => {
				if (panel === currentPanel) choose(index);
			});
		});
		// Outside the settings scroll area, but never outside its owner Document.
		doc.body.append(panel);
		const rect = trigger.getBoundingClientRect();
		panel.style.width = `${Math.min(rect.width, Math.max(0, win.innerWidth - 16))}px`;
		const below = Math.max(0, win.innerHeight - rect.bottom - 14),
			above = Math.max(0, rect.top - 14);
		const upward = below < panel.offsetHeight && above > below;
		panel.style.maxHeight = `${upward ? above : below}px`;
		panel.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - panel.offsetWidth - 8))}px`;
		panel.style.top = `${Math.max(8, upward ? rect.top - panel.offsetHeight - 6 : rect.bottom + 6)}px`;
		trigger.setAttribute("aria-expanded", "true");
		trigger.setAttribute("aria-controls", panel.id);
		trigger.focus();
		highlight();
		doc.addEventListener("pointerdown", outside, true);
		doc.addEventListener("scroll", scroll, true);
		doc.addEventListener("focusin", focus, true);
		win.addEventListener("blur", leave);
		win.addEventListener("pagehide", leave);
		win.addEventListener("resize", leave);
	};
	const click = () => {
		if (panel) close();
		else open();
	};
	const keys = (event: KeyboardEvent) => {
		if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.key === "Tab") {
			close();
			return;
		}
		if (event.key === "Escape" && panel) {
			event.preventDefault();
			event.stopPropagation();
			close(true);
			return;
		}
		if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
			if (!panel) {
				open();
				if (event.key === "Home" || event.key === "End") {
					active = event.key === "Home" ? 0 : items.length - 1;
					highlight();
				}
				return;
			}
			if (event.key === "Enter" || event.key === " ") {
				choose(active);
				return;
			}
			if (event.key === "Home") active = 0;
			else if (event.key === "End") active = items.length - 1;
			else
				active =
					(active + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
			highlight();
		}
	};
	trigger.addEventListener("click", click);
	trigger.addEventListener("keydown", keys);
	return {
		trigger,
		close: () => close(),
		destroy: () => {
			close();
			destroyed = true;
			trigger.removeEventListener("click", click);
			trigger.removeEventListener("keydown", keys);
		},
	};
}
