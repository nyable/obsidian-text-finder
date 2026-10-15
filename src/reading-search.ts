import type { MarkdownView, TFile } from "obsidian";
import { indexReadingText, readingMatchEndpoints, endpointRange, readingPointOffset, readingBreaks, pointRange, type ReadingBreak, type ReadingEndpoint, type ReadingTextIndex } from "./reading-text";
import { findTextOffsets, normalizeSearchRanges } from "./util/text-helper";
import type { MatchExecutor, MatchResult } from "./match-protocol";
import type { ReadingSelection } from "./reading-selection";
import { ReadingOverlay } from "./reading-overlay";

/** Private bridge: public preview APIs cannot enumerate detached sections.
 * Shape checked against Obsidian 1.14.4; runtime failures must also fail closed. */
interface PreviewSection { el: HTMLElement; rendered: boolean; }
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
interface HighlightValue { priority: number; add(range: Range): void; }
interface HighlightWindow {
	CSS?: { highlights?: Map<string, HighlightValue> };
	Highlight?: new () => HighlightValue;
}
interface ReadingMatch { match: MatchOffset; endpoints: ReadingEndpoint[]; breaks: ReadingBreak[]; sections: PreviewSection[]; }
interface Request {
	renderer: PreviewRenderer;
	file: TFile | null;
	key: string;
	text: string;
	options: SearchOptions;
	index: number;
	scroll: boolean;
	direction: number;
	deadline: number;
	waiting: boolean;
	registered: boolean;
	done: (result: ReadingResult) => void;
}

const ALL = "nya-reading-matches";
const CURRENT = "nya-reading-current";
const SCOPE = "nya-reading-scope";
const documents = new WeakMap<Document, Map<ReadingSearch, { all: Range[]; current: Range[]; scope: Range[] }>>();
const highlightWindow = (doc: Document) => doc.defaultView as unknown as HighlightWindow | null;

function rendererFor(view: MarkdownView): PreviewRenderer | null {
	const r = (view.previewMode as unknown as { renderer?: Partial<PreviewRenderer> } | undefined)?.renderer;
	if (!r || !Array.isArray(r.sections) || typeof r.text !== "string"
		|| !(r.lastText === null || typeof r.lastText === "string")
		|| !(r.rendered === null || Array.isArray(r.rendered)) || typeof r.parsing !== "boolean"
		|| !r.previewEl?.ownerDocument?.defaultView || typeof r.showSection !== "function"
		|| typeof r.applyScrollSection !== "function" || typeof r.updateVirtualDisplay !== "function"
		|| typeof r.onRendered !== "function") return null;
	return r as PreviewRenderer;
}

export interface ReadingResult {
	matches: MatchOffset[];
	index: number;
	pending: boolean;
	unsupported: boolean;
	error?: "failed" | "timeout";
	workerError?: boolean;
	scopeInvalid?: boolean;
}

export class ReadingSearch {
	private disposed = false;
	private dirty = true;
	private renderer: PreviewRenderer | null = null;
	private file: TFile | null = null;
	private sections: PreviewSection[] | null = null;
	private source: string | null = null;
	private textIndex: ReadingTextIndex | null = null;
	private observer: MutationObserver | null = null;
	private watchedRenderer: PreviewRenderer | null = null;
	private watchedSections: PreviewSection[] | null = null;
	private timer: number | null = null;
	private waitTimer: number | null = null;
	private doc: Document | null = null;
	private results: ReadingMatch[] = [];
	private matchOffsets: MatchOffset[] = [];
	private queryKey = "";
	private nodeSections = new WeakMap<Node, PreviewSection>();
	private sectionElements = new Set<Node>();
	private sectionEndpoints = new Map<PreviewSection, { endpoint: ReadingEndpoint; index: number }[]>();
	private request: Request | null = null;
	private currentIndex = 0;
	private paintScheduled = false;
	private lifecycle = 0;
	private computation: { request: Request; index: ReadingTextIndex; doc: Document; newDocument: boolean } | null = null;
	private cachedNewDocument = false;
	private synchronousRetry = false;
	private paintFrame: number | null = null;
	private scope: { ranges: SearchRange[]; index: ReadingTextIndex; renderer: PreviewRenderer; file: TFile | null; doc: Document; source: string } | null = null;
	private scopeInvalid = false;
	private scopeEpoch = 0;
	private overlay: ReadingOverlay | null = null;

