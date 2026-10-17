import { describe, expect, it, vi } from "vitest";
import { createFinderSession } from "../../src/features/finder/application/finder-session";
import { silentPresentation } from "../../src/features/finder/application/presentation-port";
import type {
	EditorPort,
	EditingSnapshot,
} from "../../src/features/finder/application/editor-port";
import type { FinderHost } from "../../src/features/finder/application/finder-host";
import { defaultSettings } from "../../src/features/settings/model/settings";
import { HistoryController } from "../../src/features/history";
import type { ReplacementChange } from "../../src/core/search/text-matching";
import { synchronousMatcher } from "../support/synchronous-matcher";

function environment() {
	const preferences = defaultSettings();
	preferences.sourceModeWhenSearch = false;
	preferences.moveCursorToMatch = false;
	let source = "cat cat",
		available = true;
	const file = { path: "same.md" },
		view = {},
		editorIdentity = {},
		editorView = {};
	const document = (text: string) => ({ length: text.length, toString: () => text });
	let doc = document(source);
	const snapshot = (): EditingSnapshot | null =>
		available ? { file, view, editor: editorIdentity, editorView, doc } : null;
	const writes: ReplacementChange[][] = [];
	const editor: EditorPort = {
		ownerFile: () => file,
		current: snapshot,
		scope: () => undefined,
		documentLength: () => doc.length,
		setScope: vi.fn(),
		publish: vi.fn(),
		reveal: vi.fn(),
		restoreMode: vi.fn(),
		hasCommitted: (captured) => doc !== captured.doc,
		commit(_captured, changes) {
			writes.push([...changes]);
			for (const change of [...changes].reverse())
				source = source.slice(0, change.from) + change.insert + source.slice(change.to);
			doc = document(source);
		},
	};
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
		clearReading: vi.fn(),
		activate: () => true,
		selection: () => null,
		reading: () => {
			throw new Error("Reading must not be used");
		},
		openHistory: vi.fn(),
		openNativeSearch: vi.fn(),
	};
	let cleanup: (() => void) | void;
	const session = createFinderSession(host, {
		editor,
		presentation: silentPresentation,
		reactive: (value) => value,
		tick: async () => {},
		onMount(callback) {
			cleanup = callback();
		},
	});
	return {
		session,
		host,
		editor,
		writes,
		source: () => source,
		edit(text: string) {
			source = text;
			doc = document(text);
		},
		closeOwner() {
			available = false;
		},
		dispose: () => cleanup?.(),
	};
}

