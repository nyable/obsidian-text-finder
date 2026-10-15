/** A logical reading-text offset is never a Markdown source offset. */
interface TextSpan {
	from: number;
	to: number;
	node: Text;
	start: number;
	end: number;
}

export interface ReadingTextIndex {
	text: string;
	spans: TextSpan[];
	breaks: ReadingBreak[];
	points: WeakMap<Node, number[]>;
}

export interface ReadingPoint { node: Node; offset: number; }
export interface ReadingBreak {
	from: number;
	kind: "hard" | "text" | "block" | "barrier";
	before: ReadingPoint;
	after?: ReadingPoint;
	element?: HTMLElement;
}

/** Stable numeric endpoints; unlike live DOM Ranges these survive node moves. */
export interface ReadingEndpoint {
	node: Text;
	start: number;
	end: number;
}

const excluded = [
	"script", "style", "noscript", "template", "svg", "canvas", "iframe",
	"input", "textarea", "button", "select", "mjx-container",
	".internal-embed", ".markdown-embed", ".metadata-container", ".frontmatter",
	".mermaid", ".math", ".block-language-dataview", ".block-language-dataviewjs",
	".copy-code-button", ".collapse-indicator", ".list-bullet", ".footnote-backref",
	"[hidden]", '[aria-hidden="true"]',
].join(",");
const blocks = new Set([
	"P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL",
	"BLOCKQUOTE", "PRE", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "HR",
]);

/**
 * Index actual rendered nodes, including detached virtual sections. Inline
 * formatting stays continuous; block boundaries / table cells are explicit.
 * Layout wrapping is not a newline. Preserve preformatted text verbatim.
 */
export function indexReadingText(roots: HTMLElement[]): ReadingTextIndex {
	const pieces: string[] = [];
	const spans: TextSpan[] = [];
	const breaks: ReadingBreak[] = [], points = new WeakMap<Node, number[]>();
	let lastPoint: ReadingPoint | undefined;
	let pendingBreak: ReadingBreak | undefined;
	let length = 0;
	let last = "";
	let pendingSpace: ReadingEndpoint | null = null;
	const separator = (value: string, barrier = false) => {
		pendingSpace = null;
		if (barrier && pendingBreak) pendingBreak.kind = "barrier";
		if (!length || last === "\n" || last === value) return;
		if (lastPoint) {
			pendingBreak = { from: length, kind: barrier ? "barrier" : "block", before: lastPoint };
			breaks.push(pendingBreak);
		}
		pieces.push(value);
		length += value.length;
		last = value;
	};
	const lineBreak = (element: HTMLElement) => {
		pendingSpace = null;
		const parent = element.parentNode!, offset = Array.prototype.indexOf.call(parent.childNodes, element);
		const before = { node: parent, offset }, after = { node: parent, offset: offset + 1 };
		if (pendingBreak) { pendingBreak.after = before; pendingBreak = undefined; }
		breaks.push({ from: length, kind: "hard", before, after, element }); lastPoint = after;
		pieces.push("\n");
		length++;
		last = "\n";
	};
	const append = (node: Text, start: number, end: number, value: string) => {
		if (!value) return;
		if (pendingBreak) { pendingBreak.after = { node, offset: start }; pendingBreak = undefined; }
		for (let i = 0; i < value.length; i++) if (value[i] === "\n") breaks.push({ from: length + i, kind: "text",
			before: { node, offset: start + i }, after: { node, offset: start + i + 1 } });
		lastPoint = { node, offset: end };
		const previous = spans[spans.length - 1];
		// Merge direct, contiguous text to keep the index compact for code blocks.
		if (previous?.node === node && previous.to === length && previous.end === start
			&& previous.to - previous.from === previous.end - previous.start
			&& value.length === end - start) {
			previous.to += value.length;
			previous.end = end;
		} else {
			spans.push({ from: length, to: length + value.length, node, start, end });
		}
		pieces.push(value);
		length += value.length;
		last = value.slice(-1);
	};
	const visit = (node: Node, preformatted: boolean) => {
		if (node.nodeType === 3) {
			const textNode = node as Text;
			const text = textNode.data;
			points.set(node, [length]);
			if (preformatted) { append(textNode, 0, text.length, text); return; }
			// HTML collapses ASCII whitespace outside <pre>. Do not collapse NBSP.
			const chunks = /[^\t\n\r\f ]+|[\t\n\r\f ]+/g;
			let chunk: RegExpExecArray | null;
			while ((chunk = chunks.exec(text))) {
				const value = chunk[0];
				if (/^[\t\n\r\f ]/.test(value)) {
					if (!pendingSpace) pendingSpace = { node: textNode, start: chunk.index, end: chunk.index + value.length };
				} else {
					if (pendingSpace && length && last !== " " && last !== "\n" && last !== "\t") {
						append(pendingSpace.node, pendingSpace.start, pendingSpace.end, " ");
					}
					pendingSpace = null;
					append(textNode, chunk.index, chunk.index + value.length, value);
				}
			}
			return;
		}
		if (node.nodeType !== 1) return;
		const el = node as HTMLElement;
		// Explicitly excluded subtrees never contribute text, regardless of CSS.
		// Avoid computing their style; folding matters only for display:none.
		let hidden = el.matches(excluded);
		if (!hidden) {
			const style = el.ownerDocument.defaultView?.getComputedStyle(el);
			hidden = !!style && (style.visibility === "hidden" || style.visibility === "collapse"
				|| (style.display === "none" && !el.matches(
					"li.is-collapsed > ul, li.is-collapsed > ol, .callout.is-collapsed > .callout-content")));
		}
		if (hidden) {
			if (blocks.has(el.tagName) || el.matches(".internal-embed, .markdown-embed, mjx-container, .math, svg, canvas, iframe")) separator("\n", true);
			return;
		}
		const tag = el.tagName;
		if (tag === "BR") { points.set(el, [length]); lineBreak(el); return; }
		const block = blocks.has(tag);
		const cell = tag === "TD" || tag === "TH";
		if (block) separator("\n");
		if (cell) {
			pendingSpace = null;
			// Exactly one tab per cell boundary, including consecutive empty cells.
			if (el.previousElementSibling?.matches("td, th")) {
				pieces.push("\t"); length++; last = "\t";
			}
		}
		const offsets = [length]; points.set(el, offsets);
		for (const child of Array.from(el.childNodes)) { visit(child, preformatted || tag === "PRE"); offsets.push(length); }
		if (block) separator("\n");
		if (cell) pendingSpace = null;
	};
	for (const root of roots) {
		visit(root, false);
		separator("\n");
	}
	return { text: pieces.join(""), spans, breaks, points };
}

