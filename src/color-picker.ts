import { createColorPicker } from "virtual:color-picker";
import { normalizeColor } from "./appearance";
import { i18n } from "./i18n";

// Only the library owns color/alpha gestures. This shell owns draft, confirmation
// and lifecycle, and never receives the plugin settings or persistence objects.
export function openColorPicker(options: {
	trigger: HTMLButtonElement; color: string; name: string;
	preview: (color: string | null) => void; apply: (color: string) => void;
}): () => void {
	const { trigger, preview, apply } = options;
	const doc = trigger.ownerDocument, win = doc.defaultView!;
	const panel = doc.createElement("div"); panel.className = "nya-color-popover";
	panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", options.name);
	const heading = doc.createElement("div"); heading.className = "nya-color-popover-title"; heading.textContent = options.name; panel.append(heading);
	const picker = createColorPicker(doc); picker.className = "nya-color-library"; picker.color = options.color; panel.append(picker);
	for (const part of ["saturation", "hue", "alpha"]) {
		picker.shadowRoot!.querySelector(`[part="${part}"]`)?.setAttribute("aria-label", i18n.t(`settings.Appearance.${part}`));
	}
	// The library reports alpha as a percentage, so its accessible maximum must
	// use the same scale (the upstream default is 1 with values from 0 to 100).
	picker.shadowRoot!.querySelector('[part="alpha"]')?.setAttribute("aria-valuemax", "100");
	const value = doc.createElement("input"); value.type = "text"; value.className = "nya-color-value";
	value.value = options.color; value.spellcheck = false; value.setAttribute("aria-label", options.name);
	value.title = i18n.t("settings.Appearance.hexHint"); panel.append(value);
	const actions = doc.createElement("div"); actions.className = "nya-color-popover-actions"; panel.append(actions);
	const cancel = doc.createElement("button"); cancel.type = "button"; cancel.textContent = i18n.t("settings.Appearance.cancel"); actions.append(cancel);
	const confirm = doc.createElement("button"); confirm.type = "button"; confirm.className = "mod-cta"; confirm.textContent = i18n.t("settings.Appearance.apply"); actions.append(confirm);
	let draft = options.color, frame: number | undefined, closed = false;
	const stage = (color: string) => {
		if (closed) return;
		draft = color;
		if (frame === undefined) frame = win.requestAnimationFrame(() => { frame = undefined; if (!closed) preview(draft); });
	};
	const cleanup = (restoreFocus = false) => {
		if (closed) return;
		closed = true;
		if (frame !== undefined) win.cancelAnimationFrame(frame);
		doc.removeEventListener("pointerdown", outside, true); doc.removeEventListener("keydown", keys, true);
		win.removeEventListener("pagehide", leave); win.removeEventListener("blur", leave);
		win.removeEventListener("resize", leave); doc.removeEventListener("scroll", scroll, true);
		picker.release(); panel.remove(); preview(null); trigger.setAttribute("aria-expanded", "false");
		if (restoreFocus && trigger.isConnected) trigger.focus();
	};
	const outside = (event: PointerEvent) => { if (!event.composedPath().includes(panel) && !event.composedPath().includes(trigger)) cleanup(); };
	const leave = () => cleanup();
	const scroll = (event: Event) => { if (event.target !== panel && !panel.contains(event.target as Node)) cleanup(); };
	const keys = (event: KeyboardEvent) => {
		if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cleanup(true); }
		else if (event.key === "Enter" && event.composedPath().includes(value)) { event.preventDefault(); event.stopPropagation(); }
		else if (event.key === "Tab" && event.composedPath().includes(panel)) {
			const sliders = Array.from(picker.shadowRoot!.querySelectorAll<HTMLElement>('[tabindex="0"]'));
			const stops = [...sliders, value, cancel, ...(confirm.disabled ? [] : [confirm])];
			const active = picker.shadowRoot!.activeElement ?? doc.activeElement;
			const index = stops.indexOf(active as HTMLElement);
			event.preventDefault(); stops[(index + (event.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
		}
	};
	picker.addEventListener("color-changed", (event) => {
		if (closed) return;
		const color = normalizeColor((event as CustomEvent<{ value: string }>).detail.value);
		if (!color) return;
		value.value = color; value.removeAttribute("aria-invalid"); confirm.disabled = false; stage(color);
	});
	value.addEventListener("input", (event) => {
		if (closed) return;
		if ((event as InputEvent).isComposing) { confirm.disabled = true; return; }
		const color = normalizeColor(value.value);
		confirm.disabled = !color;
		if (!color) { value.setAttribute("aria-invalid", "true"); return; }
		value.removeAttribute("aria-invalid"); picker.color = color; stage(color);
	});
	value.addEventListener("compositionend", () => value.dispatchEvent(new win.Event("input")));
	cancel.addEventListener("click", () => cleanup(true));
	confirm.addEventListener("click", () => { if (!closed && !confirm.disabled) { const color = draft; cleanup(true); apply(color); } });
	// Mount in the owner document, outside the settings scroll/containment area.
	doc.body.append(panel);
	const rect = trigger.getBoundingClientRect();
	panel.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - panel.offsetWidth - 8))}px`;
	panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, win.innerHeight - panel.offsetHeight - 8))}px`;
	trigger.setAttribute("aria-expanded", "true");
	doc.addEventListener("pointerdown", outside, true); doc.addEventListener("keydown", keys, true);
	win.addEventListener("pagehide", leave); win.addEventListener("blur", leave);
	win.addEventListener("resize", leave); doc.addEventListener("scroll", scroll, true);
	picker.shadowRoot!.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
	return cleanup;
}