	constructor(private view: MarkdownView, private isOpen: () => boolean, private changed: () => void,
		private waitTimeoutMs = 5000, private matcher?: MatchExecutor) {}

	retrySynchronously() { this.synchronousRetry = true; }
	setScope(selection: readonly ReadingSelection[]): boolean {
		try {
			const r = rendererFor(this.view);
			if (!r || !this.ready(r) || !ReadingSearch.supported(this.view) || !this.isOpen() || this.view.getMode() !== "preview") return false;
			const index = indexReadingText(this.roots(r));
			const ranges: SearchRange[] = [];
			for (const range of selection) {
				if (!r.previewEl.contains(range.start.node) || !r.previewEl.contains(range.end.node)) return false;
				const from = readingPointOffset(index, range.start, "start"), to = readingPointOffset(index, range.end, "end");
				if (from === null || to === null || from >= to) return false;
				ranges.push({ from, to });
			}
			if (!ranges.length) return false;
			this.matcher?.cancel(); this.computation = null; this.request = null; this.cancelWait();
			this.scope = { ranges: normalizeSearchRanges(ranges, index.text.length), index, renderer: r, file: this.view.file,
				doc: r.previewEl.ownerDocument, source: r.lastText! };
			this.scopeInvalid = false; this.scopeEpoch++; this.queryKey = ""; this.dirty = true;
			return true;
		} catch { return false; }
	}
	clearScope() { this.matcher?.cancel(); this.computation = null; this.request = null; this.cancelWait();
		this.scope = null; this.scopeInvalid = false; this.scopeEpoch++; this.queryKey = ""; this.removeHighlights(); }
	getScopeRanges(): readonly SearchRange[] | undefined { return this.scopeInvalid ? [] : this.scope?.ranges; }
	isScopeInvalid() { return this.scopeInvalid; }
	blockScope() { this.clearScope(); this.scopeInvalid = true; this.scopeEpoch++; }
	private roots(r: PreviewRenderer) { return r.sections.filter((s) => s !== r.header && s !== r.footer
		&& !s.el.matches(".mod-header, .mod-footer")).map((s) => s.el); }
	private validateScope(index: ReadingTextIndex, r: PreviewRenderer) {
		const scope = this.scope; if (!scope) return;
		const same = scope.renderer === r && scope.file === this.view.file && scope.doc === r.previewEl.ownerDocument
			&& scope.source === r.lastText && scope.index.text === index.text && scope.index.spans.length === index.spans.length
			&& scope.index.spans.every((s, i) => { const n = index.spans[i]; return s.node === n.node && s.from === n.from && s.to === n.to && s.start === n.start && s.end === n.end; })
			&& scope.index.breaks.length === index.breaks.length && scope.index.breaks.every((b, i) => { const n = index.breaks[i];
				return b.from === n.from && b.kind === n.kind && b.before.node === n.before.node && b.before.offset === n.before.offset
					&& b.after?.node === n.after?.node && b.after?.offset === n.after?.offset && b.element === n.element; });
		if (!same) { this.scope = null; this.scopeInvalid = true; this.scopeEpoch++; this.queryKey = ""; }
	}
	/** Keep a pending match/render request, but relinquish its navigation intent. */
	pauseNavigation() { if (this.request) { this.request.scroll = false; this.request.direction = 0; } }

	static supported(view: MarkdownView): boolean {
		try {
			const r = rendererFor(view);
			const win = r && highlightWindow(r.previewEl.ownerDocument);
			return !!r && !!win?.CSS?.highlights && typeof win.Highlight === "function"
				&& r.sections.every((s) => !!s?.el?.ownerDocument && typeof s.rendered === "boolean");
		} catch { return false; }
	}

	private current(request: Request) {
		return this.request === request && !this.disposed && this.isOpen() && this.view.getMode() === "preview"
			&& this.view.file === request.file && rendererFor(this.view) === request.renderer;
	}
	private ready(r: PreviewRenderer) {
		return r.text === r.lastText && !r.parsing && r.rendered === null
			&& (typeof this.view.getViewData !== "function" || this.view.getViewData() === r.text)
			&& r.sections.every((s) => s.rendered);
	}

