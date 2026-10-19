// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createFinderEditor } from "../../src/platform/codemirror/finder-editor";
import type { EditorContext } from "../../src/platform/codemirror/editor-context";
import type { Vault } from "obsidian";

const editors: EditorView[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function environment(extensions: import("@codemirror/state").Extension = []) {
	const state = EditorState.create({ doc: "cat cat", extensions });
	const editorView = new EditorView({ state });
	editors.push(editorView);
	const dispatch = vi.spyOn(editorView, "dispatch");
	// Deliberate boundary fixture: only the CodeMirror transaction capability is used.
	const initial: EditorContext = {
		view: {} as EditorContext["view"],
		editor: {} as EditorContext["editor"],
		editorView,
		file: { path: "same.md" } as EditorContext["file"],
		doc: state.doc,
	};
	let current: EditorContext | null = initial;
	const port = createFinderEditor(
		() => current,
		() => ({}) as Vault,
		() => current?.file ?? null,
	);
	return {
		initial,
		port,
		dispatch,
		set: (value: EditorContext | null) => {
			current = value;
		},
	};
}
it("retains stable opaque identities but never exposes host instances", () => {
	const h = environment(),
		one = h.port.current(),
		two = h.port.current();
	expect(one?.view).toBe(two?.view);
	expect(one?.doc).toBe(two?.doc);
	expect(one?.view).not.toBe(h.initial.view);
	expect(one?.editorView).not.toBe(h.initial.editorView);
	expect(one?.doc.toString()).toBe("cat cat");
});
for (const change of ["owner", "editor", "editorView", "file", "doc", "closed"] as const) {
	it(`rechecks ${change} identity at the write boundary`, () => {
		const h = environment(),
			captured = h.port.current();
		if (!captured) throw new Error("Missing fixture snapshot");
		const next = { ...h.initial };
		if (change === "owner") next.view = {} as EditorContext["view"];
		else if (change === "editor") next.editor = {} as EditorContext["editor"];
		else if (change === "editorView") next.editorView = {} as EditorContext["editorView"];
		else if (change === "file") next.file = { path: "same.md" } as EditorContext["file"];
		else if (change === "doc") next.doc = EditorState.create({ doc: "cat cat" }).doc;
		h.set(change === "closed" ? null : next);
		expect(() => h.port.commit(captured, [{ from: 0, to: 3, insert: "dog" }])).toThrow(
			"context changed",
		);
		expect(h.dispatch).not.toHaveBeenCalled();
	});
}
it("commits once and rejects replay of that snapshot", () => {
	const h = environment(),
		captured = h.port.current();
	if (!captured) throw new Error("Missing fixture snapshot");
	h.port.commit(captured, [{ from: 0, to: 3, insert: "dog" }]);
	h.set({ ...h.initial, doc: h.initial.editorView.state.doc });
	expect(h.port.hasCommitted(captured)).toBe(true);
	expect(() => h.port.commit(captured, [{ from: 0, to: 3, insert: "bad" }])).toThrow();
	expect(h.dispatch).toHaveBeenCalledOnce();
});
it("distinguishes a filtered transaction from an accepted same-text replacement", () => {
	const rejected = environment(
		EditorState.transactionFilter.of((tr) => (tr.docChanged ? [] : tr)),
	);
	const captured = rejected.port.current()!;
	rejected.port.commit(captured, [{ from: 0, to: 3, insert: "dog" }]);
	expect(rejected.initial.editorView.state.doc.toString()).toBe("cat cat");
	expect(rejected.port.hasCommitted(captured)).toBe(false);
	const accepted = environment();
	const sameText = accepted.port.current()!;
	accepted.port.commit(sameText, [{ from: 0, to: 3, insert: "cat" }]);
	expect(accepted.initial.editorView.state.doc.toString()).toBe("cat cat");
	expect(accepted.port.hasCommitted(sameText)).toBe(true);
});
