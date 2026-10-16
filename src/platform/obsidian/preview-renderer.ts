import type { MarkdownView } from "obsidian";

export interface PreviewSection {
	el: HTMLElement;
	rendered: boolean;
}
export interface PreviewRenderer {
	sections: PreviewSection[];
	header?: PreviewSection | null;
	footer?: PreviewSection | null;
	text: string;
	lastText: string | null;
	parsing: boolean;
	rendered: unknown[] | null;
	previewEl: HTMLElement;
	showSection(section: PreviewSection): void;
	applyScrollSection(section: PreviewSection): boolean;
	updateVirtualDisplay(): void;
	onRendered(callback: () => void): void;
}

/** The context menu needs only a body and its render stamp, not the full-text
 * rendering API. Keep that weaker capability separate from rendererFor(). */
export function capturePreviewBody(view: MarkdownView): {
	body: HTMLElement;
	current(): boolean;
} | null {
	const preview = view.previewMode as { renderer?: unknown } | undefined;
	const renderer = preview?.renderer;
	if (!renderer || typeof renderer !== "object") return null;
	const candidate = renderer as { previewEl?: HTMLElement; lastText?: unknown };
	const body = candidate.previewEl;
	if (!body?.ownerDocument?.defaultView || typeof body.contains !== "function") return null;
	const rendered = candidate.lastText;
	return {
		body,
		current: () => {
			const next = view.previewMode as { renderer?: unknown } | undefined;
			return next?.renderer === renderer && candidate.lastText === rendered;
		},
	};
}

/** Public preview APIs cannot enumerate detached sections. Shape-checked against
 * Obsidian 1.14.4; an unavailable bridge must not publish partial full-text results. */
export function rendererFor(view: MarkdownView): PreviewRenderer | null {
	const r = (view.previewMode as unknown as { renderer?: Partial<PreviewRenderer> } | undefined)
		?.renderer;
	if (
		!r ||
		!Array.isArray(r.sections) ||
		typeof r.text !== "string" ||
		!(r.lastText === null || typeof r.lastText === "string") ||
		!(r.rendered === null || Array.isArray(r.rendered)) ||
		typeof r.parsing !== "boolean" ||
		!r.previewEl?.ownerDocument?.defaultView ||
		typeof r.showSection !== "function" ||
		typeof r.applyScrollSection !== "function" ||
		typeof r.updateVirtualDisplay !== "function" ||
		typeof r.onRendered !== "function"
	)
		return null;
	return r as PreviewRenderer;
}