	/** Background refreshes of the same query may replace the listener, but not
	 * an outstanding user scroll/index. A new query, file or owner cancels it. */
	search(text: string, options: SearchOptions, index: number, scroll: boolean,
		done: (result: ReadingResult) => void, direction = 0) {
		try {
			const r = rendererFor(this.view);
			if (this.disposed || !this.isOpen() || this.view.getMode() !== "preview") {
				this.clear(); done({ matches: [], index: 0, pending: false, unsupported: false }); return;
			}
			if (!r || !ReadingSearch.supported(this.view)) {
				if (this.scope) { this.scope = null; this.scopeInvalid = true; this.scopeEpoch++; }
				this.clear(true); done({ matches: [], index: 0, pending: false, unsupported: true, scopeInvalid: this.scopeInvalid }); return;
			}
			if (!text && !this.scope && !this.scopeInvalid) { this.clear(); done({ matches: [], index: 0, pending: false, unsupported: false }); return; }
			const key = JSON.stringify([text, options.regexMode, options.caseSensitive, options.wholeWord, this.scopeEpoch]);
			let request = this.request;
			if (!request || request.key !== key || request.renderer !== r || request.file !== this.view.file) {
				if (this.computation) this.matcher?.cancel();
				this.computation = null;
				this.cancelWait();
				request = { renderer: r, file: this.view.file, key, text, options: { ...options }, index, scroll, direction,
					deadline: Date.now() + this.waitTimeoutMs, waiting: false, registered: false, done };
				this.request = request;
			} else {
				request.done = done;
				if (request.waiting && scroll && direction) {
					request.scroll = true;
					request.direction += direction;
				} else if (!request.waiting || scroll) {
					request.index = index; request.scroll = scroll; request.direction = direction;
				}
				if (!request.waiting) request.deadline = Date.now() + this.waitTimeoutMs;
			}
			this.run(request);
		} catch { this.fail("failed", done); }
	}

