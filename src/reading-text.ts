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
	let length = 0;
	let last = "";
	let pendingSpace: ReadingEndpoint | null = null;
	const separator = (value: string) => {
		pendingSpace = null;
		if (!length || last === "\n" || last === value) return;
		pieces.push(value);
		length += value.length;
		last = value;
	};
	const lineBreak = () => {
		pendingSpace = null;
		pieces.push("\n");
		length++;
		last = "\n";
	};
	const append = (node: Text, start: number, end: number, value: string) => {
		if (!value) return;
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
			if (blocks.has(el.tagName) || el.matches(".internal-embed, .markdown-embed, mjx-container, .math, svg, canvas, iframe")) separator("\n");
			return;
		}
		const tag = el.tagName;
		if (tag === "BR") { lineBreak(); return; }
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
		for (const child of Array.from(el.childNodes)) visit(child, preformatted || tag === "PRE");
		if (block) separator("\n");
		if (cell) pendingSpace = null;
	};
	for (const root of roots) {
		visit(root, false);
		separator("\n");
	}
	return { text: pieces.join(""), spans };
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
