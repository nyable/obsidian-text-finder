import {
	endpointRange,
	pointRange,
	readingBreaks,
	readingMatchEndpoints,
	type ReadingTextIndex,
	type ReadingBreak,
} from "./reading-text";
import {
	normalizeScopeRects,
	paddedScopeOutlines,
	createScopeSvg,
	type ScopeRect,
} from "../../../shared/geometry/scope-outline";

export class ReadingOverlay {
	private element: HTMLElement | null = null;
	private cleanup: (() => void) | undefined;
	constructor(
		private root: HTMLElement,
		private changed: () => void,
	) {}
	private mount() {
		if (this.element) return this.element;
		const doc = this.root.ownerDocument,
			win = doc.defaultView!;
		const el = doc.createElement("div");
		el.className = "nya-reading-overlay";
		el.setAttribute("aria-hidden", "true");
		el.style.visibility = "hidden";
		// Body portal: drawing never mutates indexed/observed preview content.
		doc.body.append(el);
		this.element = el;
		const observer =
			typeof win.ResizeObserver === "function"
				? new win.ResizeObserver(this.changed)
				: undefined;
		observer?.observe(this.root);
		this.root
			.querySelectorAll<HTMLElement>(":scope > *")
			.forEach((element) => observer?.observe(element));
		const fonts = doc.fonts;
		fonts?.addEventListener("loadingdone", this.changed);
		doc.addEventListener("scroll", this.changed, true);
		win.addEventListener("resize", this.changed);
		this.root.addEventListener("load", this.changed, true);
		doc.addEventListener("nya-scope-style-change", this.changed);
		win.visualViewport?.addEventListener("resize", this.changed);
		win.visualViewport?.addEventListener("scroll", this.changed);
		this.cleanup = () => {
			observer?.disconnect();
			doc.removeEventListener("scroll", this.changed, true);
			win.removeEventListener("resize", this.changed);
			this.root.removeEventListener("load", this.changed, true);
			fonts?.removeEventListener("loadingdone", this.changed);
			doc.removeEventListener("nya-scope-style-change", this.changed);
			win.visualViewport?.removeEventListener("resize", this.changed);
			win.visualViewport?.removeEventListener("scroll", this.changed);
		};
		return el;
	}
	paint(
		index: ReadingTextIndex,
		scopes: readonly SearchRange[],
		matches: readonly MatchOffset[],
		current: number,
	) {
		const breaks = matches.flatMap((match, i) =>
			readingBreaks(index, match.from, match.to).map((br) => ({
				br,
				current: i === current,
			})),
		);
		if (!scopes.length && !breaks.length) {
			this.destroy();
			return;
		}
		const doc = this.root.ownerDocument,
			win = doc.defaultView!,
			bounds = this.root.getBoundingClientRect();
		const width =
			parseFloat(
				win.getComputedStyle(this.root).getPropertyValue("--nya-scope-border-width"),
			) || 0;
		const el = this.mount();
		el.replaceChildren();
		el.style.visibility = "";
		el.style.left = `${bounds.left}px`;
		el.style.top = `${bounds.top}px`;
		el.style.width = `${bounds.width}px`;
		el.style.height = `${bounds.height}px`;
		let left = Math.max(0, bounds.left),
			right = Math.min(win.innerWidth, bounds.right);
		let top = Math.max(0, bounds.top),
			bottom = Math.min(win.innerHeight, bounds.bottom);
		for (let parent = this.root.parentElement; parent; parent = parent.parentElement) {
			const style = win.getComputedStyle(parent),
				box = parent.getBoundingClientRect();
			if (/(auto|scroll|hidden|clip)/.test(style.overflowX || style.overflow)) {
				left = Math.max(left, box.left);
				right = Math.min(right, box.right);
			}
			if (/(auto|scroll|hidden|clip)/.test(style.overflowY || style.overflow)) {
				top = Math.max(top, box.top);
				bottom = Math.min(bottom, box.bottom);
			}
		}
		el.style.clipPath = `inset(${Math.max(0, top - bounds.top)}px ${Math.max(0, bounds.right - right)}px ${Math.max(0, bounds.bottom - bottom)}px ${Math.max(0, left - bounds.left)}px)`;
		for (const key of [
			"--nya-scope-border-color",
			"--nya-scope-border-width",
			"--nya-match-bgColor",
			"--nya-match-color",
			"--nya-match-curbgColor",
			"--nya-match-curColor",
		])
			el.style.setProperty(key, win.getComputedStyle(this.root).getPropertyValue(key));
		const local = (box: DOMRect | ScopeRect): ScopeRect => ({
			left: box.left - bounds.left,
			right: box.right - bounds.left,
			top: box.top - bounds.top,
			bottom: box.bottom - bounds.top,
		});
		const groups = new Map<string, ScopeRect[]>();
		if (width > 0)
			scopes.forEach((scope, id) => {
				const boxes: ScopeRect[] = [];
				for (const endpoint of readingMatchEndpoints(index, scope.from, scope.to)) {
					if (!this.root.contains(endpoint.node)) continue;
					const range = endpointRange(endpoint);
					if (typeof range.getClientRects === "function")
						for (const box of Array.from(range.getClientRects()))
							if (box.width > 0 && box.height > 0) boxes.push(local(box));
				}
				groups.set(String(id), boxes);
			});
		const normalized = normalizeScopeRects(groups);
		if (width > 0)
			scopes.forEach((scope, id) => {
				const boxes = normalized.get(String(id))!;
				let previous: ScopeRect | null = null;
				let previousOffset = -2;
				for (const br of readingBreaks(index, scope.from, scope.to)) {
					// Never bridge arbitrary paragraph margins or excluded/embedded blocks.
					if (br.kind === "block") {
						previous = null;
						continue;
					}
					const box = readingBreakRect(this.root, br);
					if (box) {
						const current = local(box);
						boxes.push(current);
						if (
							previous &&
							br.from === previousOffset + 1 &&
							Math.abs(previous.left - current.left) < 2 &&
							current.top >= previous.bottom &&
							current.top - previous.bottom <=
								Math.max(
									current.bottom - current.top,
									previous.bottom - previous.top,
								)
						)
							boxes.push({
								left: current.left,
								right: current.right,
								top: previous.bottom,
								bottom: current.top,
							});
						previous = current;
						previousOffset = br.from;
					} else previous = null;
				}
			});
		if (width > 0)
			for (const path of paddedScopeOutlines([...normalized.values()], width))
				el.append(createScopeSvg(doc, path));
		for (const entry of breaks) {
			const box = readingBreakRect(this.root, entry.br);
			if (!box) continue;
			const glyph = doc.createElement("div");
			glyph.className = `nya-newline-match nya-text-finder-match${entry.current ? " nya-text-finder-match-current" : ""}`;
			const rtl =
				win.getComputedStyle(
					entry.br.element ?? entry.br.before.node.parentElement ?? this.root,
				).direction === "rtl";
			const size = Math.max(6, Math.min(16, box.bottom - box.top));
			glyph.dataset.direction = rtl ? "rtl" : "ltr";
			glyph.style.cssText = `position:absolute;left:${box.left - bounds.left - (rtl ? size : 0)}px;top:${box.top - bounds.top}px;width:${size}px;height:${box.bottom - box.top}px;font-size:${size}px`;
			el.append(glyph);
		}
	}
	hide() {
		if (this.element) this.element.style.visibility = "hidden";
	}
	destroy() {
		this.cleanup?.();
		this.cleanup = undefined;
		this.element?.remove();
		this.element = null;
	}
}

export function readingBreakRect(root: HTMLElement, br: ReadingBreak): ScopeRect | null {
	if (
		!root.contains(br.before.node) ||
		(br.kind !== "block" && br.after && !root.contains(br.after.node))
	)
		return null;
	let range = pointRange(br.before),
		box =
			typeof range.getBoundingClientRect === "function"
				? range.getBoundingClientRect()
				: null;
	if ((!box || box.height <= 0) && br.element) box = br.element.getBoundingClientRect();
	if ((!box || box.height <= 0) && br.before.node.nodeType === 3 && br.before.offset > 0) {
		range = br.before.node.ownerDocument!.createRange();
		range.setStart(br.before.node, br.before.offset - 1);
		range.setEnd(br.before.node, br.before.offset);
		box =
			typeof range.getBoundingClientRect === "function"
				? range.getBoundingClientRect()
				: null;
		if (box && box.height > 0)
			return { left: box.right, right: box.right + 2, top: box.top, bottom: box.bottom };
	}
	return box && box.height > 0 && [box.left, box.top, box.bottom].every(Number.isFinite)
		? { left: box.left, right: box.left + 2, top: box.top, bottom: box.bottom }
		: null;
}
import type { MatchOffset, SearchRange } from "../../../core/search/types";