	private run(request: Request) {
		try {
			if (!this.current(request)) {
				if (this.request === request) this.clear();
				return;
			}
			const r = request.renderer;
			this.watch(r);
			if (!this.ready(r)) {
				this.matcher?.cancel(); this.computation = null;
				this.removeHighlights();
				this.dirty = true;
				request.waiting = true;
				if (Date.now() >= request.deadline) { this.fail("timeout", request.done); return; }
				request.done({ matches: [], index: request.index, pending: true, unsupported: false });
				if (!request.registered) {
					request.registered = true;
					// The renderer clears its pending flag after invoking callbacks.
					r.onRendered(() => { void Promise.resolve().then(() => this.run(request)); });
				}
				if (this.waitTimer === null) this.waitTimer = this.doc!.defaultView!.setTimeout(() => {
					this.waitTimer = null; this.run(request);
				}, Math.min(100, Math.max(1, request.deadline - Date.now())));
				return;
			}
			this.cancelWait();
			if (this.observer?.takeRecords().some((record) => this.contentMutation(record))) this.dirty = true;
			if (this.computation && this.computation.request === request && !this.dirty
				&& this.sections === r.sections && this.source === r.lastText) return;
			request.waiting = false;
			request.registered = false;
			if (this.observer?.takeRecords().some((record) => this.contentMutation(record))) this.dirty = true;
			const newDocument = this.file !== request.file || this.renderer !== r;
			if (newDocument) this.cachedNewDocument = true;
			if (this.dirty || newDocument || this.sections !== r.sections || this.source !== r.lastText) {
				this.renderer = r; this.file = request.file; this.sections = r.sections; this.source = r.lastText;
				this.textIndex = indexReadingText(this.roots(r));
				this.validateScope(this.textIndex, r);
				const rootSections = new Map(r.sections.map((s) => [s.el, s]));
				this.nodeSections = new WeakMap();
				for (const span of this.textIndex.spans) {
					let el = span.node.parentElement;
					while (el && !rootSections.has(el)) el = el.parentElement;
					if (el) this.nodeSections.set(span.node, rootSections.get(el)!);
				}
				for (const br of this.textIndex.breaks) {
					let node: Node | null = br.element ?? br.before.node;
					while (node && !rootSections.has(node as HTMLElement)) node = node.parentNode;
					if (node) this.nodeSections.set(br.element ?? br.before.node, rootSections.get(node as HTMLElement)!);
				}
				this.dirty = false; this.queryKey = "";
			}
			if (request.key !== this.queryKey) {
				const textIndex = this.textIndex!;
				const ranges = this.getScopeRanges();
				const result = this.matcher && !this.synchronousRetry ? this.matcher.match(textIndex.text, request.text, request.options, ranges)
					: { status: "completed" as const, matches: findTextOffsets(textIndex.text, request.text, request.options.regexMode, request.options.caseSensitive, request.options.wholeWord, ranges), synchronous: true };
				this.synchronousRetry = false;
				if (result instanceof Promise) {
					const computation = { request, index: textIndex, doc: this.doc!, newDocument };
					this.computation = computation; request.waiting = true; this.removeHighlights();
					request.done({ matches: [], index: request.index, pending: true, unsupported: false });
					void result.then((value) => {
						if (this.computation !== computation || !this.current(request)) return;
						this.computation = null; request.waiting = false;
						if (this.observer?.takeRecords().some((record) => this.contentMutation(record))) this.dirty = true;
						if (this.dirty || this.textIndex !== textIndex || this.doc !== computation.doc
							|| r.previewEl.ownerDocument !== computation.doc || this.sections !== r.sections
							|| this.source !== r.lastText || !this.ready(r)) { this.invalidate(); return; }
						if (!this.acceptMatches(request, value)) return;
						this.cachedNewDocument ||= computation.newDocument; this.run(request);
					}).catch(() => { if (this.current(request)) this.fail("failed", request.done, true); });
					return;
				}
				if (!this.acceptMatches(request, result)) return;
			}
			let index = newDocument || this.cachedNewDocument ? 0 : request.index;
			this.cachedNewDocument = false;
			index = index >= 0 && index < this.results.length ? index : 0;
			if (this.results.length && request.direction) index = ((index + request.direction) % this.results.length + this.results.length) % this.results.length;
			this.currentIndex = index;
			if (request.scroll) this.scroll(index, request);
			if (!this.current(request)) return;
			// Navigation can move sections. Construct live ranges only after it completes.
			this.paint();
			request.index = index; request.scroll = false; request.direction = 0;
			request.done({ matches: this.matchOffsets, index, pending: false, unsupported: false, scopeInvalid: this.scopeInvalid });
		} catch { if (this.request === request) this.fail("failed", request.done); }
	}

	private acceptMatches(request: Request, result: MatchResult): boolean {
		if (result.status === "cancelled") return false;
		if (result.status === "failed") { this.fail("failed", request.done, true); return false; }
		this.results = result.matches.map((match) => {
			const ranges = this.getScopeRanges();
			if (ranges && !ranges.some((r) => r.from <= match.from && r.to >= match.to)) return null;
			const endpoints = readingMatchEndpoints(this.textIndex!, match.from, match.to);
			const breaks = readingBreaks(this.textIndex!, match.from, match.to);
			const sections = [...new Set([...endpoints.map(({ node }) => this.nodeSections.get(node)),
				...breaks.flatMap((br) => [this.nodeSections.get(br.element ?? br.before.node),
					br.after ? this.nodeSections.get(br.after.node) : undefined])].filter((s): s is PreviewSection => !!s))];
			return sections.length ? { match, endpoints, breaks, sections } : null;
		}).filter((result): result is ReadingMatch => result !== null);
		this.queryKey = request.key;
		this.matchOffsets = this.results.map(({ match }, index) => ({ ...match, index }));
		this.sectionEndpoints.clear();
		this.results.forEach((result, index) => {
			for (const endpoint of result.endpoints) {
				const section = this.nodeSections.get(endpoint.node)!;
				let entries = this.sectionEndpoints.get(section);
				if (!entries) { entries = []; this.sectionEndpoints.set(section, entries); }
				entries.push({ endpoint, index });
			}
		});
		return true;
	}

