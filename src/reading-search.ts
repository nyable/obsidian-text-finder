import type { MarkdownView, TFile } from "obsidian";
import { indexReadingText, readingMatchRanges, type ReadingTextIndex } from "./reading-text";
import { findTextOffsets } from "./util/text-helper";

/**
 * Obsidian's public preview API cannot enumerate detached virtual sections.
 * Keep this private bridge in one place and fail closed if its shape changes.
 * Interface shape checked against the renderer shipped in Obsidian 1.14.4.
 */
interface PreviewSection {
	el: HTMLElement;
	rendered: boolean;
}
interface PreviewRenderer {
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
interface HighlightValue {
	priority: number;
	add(range: Range): void;
}
interface HighlightWindow {
	CSS?: { highlights?: Map<string, HighlightValue> };
	Highlight?: new (...ranges: Range[]) => HighlightValue;
}

const ALL = "nya-reading-matches";
const CURRENT = "nya-reading-current";
const documents = new WeakMap<Document, Map<ReadingSearch, { all: Range[]; current: Range[] }>>();

function highlightWindow(doc: Document) { return doc.defaultView as unknown as HighlightWindow | null; }

function rendererFor(view: MarkdownView): PreviewRenderer | null {
	const renderer = (view.previewMode as unknown as { renderer?: Partial<PreviewRenderer> } | undefined)?.renderer;
	if (!renderer || !Array.isArray(renderer.sections)
		|| typeof renderer.text !== "string" || !(renderer.lastText === null || typeof renderer.lastText === "string")
		|| !(renderer.rendered === null || Array.isArray(renderer.rendered))
		|| typeof renderer.parsing !== "boolean" || !renderer.previewEl?.ownerDocument
		|| typeof renderer.showSection !== "function" || typeof renderer.applyScrollSection !== "function"
		|| typeof renderer.updateVirtualDisplay !== "function" || typeof renderer.onRendered !== "function"
		|| renderer.sections.some((section) => !section?.el?.ownerDocument || typeof section.rendered !== "boolean")) return null;
	return renderer as PreviewRenderer;
}

export interface ReadingResult {
	matches: MatchOffset[];
	index: number;
	pending: boolean;
	unsupported: boolean;
}

export class ReadingSearch {
	private disposed = false;
	private generation = 0;
	private dirty = true;
	private renderer: PreviewRenderer | null = null;
	private file: TFile | null = null;
	private sections: PreviewSection[] | null = null;
	private source: string | null = null;
	private textIndex: ReadingTextIndex | null = null;
	private observers: MutationObserver[] = [];
	private timer: number | null = null;
	private doc: Document | null = null;
	private results: { match: MatchOffset; ranges: Range[]; section: PreviewSection }[] = [];
	private queryKey = "";
	private nodeSections = new WeakMap<Node, PreviewSection>();

	constructor(private view: MarkdownView, private isOpen: () => boolean, private changed: () => void) {}

	static supported(view: MarkdownView): boolean {
		const renderer = rendererFor(view);
		const win = renderer && highlightWindow(renderer.previewEl.ownerDocument);
		return !!renderer && !!win?.CSS?.highlights && typeof win.Highlight === "function";
	}

	private current(renderer: PreviewRenderer, file: TFile | null) {
		return !this.disposed && this.isOpen() && this.view.getMode() === "preview"
			&& this.view.file === file && rendererFor(this.view) === renderer;
	}

	private ready(renderer: PreviewRenderer) {
		return renderer.text === renderer.lastText && !renderer.parsing && renderer.rendered === null
			&& (typeof this.view.getViewData !== "function" || this.view.getViewData() === renderer.text)
			&& renderer.sections.every((section) => section.rendered);
	}

