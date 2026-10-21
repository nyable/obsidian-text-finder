// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createFinderEditor } from "../../src/platform/codemirror/finder-editor";
import type { EditorContext } from "../../src/platform/codemirror/editor-context";
import type { Vault } from "obsidian";
import { searchCacheEffect } from "../../src/platform/codemirror/search-highlight";
import { createFinderSession } from "../../src/features/finder/application/finder-session";
import { silentPresentation } from "../../src/features/finder/application/presentation-port";
import { defaultSettings } from "../../src/features/settings";
import { HistoryController } from "../../src/features/history";
import { synchronousMatcher } from "../support/synchronous-matcher";
import type { FinderHost } from "../../src/features/finder/contracts";

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

it("publishes immutable result identity without copying every offset on navigation", () => {
	const h = environment();
	const matches = [
		{ from: 0, to: 3, index: 0 },
		{ from: 4, to: 7, index: 1 },
	];
	const captured = h.port.current()!;
	for (const index of [0, 1]) {
		h.port.publish(captured, { visible: true, index, matches });
		const spec = h.dispatch.mock.lastCall?.[0];
		if (!spec || Array.isArray(spec) || !("effects" in spec))
			throw new Error("Missing publication");
		const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
		const effect = effects.find((value) => value?.is(searchCacheEffect));
		expect(effect?.value.matches).toBe(matches);
	}
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
	expect(h.port.commitResult(captured)).toEqual({
		changed: true,
		complete: true,
		changeCount: 1,
	});
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
	expect(rejected.port.commitResult(captured)).toEqual({
		changed: false,
		complete: false,
		changeCount: 0,
	});
	const accepted = environment();
	const sameText = accepted.port.current()!;
	accepted.port.commit(sameText, [{ from: 0, to: 3, insert: "cat" }]);
	expect(accepted.initial.editorView.state.doc.toString()).toBe("cat cat");
	expect(accepted.port.commitResult(sameText)).toEqual({
		changed: true,
		complete: true,
		changeCount: 1,
	});
});

it("does not confuse partially filtered same-text replacements with full acceptance", () => {
	const h = environment(EditorState.changeFilter.of(() => [0, 3]));
	const captured = h.port.current()!;
	h.port.commit(captured, [
		{ from: 0, to: 3, insert: "cat" },
		{ from: 4, to: 7, insert: "cat" },
	]);
	expect(h.initial.editorView.state.doc.toString()).toBe("cat cat");
	expect(h.port.commitResult(captured)).toEqual({
		changed: true,
		complete: false,
		changeCount: null,
	});
	expect(h.dispatch).toHaveBeenCalledOnce();
});

it("runs host filters once and refuses owner changes made during filtering", () => {
	const filter = vi.fn((tr: import("@codemirror/state").Transaction) => tr);
	const h = environment(EditorState.transactionFilter.of(filter));
	h.port.commit(h.port.current()!, [{ from: 0, to: 3, insert: "dog" }]);
	expect(filter).toHaveBeenCalledOnce();
	const switchOwner = vi.fn((tr: import("@codemirror/state").Transaction) => {
		other.set({ ...other.initial, file: { path: "new.md" } as EditorContext["file"] });
		return tr;
	});
	const other = environment(EditorState.transactionFilter.of(switchOwner));
	const captured = other.port.current()!;
	expect(() => other.port.commit(captured, [{ from: 0, to: 3, insert: "dog" }])).toThrow(
		"during replacement filtering",
	);
	expect(other.dispatch).not.toHaveBeenCalled();
	expect(other.port.commitResult(captured)).toEqual({
		changed: false,
		complete: false,
		changeCount: 0,
	});
});

it.each(["partial", "rewritten"])(
	"reports %s host changes without claiming full completion or replaying",
	(kind) => {
		const h = environment(
			kind === "partial"
				? EditorState.changeFilter.of(() => [0, 3])
				: EditorState.transactionFilter.of((tr) =>
						tr.docChanged ? { changes: { from: 0, to: 7, insert: "host text" } } : tr,
					),
		);
		const preferences = defaultSettings();
		preferences.sourceModeWhenSearch = false;
		preferences.moveCursorToMatch = false;
		const host: FinderHost = {
			preferences: () => preferences,
			history: new HistoryController(
				() => preferences,
				async () => {},
			),
			reportError: vi.fn(),
			mode: () => "source",
			environment: () => null,
			environmentClosed: () => false,
			canRead: () => false,
			matcher: synchronousMatcher,
			clearReading() {},
			activate: () => true,
			selection: () => null,
			reading() {
				throw new Error("Not reading");
			},
			openHistory() {},
			openNativeSearch() {},
		};
		const editor = {
			...h.port,
			current() {
				h.set({ ...h.initial, doc: h.initial.editorView.state.doc });
				return h.port.current();
			},
			reveal: vi.fn(),
		};
		const session = createFinderSession(host, {
			editor,
			presentation: silentPresentation,
			reactive: (value) => value,
			tick: async () => {},
			onMount() {},
		});
		session.showReplace("cat");
		session.setReplacementText("dog");
		editor.reveal.mockClear();
		const result = session.replaceAllMatchedText("dog");
		expect(result).toMatchObject({ changed: true, changeCount: null, status: "failed" });
		expect(h.initial.editorView.state.doc.toString()).toBe(
			kind === "partial" ? "cat dog" : "host text",
		);
		expect(editor.reveal).not.toHaveBeenCalled();
		expect(session.state.replacementRetry).toBeNull();
		expect(session.state.replacementModifiedError).toBe(true);
		expect(session.state.workerError).toBe(false);
		expect(host.reportError).toHaveBeenCalledWith(
			"search.ReplacementModified",
			expect.any(Error),
		);
		expect(h.dispatch.mock.calls.filter(([spec]) => spec && "changes" in spec)).toHaveLength(1);
	},
);