	private contentMutation(record: MutationRecord): boolean {
		if (record.type !== "childList") return true;
		const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
		return !nodes.length || !nodes.every((node) => this.sectionElements.has(node));
	}

	private watch(r: PreviewRenderer) {
		const doc = r.previewEl.ownerDocument;
		if (this.watchedRenderer === r && this.watchedSections === r.sections && this.doc === doc) return;
		this.removeHighlights(); this.disconnect(); this.dirty = true;
		this.doc = doc; this.watchedRenderer = r; this.watchedSections = r.sections;
		this.sectionElements = new Set(r.sections.map((s) => s.el));
		// One observer can watch multiple detached roots without duplicate callbacks.
		this.observer = new doc.defaultView!.MutationObserver((records) => {
			if (!this.request || !this.current(this.request)) return;
			if (records.some((record) => this.contentMutation(record))) this.invalidate();
			else this.schedulePaint();
		});
		const config = { childList: true, subtree: true, characterData: true, attributes: true,
			attributeFilter: ["class", "style", "hidden", "aria-hidden", "open"] };
		this.observer.observe(r.previewEl, config);
		for (const s of r.sections) this.observer.observe(s.el, config);
	}

	invalidate() {
		if (!this.request || this.disposed) return;
		this.matcher?.cancel(); this.computation = null;
		this.dirty = true; this.removeHighlights();
		if (this.timer === null) this.timer = this.doc!.defaultView!.setTimeout(() => {
			this.timer = null;
			if (this.request && this.current(this.request)) this.changed();
		}, 50);
	}
	private schedulePaint() {
		if (this.paintScheduled || this.dirty || this.request?.waiting) return;
		this.paintScheduled = true;
		const lifecycle = this.lifecycle;
		void Promise.resolve().then(() => {
			if (lifecycle !== this.lifecycle) return;
			this.paintScheduled = false;
			try { if (this.request && this.current(this.request) && !this.dirty) this.paint(); }
			catch { if (this.request) this.fail("failed", this.request.done); }
		});
	}
	private scheduleGeometry() {
		this.overlay?.hide();
		const win = this.doc?.defaultView;
		if (!win || this.paintFrame !== null) return;
		const paint = () => { this.paintFrame = null; this.schedulePaint(); };
		if (typeof win.requestAnimationFrame === "function") this.paintFrame = win.requestAnimationFrame(paint);
		else this.schedulePaint();
	}

	private paint() {
		const r = this.renderer;
		if (!r || !this.doc) return;
		const all: Range[] = [];
		const current: Range[] = [];
		const scope: Range[] = [];
		for (const section of r.sections) {
			if (!r.previewEl.contains(section.el)) continue;
			for (const { endpoint, index } of this.sectionEndpoints.get(section) ?? []) {
				if (!section.el.contains(endpoint.node)) continue;
				const range = endpointRange(endpoint);
				all.push(range); if (index === this.currentIndex) current.push(range);
			}
		}
		for (const r of this.getScopeRanges() ?? []) for (const endpoint of readingMatchEndpoints(this.textIndex!, r.from, r.to))
			if (this.renderer!.previewEl.contains(endpoint.node)) scope.push(endpointRange(endpoint));
		let owners = documents.get(this.doc);
		if (!owners) { owners = new Map(); documents.set(this.doc, owners); }
		owners.set(this, { all, current, scope });
		this.updateRegistry(this.doc);
		this.overlay ??= new ReadingOverlay(r.previewEl, () => this.scheduleGeometry());
		this.overlay.paint(this.textIndex!, this.getScopeRanges() ?? [], this.matchOffsets, this.currentIndex);
	}
	private updateRegistry(doc: Document) {
		const win = highlightWindow(doc);
		if (!win?.CSS?.highlights || !win.Highlight) return;
		const owners = documents.get(doc);
		if (!owners?.size) { win.CSS.highlights.delete(ALL); win.CSS.highlights.delete(CURRENT); win.CSS.highlights.delete(SCOPE); return; }
		const all = new win.Highlight(); const current = new win.Highlight(); const scope = new win.Highlight();
		owners.forEach((entry) => {
			entry.all.forEach((range) => all.add(range)); entry.current.forEach((range) => current.add(range));
			entry.scope.forEach((range) => scope.add(range));
		});
		all.priority = 0; current.priority = 1;
		win.CSS.highlights.set(ALL, all); win.CSS.highlights.set(CURRENT, current);
		scope.priority = -1; win.CSS.highlights.set(SCOPE, scope);
	}