/** Inward snapping never includes a partially selected collapsed whitespace run. */
export function readingPointOffset(index: ReadingTextIndex, point: ReadingPoint, side: "start" | "end"): number | null {
	if (!Number.isInteger(point.offset) || point.offset < 0 || !index.points.has(point.node)) return null;
	if (point.node.nodeType !== 3) {
		const fallback = index.points.get(point.node)?.[point.offset];
		if (fallback === undefined) return null;
		// Pending HTML whitespace is emitted only when the next text arrives.
		// Prefer the indexed child on the inward side over the traversal-time
		// offset, otherwise selecting <strong>cat</strong> also selects its space.
		const child = point.node.childNodes[side === "start" ? point.offset : point.offset - 1];
		if (child && index.points.has(child)) {
			const spans = index.spans.filter((span) => child.contains(span.node));
			const breaks = index.breaks.filter((br) => br.kind === "hard" && br.element && child.contains(br.element));
			const offsets = [...spans.map((span) => side === "start" ? span.from : span.to),
				...breaks.map((br) => br.from + (side === "end" ? 1 : 0))];
			if (offsets.length) return offsets.reduce((value, offset) => side === "start" ? Math.min(value, offset) : Math.max(value, offset));
		}
		return fallback;
	}
	if (point.offset > (point.node as Text).length) return null;
	const spans = index.spans.filter((span) => span.node === point.node);
	for (const span of spans) if (point.offset >= span.start && point.offset <= span.end) {
		if (span.to - span.from === span.end - span.start) return span.from + point.offset - span.start;
		return point.offset === span.start ? span.from : point.offset === span.end ? span.to : side === "start" ? span.to : span.from;
	}
	const next = spans.find((span) => span.start > point.offset);
	return next?.from ?? spans.at(-1)?.to ?? index.points.get(point.node)![0];
}

export function readingBreaks(index: ReadingTextIndex, from: number, to: number) {
	let low = 0, high = index.breaks.length;
	while (low < high) { const mid = (low + high) >>> 1; if (index.breaks[mid].from < from) low = mid + 1; else high = mid; }
	const result: ReadingBreak[] = [];
	for (let i = low; i < index.breaks.length && index.breaks[i].from < to; i++) {
		const br = index.breaks[i]; if (br.kind !== "barrier" && br.after) result.push(br);
	}
	return result;
}

export function pointRange(point: ReadingPoint): Range {
	const range = point.node.ownerDocument!.createRange(); range.setStart(point.node, point.offset); range.collapse(true); return range;
}

/** Separate ranges avoid painting excluded content between accepted nodes. */
export function readingMatchEndpoints(index: ReadingTextIndex, from: number, to: number): ReadingEndpoint[] {
	const endpoints: ReadingEndpoint[] = [];
	if (from < 0 || from >= to || to > index.text.length) return endpoints;
	// Binary search the first intersecting span.
	let low = 0;
	let high = index.spans.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (index.spans[mid].to <= from) low = mid + 1;
		else high = mid;
	}
	for (let i = low; i < index.spans.length; i++) {
		const span = index.spans[i];
		if (span.from >= to) break;
		const direct = span.to - span.from === span.end - span.start;
		const start = direct ? span.start + Math.max(0, from - span.from) : span.start;
		const end = direct ? span.start + Math.min(span.to, to) - span.from : span.end;
		if (end > span.node.length || start >= end) continue;
		endpoints.push({ node: span.node, start, end });
	}
	return endpoints;
}

export function endpointRange(endpoint: ReadingEndpoint): Range {
	const range = endpoint.node.ownerDocument.createRange();
	range.setStart(endpoint.node, endpoint.start);
	range.setEnd(endpoint.node, endpoint.end);
	return range;
}

export function readingMatchRanges(index: ReadingTextIndex, from: number, to: number): Range[] {
	return readingMatchEndpoints(index, from, to).map(endpointRange);
}
