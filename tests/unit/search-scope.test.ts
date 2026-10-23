import { expect, it, vi } from "vitest";
import {
	createSearchScope,
	type ScopeState,
} from "../../src/features/finder/application/search-scope";
import type {
	EditorPort,
	EditingSnapshot,
} from "../../src/features/finder/application/editor-port";
import type { FinderHost } from "../../src/features/finder/application/finder-host";

function environment() {
	let mode: "source" | "preview" = "source",
		window: object = {};
	let ranges: readonly { from: number; to: number }[] | null = null;
	const snapshot: EditingSnapshot = {
		view: {},
		editor: {},
		editorView: {},
		file: { path: "a.md" },
		doc: { length: 7, toString: () => "cat cat" },
	};
	const state: ScopeState = {
		disposed: false,
		scopeEnabled: false,
		scopeBlocked: false,
		scopeEmpty: false,
		scopeEpoch: 0,
		scopeContext: null,
		scopeWindow: null,
		readingScope: false,
	};
	const reading = { setScope: vi.fn(() => true), clearScope: vi.fn() };
	const host = {
		mode: () => mode,
		environment: () => window,
		selection: () => [{}],
		canRead: () => true,
		reading: () => reading,
		reportError: vi.fn(),
	} as unknown as FinderHost;
	const editor = {
		scope: () => ({ ranges, candidate: [{ from: 4, to: 7 }] }),
		documentLength: () => 7,
		setScope: vi.fn((_snapshot: EditingSnapshot, value: typeof ranges) => {
			ranges = value;
		}),
	} as unknown as EditorPort;
	const cancel = vi.fn(),
		invalidate = vi.fn(),
		resetIndex = vi.fn();
	const scope = createSearchScope(
		state,
		host,
		editor,
		() => snapshot,
		cancel,
		invalidate,
		resetIndex,
	);
	return {
		scope,
		state,
		snapshot,
		editor,
		reading,
		cancel,
		invalidate,
		resetIndex,
		mode: (value: typeof mode) => {
			mode = value;
		},
		migrate: () => {
			window = {};
		},
	};
}

it.each(["source", "preview"] as const)(
	"mode switch from %s ends scope instead of carrying invalid coordinates",
	(from) => {
		const h = environment();
		h.mode(from);
		expect(h.scope.activate()).toBe(true);
		const epoch = h.state.scopeEpoch;
		h.cancel.mockClear();
		h.invalidate.mockClear();
		h.resetIndex.mockClear();
		h.mode(from === "source" ? "preview" : "source");
		h.scope.sync(from === "source" ? null : h.snapshot);
		expect(h.state).toMatchObject({
			scopeEnabled: false,
			scopeBlocked: false,
			scopeEmpty: false,
			readingScope: false,
			scopeContext: null,
		});
		expect(h.state.scopeEpoch).toBeGreaterThan(epoch);
		expect(h.scope.ranges()).toBeUndefined();
		expect(h.cancel).toHaveBeenCalledOnce();
		expect(h.invalidate).toHaveBeenCalledOnce();
		expect(h.resetIndex).toHaveBeenCalledOnce();
		if (from === "preview") expect(h.reading.clearScope).toHaveBeenCalledOnce();
		else expect(h.editor.setScope).toHaveBeenLastCalledWith(h.snapshot, null);
		h.mode(from);
		h.scope.sync(from === "source" ? h.snapshot : null);
		expect(h.state.scopeEnabled).toBe(false);
		expect(h.scope.activate()).toBe(true);
	},
);

it("same search mode preserves scope, while identity loss remains blocked until a mode switch", () => {
	const h = environment();
	h.scope.activate();
	h.scope.sync(h.snapshot);
	expect(h.scope.ranges()).toEqual([{ from: 4, to: 7 }]);
	h.migrate();
	h.scope.sync(h.snapshot);
	expect(h.state.scopeBlocked).toBe(true);
	expect(h.scope.ranges()).toEqual([]);
	h.scope.sync(h.snapshot);
	expect(h.state.scopeBlocked).toBe(true);
	h.mode("preview");
	h.scope.sync(null);
	expect(h.state.scopeBlocked).toBe(false);
	expect(h.scope.ranges()).toBeUndefined();
});
