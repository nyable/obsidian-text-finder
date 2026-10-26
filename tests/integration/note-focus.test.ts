// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownView } from "obsidian";
import { prepareNoteFocus } from "../../src/platform/obsidian/note-focus";

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

function fixture(mode: "source" | "preview" = "source", doc = document) {
	const root = doc.createElement("div"),
		body = doc.createElement("div"),
		input = doc.createElement("textarea");
	body.tabIndex = -1;
	root.append(body, input);
	doc.body.append(root);
	const cm = {
		state: { doc: {} },
		contentDOM: body,
		focus: vi.fn(() => body.focus({ preventScroll: true })),
	};
	const view = {
		containerEl: root,
		file: { path: "same.md" },
		getMode: () => mode,
		editor: { cm },
		previewMode: { renderer: { previewEl: body, lastText: "note" } },
	};
	input.focus();
	return { root, body, input, cm, view, owner: view as unknown as MarkdownView };
}

describe("owner-bound note focus", () => {
	it("uses the rebuilt editor and does not change its selection or document", () => {
		const h = fixture();
		const request = prepareNoteFocus(h.owner, () => true);
		h.input.blur();
		const rebuilt = { ...h.cm, focus: vi.fn(() => h.body.focus()) };
		h.view.editor.cm = rebuilt;
		request?.restore();
		expect(h.cm.focus).not.toHaveBeenCalled();
		expect(rebuilt.focus).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(h.body);
		request?.restore();
		expect(rebuilt.focus).toHaveBeenCalledOnce();
	});

	it("focuses only the reading body without switching modes or focusing an editor", () => {
		const h = fixture("preview");
		h.body.removeAttribute("tabindex");
		const focus = vi.spyOn(h.body, "focus");
		const request = prepareNoteFocus(h.owner, () => true);
		h.input.blur();
		request?.restore();
		expect(document.activeElement).toBe(h.body);
		expect(h.body.tabIndex).toBe(-1);
		expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
		expect(h.cm.focus).not.toHaveBeenCalled();
	});

	it.each(["focus", "pointer", "keyboard", "blur", "pagehide"])(
		"cancels after intervening %s, even if focus returns to body",
		(action) => {
			const h = fixture();
			const request = prepareNoteFocus(h.owner, () => true);
			h.input.blur();
			const external = document.createElement("button");
			document.body.append(external);
			if (action === "focus") {
				external.focus();
				external.blur();
			} else if (action === "pointer")
				external.dispatchEvent(new Event("pointerdown", { bubbles: true }));
			else if (action === "keyboard")
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
			else window.dispatchEvent(new Event(action));
			request?.restore();
			expect(h.cm.focus).not.toHaveBeenCalled();
		},
	);

	it.each(["owner", "file", "mode", "document", "detached", "dispose", "missing"])(
		"rejects an invalid %s target",
		(action) => {
			const h = fixture();
			let current = true;
			const request = prepareNoteFocus(h.owner, () => current);
			h.input.blur();
			if (action === "owner") current = false;
			if (action === "file") h.view.file = { path: "other.md" };
			if (action === "mode") h.view.getMode = () => "preview";
			if (action === "document")
				document.implementation.createHTMLDocument().body.append(h.root);
			if (action === "detached") h.root.remove();
			if (action === "dispose") request?.dispose();
			if (action === "missing") h.body.remove();
			request?.restore();
			expect(h.cm.focus).not.toHaveBeenCalled();
		},
	);

	it("does not borrow another split's body or accept external focus", () => {
		const a = fixture("preview"),
			b = fixture("preview");
		expect(prepareNoteFocus(a.owner, () => true)).toBeNull();
		a.input.focus();
		a.view.previewMode.renderer.previewEl = b.body;
		const request = prepareNoteFocus(a.owner, () => true);
		a.input.blur();
		request?.restore();
		expect(document.activeElement).not.toBe(b.body);
	});

	it("removes temporary listeners on restore and cancellation", () => {
		const h = fixture();
		const remove = vi.spyOn(document, "removeEventListener");
		const removeWindow = vi.spyOn(window, "removeEventListener");
		const request = prepareNoteFocus(h.owner, () => true);
		request?.dispose();
		for (const event of ["focusin", "pointerdown", "keydown"])
			expect(remove).toHaveBeenCalledWith(event, expect.any(Function), true);
		for (const event of ["blur", "pagehide"])
			expect(removeWindow).toHaveBeenCalledWith(event, expect.any(Function));
	});

	it("restores in the owner's second Document without touching the main Document", () => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const doc = frame.contentDocument!;
		const h = fixture("preview", doc);
		// jsdom dispatches Window blur when an iframe input blurs, unlike Chromium.
		// Exercise the second Document target here; the browser covers real close/blur.
		h.input.blur();
		const request = prepareNoteFocus(h.owner, () => true);
		request?.restore();
		expect(doc.activeElement).toBe(h.body);
		expect(document.activeElement).toBe(frame);
	});

	it("missing reading capability safely leaves focus outside the hidden Finder", () => {
		const h = fixture("preview");
		const request = prepareNoteFocus(h.owner, () => true);
		h.input.blur();
		Object.assign(h.view.previewMode, { renderer: undefined });
		expect(() => request?.restore()).not.toThrow();
		expect(h.cm.focus).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(document.body);
	});
});
