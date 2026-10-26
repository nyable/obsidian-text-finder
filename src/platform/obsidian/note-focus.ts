import type { MarkdownView } from "obsidian";
import { editorContextFor } from "./editor-context";
import { capturePreviewBody } from "./preview-renderer";

/** A one-shot, owner-bound return of keyboard focus, never a workspace activation. */
export function prepareNoteFocus(owner: MarkdownView, currentOwner: () => boolean) {
	const root = owner.containerEl;
	if (!root?.isConnected) return null;
	const doc = root.ownerDocument,
		win = doc.defaultView,
		file = owner.file,
		mode = owner.getMode(),
		focused = doc.activeElement;
	if (
		!win ||
		!currentOwner() ||
		(focused &&
			focused !== doc.body &&
			focused !== doc.documentElement &&
			!root.contains(focused))
	)
		return null;
	let pending = true;
	const dispose = () => {
		if (!pending) return;
		pending = false;
		doc.removeEventListener("focusin", dispose, true);
		doc.removeEventListener("pointerdown", dispose, true);
		doc.removeEventListener("keydown", dispose, true);
		win.removeEventListener("blur", dispose);
		win.removeEventListener("pagehide", dispose);
	};
	// Capture avoids consuming the closing Escape/pointer event already bubbling.
	doc.addEventListener("focusin", dispose, true);
	doc.addEventListener("pointerdown", dispose, true);
	doc.addEventListener("keydown", dispose, true);
	win.addEventListener("blur", dispose);
	win.addEventListener("pagehide", dispose);
	return {
		dispose,
		restore() {
			const valid = pending;
			dispose();
			if (
				!valid ||
				win.closed ||
				!root.isConnected ||
				root.ownerDocument !== doc ||
				owner.file !== file ||
				owner.getMode() !== mode ||
				!currentOwner()
			)
				return;
			if (mode === "source") {
				// Mode restoration may have rebuilt the editor. Never retain the old CM.
				const cm = editorContextFor(owner)?.editorView;
				if (
					cm?.contentDOM?.isConnected &&
					cm.contentDOM.ownerDocument === doc &&
					root.contains(cm.contentDOM) &&
					typeof cm.focus === "function"
				)
					cm.focus();
			} else {
				const body = capturePreviewBody(owner)?.body;
				if (!body?.isConnected || body.ownerDocument !== doc || !root.contains(body))
					return;
				// Same target and tab order as the host's reading focus path.
				if (!body.hasAttribute("tabindex")) body.tabIndex = -1;
				body.focus({ preventScroll: true });
			}
		},
	};
}