describe("Finder application with explicit owner ports", () => {
	it("restores a folded replacement, captures hidden text, and never executes it on application", () => {
		const h = environment();
		const recipe = {
			search: "cat",
			options: { regexMode: true, caseSensitive: false, wholeWord: false },
			replacement: { text: "\\n", interpretEscapes: false },
			collapse: true,
		};
		expect(h.session.applyRecipe(recipe)).toBe(true);
		expect(h.session.getSearchCache().collapse).toBe(true);
		expect(h.session.captureRecipe()).toEqual(recipe);
		expect(h.writes).toHaveLength(0);
		h.session.showReplace();
		expect(h.session.getSearchCache().replace).toBe("\\n");
		h.session.replaceAllMatchedText("\\n");
		expect(h.source()).toBe("\\n \\n");
		h.dispose();
	});
	it("captures manually folded replacement values, including explicitly applied empty replacements", () => {
		const h = environment();
		h.session.showReplace("cat");
		h.session.setCollapse(true);
		expect(h.session.captureRecipe()).toMatchObject({
			collapse: true,
			replacement: { text: "" },
		});
		h.session.showReplace();
		h.session.setReplacementText("dog");
		h.session.setCollapse(true);
		expect(h.session.captureRecipe()).toMatchObject({
			collapse: true,
			replacement: { text: "dog" },
		});
		h.session.applyRecipe({
			search: "cat",
			options: { regexMode: false, caseSensitive: false, wholeWord: false },
			replacement: { text: "", interpretEscapes: true },
			collapse: true,
		});
		expect(h.session.captureRecipe()).toMatchObject({
			collapse: true,
			replacement: { text: "" },
		});
		h.dispose();
	});
	it("applies a portable recipe once without writing or changing global defaults", () => {
		const h = environment();
		const matcher = synchronousMatcher();
		const match = vi.spyOn(matcher, "match");
		h.host.matcher = () => matcher;
		const recipe = {
			search: "cat",
			options: { regexMode: true, caseSensitive: true, wholeWord: false },
			replacement: { text: "\\n", interpretEscapes: false },
		};
		expect(h.session.applyRecipe(recipe)).toBe(true);
		expect(match).toHaveBeenCalledTimes(1);
		expect(h.writes).toHaveLength(0);
		expect(h.session.captureRecipe()).toEqual({ ...recipe, collapse: false });
		expect(h.host.preferences().useEscapeCharInReplace).toBe(true);
		expect(h.host.history.sorted()[0]?.count).toBe(1);
		h.session.toNextMatch();
		expect(h.host.history.sorted()[0]?.count).toBe(1);
		h.session.replaceAllMatchedText("\\n");
		expect(h.source()).toBe("\\n \\n");
		h.dispose();
	});
	it("find-only recipes clear old replacement configuration, and reject closed owners", () => {
		const h = environment();
		h.session.showReplace("cat");
		h.session.setReplacementText("dangerous old replacement");
		const recipe = {
			search: "cat",
			options: { regexMode: false, caseSensitive: false, wholeWord: true },
			replacement: null,
		};
		expect(h.session.applyRecipe(recipe)).toBe(true);
		expect(h.session.captureRecipe()).toEqual({ ...recipe, collapse: true });
		expect(h.session.getSearchCache().replace).toBe("");
		h.closeOwner();
		expect(h.session.applyRecipe({ ...recipe, search: "other" })).toBe(false);
		expect(h.session.captureRecipe().search).toBe("cat");
		h.dispose();
	});
	it("releases history subscription even when presentation cleanup throws", () => {
		const h = environment();
		const unsubscribe = vi.fn();
		h.host.history.subscribe = () => unsubscribe;
		let cleanup: (() => void) | void;
		createFinderSession(h.host, {
			editor: h.editor,
			presentation: {
				...silentPresentation,
				hideMenu() {
					throw new Error("menu cleanup");
				},
			},
			reactive: (value) => value,
			tick: async () => {},
			onMount(callback) {
				cleanup = callback();
			},
		});
		expect(() => cleanup?.()).toThrow(AggregateError);
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(() => cleanup?.()).not.toThrow();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		h.dispose();
	});
	it("does not widen an invalidated selection when applying a preset", () => {
		const h = environment();
		h.session.state.scopeBlocked = true;
		h.session.applyRecipe({
			search: "cat",
			options: { regexMode: false, caseSensitive: false, wholeWord: false },
			replacement: { text: "dog", interpretEscapes: true },
		});
		expect(h.session.hasSelectionScope()).toBe(true);
		expect(h.session.getSearchCache().matches).toEqual([]);
		h.session.replaceAllMatchedText("dog");
		expect(h.writes).toHaveLength(0);
		h.dispose();
	});
	it("reading applies only find options and never leaves a hidden replacement for later editing", () => {
		const h = environment();
		h.host.mode = () => "preview";
		h.host.canRead = () => true;
		const search = vi.fn();
		h.host.reading = () => ({
			search,
			setScope: () => false,
			clearScope() {},
			blockScope() {},
			pauseNavigation() {},
			retrySynchronously() {},
		});
		const options = { regexMode: true, caseSensitive: false, wholeWord: false };
		expect(
			h.session.applyRecipe({
				search: "cat",
				options,
				replacement: { text: "danger", interpretEscapes: false },
			}),
		).toBe(true);
		expect(search).toHaveBeenCalledTimes(1);
		expect(h.session.captureRecipe()).toEqual({
			search: "cat",
			options,
			replacement: null,
			collapse: true,
		});
		expect(h.writes).toHaveLength(0);
		h.dispose();
	});
	it("recomputes hidden replacement coordinates against the current snapshot", () => {
		const h = environment();
		h.session.setFindText("cat", false);
		h.edit("prefix cat cat");
		h.session.replaceMatchedText("dog");
		expect(h.source()).toBe("prefix dog cat");
		expect(h.writes[0]).toEqual([{ from: 7, to: 10, insert: "dog" }]);
		h.dispose();
	});
	it("does not borrow another same-file owner or write after its owner closes", () => {
		const first = environment(),
			second = environment();
		first.session.setFindText("cat", false);
		second.session.setFindText("cat", false);
		first.session.replaceAllMatchedText("dog");
		expect(first.source()).toBe("dog dog");
		expect(second.source()).toBe("cat cat");
		second.closeOwner();
		second.session.replaceAllMatchedText("wrong");
		expect(second.writes).toHaveLength(0);
		first.dispose();
		second.dispose();
	});
	it("rejects an old async matching result after a new document snapshot", async () => {
		const h = environment();
		let resolve!: (value: import("../../src/core/search/match-protocol").MatchResult) => void;
		const pending = new Promise<import("../../src/core/search/match-protocol").MatchResult>(
			(done) => {
				resolve = done;
			},
		);
		h.host.matcher = () => ({ match: () => pending, cancel() {}, destroy() {} });
		h.session.setVisible(true, "cat");
		h.edit("other document");
		resolve({
			status: "completed",
			synchronous: false,
			matches: [{ from: 0, to: 3, index: 0 }],
		});
		await pending;
		await Promise.resolve();
		expect(h.session.getSearchCache().matches).toEqual([]);
		h.dispose();
	});
	it("does not lend cache or option state to host command readers", () => {
		const h = environment();
		h.session.setFindText("cat", false);
		const observed = h.session.getSearchCache();
		Reflect.set(observed, "search", "wrong");
		Reflect.set(observed.options, "regexMode", true);
		expect(h.session.state.cache.search).toBe("cat");
		expect(h.session.state.cache.options.regexMode).toBe(false);
		expect(observed.matches).toBe(h.session.state.cache.matches);
		h.dispose();
	});
});
