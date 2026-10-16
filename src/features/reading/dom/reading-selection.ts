import type { ReadingPoint } from "./reading-text";

export interface ReadingSelection {
	start: ReadingPoint;
	end: ReadingPoint;
}
/** Numeric DOM boundaries, never a live Range that collapses on virtual moves. */
export function captureReadingSelection(root: HTMLElement): ReadingSelection[] | null {
	const selection = root.ownerDocument.defaultView?.getSelection();
	if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
	const ranges: ReadingSelection[] = [];
	for (let i = 0; i < selection.rangeCount; i++) {
		const range = selection.getRangeAt(i);
		if (
			!root.contains(range.startContainer) ||
			!root.contains(range.endContainer) ||
			range.collapsed
		)
			return null;
		ranges.push({
			start: { node: range.startContainer, offset: range.startOffset },
			end: { node: range.endContainer, offset: range.endOffset },
		});
	}
	return ranges.length ? ranges : null;
}

/** Installed for open views before a Finder exists, so command-palette focus cannot lose the candidate. */
export class ReadingSelectionTracker {
	private cleanup: (() => void) | undefined;
	private doc: Document | undefined;
	private root: HTMLElement | undefined;
	private candidate: ReadingSelection[] | null = null;
	private identity: unknown;
	private version: unknown;
	private renderer: unknown;
	private observer: MutationObserver | null = null;
	private revision = {};
	/** Menu snapshots must reject edits even when text later returns to the same value. */
	stamp() {
		if (this.observer?.takeRecords().length) {
			this.candidate = null;
			this.revision = {};
		}
		return this.revision;
	}
	connect(root: HTMLElement, identity: unknown, version?: unknown, renderer?: unknown) {
		if (
			root === this.root &&
			root.ownerDocument === this.doc &&
			identity === this.identity &&
			version === this.version &&
			renderer === this.renderer
		)
			return;
		this.destroy();
		this.root = root;
		this.doc = root.ownerDocument;
		this.identity = identity;
		this.version = version;
		this.renderer = renderer;
		const capture = () => {
			const selection = this.doc?.defaultView?.getSelection();
			if (selection?.anchorNode && root.contains(selection.anchorNode))
				this.candidate = captureReadingSelection(root);
			else if (selection && !selection.isCollapsed && selection.anchorNode) {
				const element =
					selection.anchorNode.nodeType === 1
						? (selection.anchorNode as Element)
						: selection.anchorNode.parentElement;
				// Finder and command-palette input selection must not replace the
				// last owner-body candidate. Another note's body must clear it.
				if (
					!element?.closest(
						'input, textarea, [contenteditable="true"], .prompt, .modal, .nya-finder',
					)
				)
					this.candidate = null;
			}
		};
		const pointer = (event: Event) => {
			if (root.contains(event.target as Node)) this.candidate = null;
			else capture();
		};
		const observer =
			this.doc.defaultView &&
			new this.doc.defaultView.MutationObserver((records) => {
				// A not-yet-locked candidate cannot be mapped through arbitrary DOM edits.
				// Reject it rather than applying old element child offsets to new content.
				if (records.length) {
					this.candidate = null;
					this.revision = {};
				}
			});
		observer?.observe(root, { childList: true, subtree: true, characterData: true });
		this.observer = observer ?? null;
		this.doc.addEventListener("selectionchange", capture);
		this.doc.addEventListener("pointerdown", pointer, true);
		this.doc.addEventListener("keydown", capture, true);
		this.cleanup = () => {
			this.doc?.removeEventListener("selectionchange", capture);
			this.doc?.removeEventListener("pointerdown", pointer, true);
			this.doc?.removeEventListener("keydown", capture, true);
			observer?.disconnect();
		};
		capture();
	}
	get(root: HTMLElement, identity: unknown, version?: unknown, renderer?: unknown) {
		this.connect(root, identity, version, renderer);
		this.stamp();
		return captureReadingSelection(root) ?? this.candidate;
	}
	destroy() {
		this.cleanup?.();
		this.cleanup = undefined;
		this.observer = null;
		this.doc = undefined;
		this.root = undefined;
		this.candidate = null;
		this.revision = {};
	}
}