	search(text: string, options: SearchOptions, index: number, scroll: boolean, done: (result: ReadingResult) => void) {
		const generation = ++this.generation;
		const renderer = rendererFor(this.view);
		const file = this.view.file;
		if (!renderer || !ReadingSearch.supported(this.view) || !this.current(renderer, file)) {
			this.clear();
			done({ matches: [], index: 0, pending: false, unsupported: !!this.isOpen() && this.view.getMode() === "preview" });
			return;
		}
		if (!text) { this.clear(); done({ matches: [], index: 0, pending: false, unsupported: false }); return; }
		const run = () => {
			if (generation !== this.generation || !this.current(renderer, file)) return;
			if (!this.ready(renderer)) {
				// A newer render pass will notify us through section/root mutations.
				done({ matches: [], index: 0, pending: true, unsupported: false });
				return;
			}
			const key = JSON.stringify([text, options.regexMode, options.caseSensitive]);
			if (this.observers.some((observer) => observer.takeRecords().some((record) => this.contentMutation(record)))) this.dirty = true;
			const newDocument = this.file !== file || this.renderer !== renderer;
			if (this.dirty || newDocument || this.sections !== renderer.sections || this.source !== renderer.lastText
				|| this.doc !== renderer.previewEl.ownerDocument) {
				this.removeHighlights();
				this.renderer = renderer;
				this.file = file;
				this.sections = renderer.sections;
				this.source = renderer.lastText;
				const roots = renderer.sections.filter((section) => section !== renderer.header && section !== renderer.footer
					&& !section.el.matches(".mod-header, .mod-footer")).map((section) => section.el);
				this.textIndex = indexReadingText(roots);
				const rootSections = new Map(renderer.sections.map((section) => [section.el, section]));
				this.nodeSections = new WeakMap();
				for (const span of this.textIndex.spans) {
					let el = span.node.parentElement;
					while (el && !rootSections.has(el)) el = el.parentElement;
					if (el) this.nodeSections.set(span.node, rootSections.get(el)!);
				}
				this.watch(renderer, roots);
				this.dirty = false;
				this.queryKey = "";
			}
			if (newDocument) index = 0;
			if (key !== this.queryKey) {
				const textIndex = this.textIndex!;
				this.results = findTextOffsets(textIndex.text, text, options.regexMode, options.caseSensitive)
					.map((match) => {
						const ranges = readingMatchRanges(textIndex, match.from, match.to);
						const section = ranges[0] && this.nodeSections.get(ranges[0].startContainer);
						return section ? { match, ranges, section } : null;
					}).filter((result): result is NonNullable<typeof result> => result !== null);
				this.queryKey = key;
			}
			index = index >= 0 && index < this.results.length ? index : 0;
			this.paint(index);
			if (scroll) this.scroll(index);
			done({ matches: this.results.map(({ match }, i) => ({ ...match, index: i })), index, pending: false, unsupported: false });
		};
		if (this.ready(renderer)) run();
		else {
			this.removeHighlights();
			this.dirty = true;
			this.renderer = renderer;
			this.watch(renderer, renderer.sections.map((section) => section.el));
			done({ matches: [], index: 0, pending: true, unsupported: false });
			// Obsidian calls render callbacks before clearing its pending-render flag.
			renderer.onRendered(() => { void Promise.resolve().then(run); });
		}
	}

	private contentMutation(record: MutationRecord): boolean {
		if (record.type !== "childList") return true;
		const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
		// Moving cached sections in/out of the sizer is virtualization, not a text edit.
		return !nodes.length || !nodes.every((node) => this.renderer?.sections.some((section) => section.el === node));
	}

