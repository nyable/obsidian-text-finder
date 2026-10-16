// Public CSS variables remain the presentation interface. Empty overrides inherit
// the host theme, snippets and Style Settings instead of writing fixed defaults.
export const appearanceColors = {
	focusBorder: {
		variable: "--nya-focus-border-color",
		default: "#2488db",
		group: "panel",
		opacity: false,
	},
	accentStrip: {
		variable: "--nya-dragger-color",
		default: "#39c5bb",
		group: "panel",
		opacity: false,
	},
	matchBackground: {
		variable: "--nya-match-bgColor",
		default: "#ea5c0054",
		group: "match",
		opacity: true,
	},
	matchText: {
		variable: "--nya-match-color",
		default: "#ffffff",
		group: "match",
		opacity: false,
	},
	currentMatchBackground: {
		variable: "--nya-match-curbgColor",
		default: "#fafa00f2",
		group: "current",
		opacity: true,
	},
	currentMatchText: {
		variable: "--nya-match-curColor",
		default: "#ff0000",
		group: "current",
		opacity: false,
	},
	scopeBackground: {
		variable: "--nya-scope-background",
		default: "var(--background-modifier-hover)",
		group: "scope",
		opacity: true,
	},
	scopeBorder: {
		variable: "--nya-scope-border-color",
		default: "var(--interactive-accent)",
		group: "scope",
		opacity: true,
	},
} as const;
export type AppearanceColorKey = keyof typeof appearanceColors;
export type AppearanceColors = Partial<Record<AppearanceColorKey, string>>;
export const colorKeys = Object.keys(appearanceColors) as AppearanceColorKey[];

export function normalizeColor(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value.trim())
	)
		return null;
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
	const alpha = Math.round((Math.max(0, Math.min(100, opacity)) * 255) / 100);
	return base.slice(0, 7) + (alpha === 255 ? "" : alpha.toString(16).padStart(2, "0"));
}

export function colorOpacity(color: string): number {
	return Math.round((color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1) * 100);
}

export interface ScopeAppearance {
	border: boolean;
	width: 1 | 2 | 3;
}
export const defaultScopeAppearance = (): ScopeAppearance => ({ border: false, width: 1 });
export function normalizeScopeAppearance(raw: unknown): ScopeAppearance {
	const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	return {
		border: input.border === true,
		width: input.width === 2 || input.width === 3 ? input.width : 1,
	};
}