	private scroll(index: number, request: Request) {
		const result = this.results[index];
		if (!result) return;
		const r = request.renderer;
		for (const section of result.sections) {
			r.showSection(section);
			if (!this.current(request)) return;
		}
		const section = result.sections[0];
		if (!r.previewEl.contains(section.el)) {
			if (!r.applyScrollSection(section)) throw new Error("Reading section could not be located");
			if (!this.current(request)) return;
			r.updateVirtualDisplay();
		}
		if (!this.current(request)) return;
		const endpoint = result.endpoints[0];
		const point = result.breaks[0]?.before;
		const node: Node | undefined = endpoint?.node ?? point?.node;
		if (!node) throw new Error("Reading match has no navigation anchor");
		const target = node.nodeType === 1 ? node as HTMLElement : node.parentElement;
		for (let el = target; el && el !== r.previewEl; el = el.parentElement) {
			if (el.matches("li.is-collapsed, .callout.is-collapsed, details:not([open])")) {
				if (el.tagName === "DETAILS") el.setAttribute("open", "");
				else el.querySelector<HTMLElement>(":scope > .list-collapse-indicator, :scope > .callout-title")?.click();
			}
		}
		if (!this.current(request)) return;
		if (!r.previewEl.contains(node)) throw new Error("Reading target is not mounted");
		const range = endpoint ? endpointRange(endpoint) : pointRange(point!);
		const rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
		if (rect && rect.height > 0) {
			r.previewEl.scrollTop += rect.top - r.previewEl.getBoundingClientRect().top - (r.previewEl.clientHeight - rect.height) / 2;
		} else target?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
		r.updateVirtualDisplay();
	}

	private fail(error: "failed" | "timeout", done: (result: ReadingResult) => void, workerError = false) {
		this.clear(true); done({ matches: [], index: 0, pending: false, unsupported: false, error, workerError, scopeInvalid: this.scopeInvalid });
	}
	private removeHighlights() {
		this.overlay?.destroy(); this.overlay = null;
		if (!this.doc) return;
		documents.get(this.doc)?.delete(this);
		try { this.updateRegistry(this.doc); }
		catch {
			// A broken registry must not prevent observer/timer cleanup.
			try { const registry = highlightWindow(this.doc)?.CSS?.highlights;
				registry?.delete(ALL); registry?.delete(CURRENT); registry?.delete(SCOPE); } catch { /* unavailable host */ }
		}
	}
	private cancelWait() {
		if (this.waitTimer !== null) this.doc?.defaultView?.clearTimeout(this.waitTimer);
		this.waitTimer = null;
	}
	private disconnect() {
		if (this.paintFrame !== null) this.doc?.defaultView?.cancelAnimationFrame(this.paintFrame);
		this.paintFrame = null;
		this.observer?.disconnect(); this.observer = null;
		if (this.timer !== null) this.doc?.defaultView?.clearTimeout(this.timer);
		this.timer = null; this.cancelWait();
		this.watchedRenderer = null; this.watchedSections = null;
	}
	clear(preserveScope = false) {
		if (!preserveScope) { this.scope = null; this.scopeInvalid = false; this.scopeEpoch++; }
		this.matcher?.cancel(); this.computation = null; this.cachedNewDocument = false;
		this.lifecycle++; this.request = null; this.paintScheduled = false;
		this.removeHighlights(); this.disconnect(); this.dirty = true;
		this.results = []; this.matchOffsets = []; this.queryKey = ""; this.textIndex = null;
		this.sectionEndpoints.clear();
		this.nodeSections = new WeakMap(); this.sectionElements.clear();
		this.sections = null; this.source = null; this.renderer = null; this.file = null;
	}
	destroy() { this.clear(); this.matcher?.destroy(); this.disposed = true; this.doc = null; }
}