	private watch(renderer: PreviewRenderer, roots: HTMLElement[]) {
		this.disconnect();
		const doc = renderer.previewEl.ownerDocument;
		const win = doc.defaultView!;
		this.doc = doc;
		const observe = (root: HTMLElement) => {
			const observer = new win.MutationObserver((records) => {
				if (!records.some((record) => this.contentMutation(record))) return;
				this.dirty = true;
				this.removeHighlights();
				if (this.timer === null) this.timer = win.setTimeout(() => {
					this.timer = null;
					if (!this.disposed) this.changed();
				}, 50);
			});
			observer.observe(root, { childList: true, subtree: true, characterData: true,
				attributes: true, attributeFilter: ["class", "hidden", "aria-hidden"] });
			this.observers.push(observer);
		};
		// Detached sections need their own observers; the preview root alone misses them.
		observe(renderer.previewEl);
		for (const root of roots) observe(root);
	}

	private paint(index: number) {
		const doc = this.renderer?.previewEl.ownerDocument;
		if (!doc) return;
		if (this.doc && this.doc !== doc) this.removeHighlights();
		this.doc = doc;
		let owners = documents.get(doc);
		if (!owners) { owners = new Map(); documents.set(doc, owners); }
		owners.set(this, { all: this.results.flatMap(({ ranges }) => ranges), current: this.results[index]?.ranges ?? [] });
		this.updateRegistry(doc);
	}

	private updateRegistry(doc: Document) {
		const win = highlightWindow(doc);
		if (!win?.CSS?.highlights || !win.Highlight) return;
		const owners = documents.get(doc);
		if (!owners?.size) {
			win.CSS.highlights.delete(ALL);
			win.CSS.highlights.delete(CURRENT);
			return;
		}
		const all = new win.Highlight();
		const current = new win.Highlight();
		// Avoid spreading arbitrarily many ranges as constructor arguments.
		owners.forEach((entry) => {
			entry.all.forEach((range) => all.add(range));
			entry.current.forEach((range) => current.add(range));
		});
		all.priority = 0;
		current.priority = 1;
		win.CSS.highlights.set(ALL, all);
		win.CSS.highlights.set(CURRENT, current);
	}

	private scroll(index: number) {
		const result = this.results[index];
		const renderer = this.renderer;
		if (!result || !renderer || !this.current(renderer, this.file)) return;
		renderer.showSection(result.section);
		if (!renderer.previewEl.contains(result.section.el)) {
			renderer.applyScrollSection(result.section);
			renderer.updateVirtualDisplay();
		}
		const first = result.ranges[0];
		const target = first.startContainer.parentElement;
		// Expand only folded ancestors of the target, not the entire document.
		for (let el = target; el && el !== renderer.previewEl; el = el.parentElement) {
			if (el.matches("li.is-collapsed, .callout.is-collapsed, details:not([open])")) {
				if (el.tagName === "DETAILS") el.setAttribute("open", "");
				else el.querySelector<HTMLElement>(":scope > .list-collapse-indicator, :scope > .callout-title")?.click();
			}
		}
		if (!renderer.previewEl.contains(first.startContainer)) return;
		const rect = typeof first.getBoundingClientRect === "function" ? first.getBoundingClientRect() : null;
		const parentRect = renderer.previewEl.getBoundingClientRect();
		if (rect && rect.height > 0) {
			renderer.previewEl.scrollTop += rect.top - parentRect.top - (renderer.previewEl.clientHeight - rect.height) / 2;
		} else target?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
		renderer.updateVirtualDisplay();
	}

	private removeHighlights() {
		if (!this.doc) return;
		documents.get(this.doc)?.delete(this);
		this.updateRegistry(this.doc);
	}
	private disconnect() {
		this.observers.forEach((observer) => observer.disconnect());
		this.observers = [];
		if (this.timer !== null) this.doc?.defaultView?.clearTimeout(this.timer);
		this.timer = null;
	}
	clear() {
		this.generation++;
		this.removeHighlights();
		this.disconnect();
		this.dirty = true;
		this.results = [];
		this.queryKey = "";
		this.textIndex = null;
		this.nodeSections = new WeakMap();
		this.sections = null;
		this.source = null;
	}
	destroy() { this.clear(); this.disposed = true; this.renderer = null; this.sections = null; this.doc = null; }
}
