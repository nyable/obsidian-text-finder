// Public CSS variables remain the presentation interface. Empty overrides inherit
// the host theme, snippets and Style Settings instead of writing fixed defaults.
export const appearanceColors = {
	focusBorder: { variable: "--nya-focus-border-color", default: "#2488db", group: "panel", opacity: false },
	accentStrip: { variable: "--nya-dragger-color", default: "#39c5bb", group: "panel", opacity: false },
	matchBackground: { variable: "--nya-match-bgColor", default: "#ea5c0054", group: "match", opacity: true },
	matchText: { variable: "--nya-match-color", default: "#ffffff", group: "match", opacity: false },
	currentMatchBackground: { variable: "--nya-match-curbgColor", default: "#fafa00f2", group: "current", opacity: true },
	currentMatchText: { variable: "--nya-match-curColor", default: "#ff0000", group: "current", opacity: false },
} as const;
export type AppearanceColorKey = keyof typeof appearanceColors;
export type AppearanceColors = Partial<Record<AppearanceColorKey, string>>;
export const colorKeys = Object.keys(appearanceColors) as AppearanceColorKey[];

export function normalizeColor(value: unknown): string | null {
	if (typeof value !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value.trim())) return null;
	let hex = value.trim().slice(1).toLowerCase();
	if (hex.length <= 4) hex = [...hex].map((char) => char + char).join("");
	if (hex.length === 8 && hex.endsWith("ff")) hex = hex.slice(0, 6);
	return `#${hex}`;
}

export function normalizeAppearanceColors(raw: unknown): AppearanceColors {
	const colors: AppearanceColors = {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return colors;
	for (const key of colorKeys) {
		const color = normalizeColor((raw as Record<string, unknown>)[key]);
		if (color) colors[key] = color;
	}
	return colors;
}

export function colorWithOpacity(color: string, opacity: number): string {
	const base = normalizeColor(color) ?? "#000000";
	const alpha = Math.round(Math.max(0, Math.min(100, opacity)) * 255 / 100);
	return base.slice(0, 7) + (alpha === 255 ? "" : alpha.toString(16).padStart(2, "0"));
}

export function colorOpacity(color: string): number {
	return Math.round((color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1) * 100);
}

// Resolve inherited values through computed color, including rgb(), named colors
// and nested theme variables. The temporary probe does not change the source CSS.
export function resolvedAppearanceColor(root: HTMLElement, key: AppearanceColorKey): string {
	const definition = appearanceColors[key];
	const probe = root.ownerDocument.createElement("span");
	probe.style.color = `var(${definition.variable}, ${definition.default})`;
	probe.hidden = true; root.append(probe);
	try {
		const value = root.ownerDocument.defaultView?.getComputedStyle(probe).color ?? "";
		const hex = normalizeColor(value);
		if (hex) return hex;
		const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
		if (rgb) {
			const base = "#" + rgb.slice(1, 4).map((channel) => Math.round(Math.min(255, Math.max(0, Number(channel)))).toString(16).padStart(2, "0")).join("");
			return colorWithOpacity(base, rgb[4] === undefined ? 100 : Number(rgb[4]) * 100);
		}
		return definition.default;
	} finally { probe.remove(); }
}

export class AppearanceStyles {
	private documents = new Map<Document, { style?: HTMLStyleElement; cleanup: () => void }>();
	private closed = false;
	constructor(private colors: () => AppearanceColors) {}

	addDocument(doc: Document) {
		if (this.closed || this.documents.has(doc)) return;
		const release = () => this.removeDocument(doc);
		doc.defaultView?.addEventListener("pagehide", release);
		this.documents.set(doc, { cleanup: () => doc.defaultView?.removeEventListener("pagehide", release) });
		this.refresh();
	}
	removeDocument(doc: Document) {
		const resource = this.documents.get(doc);
		resource?.style?.remove(); resource?.cleanup(); this.documents.delete(doc);
	}
	refresh() {
		if (this.closed) return;
		const colors = normalizeAppearanceColors(this.colors());
		const declarations = colorKeys.filter((key) => colors[key]).map((key) => `${appearanceColors[key].variable}: ${colors[key]} !important;`).join("\n");
		for (const [doc, resource] of this.documents) {
			if (!declarations) { resource.style?.remove(); resource.style = undefined; continue; }
			if (!resource.style) {
				resource.style = doc.createElement("style");
				resource.style.dataset.nyaAppearance = "";
				(doc.head ?? doc.documentElement).append(resource.style);
			}
			resource.style.textContent = `body {\n${declarations}\n}`;
		}
	}
	destroy() {
		this.closed = true;
		for (const doc of this.documents.keys()) this.removeDocument(doc);
	}
}
