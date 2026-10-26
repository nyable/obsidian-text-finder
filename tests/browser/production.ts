import { mountFinder } from "../../src/features/finder/ui/mount-finder";
import { MatchEngine } from "../../src/platform/browser/match-engine";
import { defaultSettings } from "../../src/features/settings/model/settings";
import { HistoryController } from "../../src/features/history";
import { EditorState } from "@codemirror/state";
import { searchScopeField } from "../../src/platform/codemirror/search-scope";
import { nextTick } from "vue";
import { createFinderEditor } from "../../src/platform/codemirror/finder-editor";
import { createFinderHost } from "../../src/app/create-finder-host";
import { EditorView } from "@codemirror/view";
import { ReadingSearch } from "../../src/features/reading";
import { EditorSearch } from "../../src/app/workspace-runtime";
export { nextTick };

/** Production Finder, controller, Worker and renderer; only Obsidian is stubbed. */
export function mountFixture(
	target: HTMLElement,
	{ rejectChanges = false, partialChanges = false, focusable = false, reading = false } = {},
) {
	const settings = defaultSettings();
	settings.moveCursorToMatch = false;
	settings.sourceModeWhenSearch = false;
	let state = EditorState.create({
		doc: "cat CAT cat2",
		extensions: [
			searchScopeField,
			EditorState.transactionFilter.of((tr) => (rejectChanges && tr.docChanged ? [] : tr)),
			EditorState.changeFilter.of(() => (partialChanges ? [0, 3] : true)),
		],
	});
	const simulatedEditorView = {
		get state() {
			return state;
		},
		dispatch(
			spec: Parameters<typeof state.update>[0] | import("@codemirror/state").Transaction,
		) {
			state = "startState" in spec ? spec.state : state.update(spec).state;
		},
	};
	const editorView = focusable ? new EditorView({ state, parent: target }) : simulatedEditorView;
	const preview = target.ownerDocument.createElement("div");
	if (reading) {
		preview.style.cssText = "height:120px;overflow:auto";
		const section = target.ownerDocument.createElement("div");
		section.textContent = "cat ".repeat(2000);
		section.style.width = "120px";
		preview.append(section);
		target.append(preview);
	}
	const editor = {
		cm: editorView,
		getValue: () => editorView.state.doc.toString(),
		offsetToPos: (ch: number) => ({ line: 0, ch }),
		scrollIntoView() {},
	};
	const view = {
		file: { path: "same.md" },
		containerEl: target,
		editor,
		getMode: () => (reading ? "preview" : "source"),
		previewMode: {
			renderer: {
				previewEl: preview,
				sections: [{ el: preview.firstElementChild, rendered: true }],
				text: "cat note",
				lastText: "cat note",
				parsing: false,
				rendered: null,
				showSection() {},
				applyScrollSection: () => true,
				updateVirtualDisplay() {},
				onRendered() {},
			},
		},
		getState: () => ({ mode: "source", source: true }),
		setState() {},
	};
	const engine = new MatchEngine(() => target.ownerDocument.defaultView);
	const plugin = {
		settings,
		history: new HistoryController(
			() => settings,
			async () => {},
		),
		reportError: console.error,
		app: {
			workspace: { getActiveViewOfType: () => view },
			vault: {
				getConfig() {
					return undefined;
				},
			},
		},
	};
	const readingSearch = reading
		? new ReadingSearch(
				view as never,
				() => true,
				() => {},
			)
		: null;
	const host = {
		plugin,
		isViewOpen: () => target.isConnected,
		activateFloatingFinder: () => true,
		getReadingSelection: () => null,
		getEditorContext: () =>
			reading
				? null
				: { view, editor, editorView, file: view.file, doc: editorView.state.doc },
		canSearchReading: () => true,
		getReadingSearch: () => readingSearch,
		clearReadingSearch() {
			readingSearch?.clear();
		},
		getMatchEngine: () => engine,
		openHistory() {},
	};
	const finder = mountFinder(target, {
		editor: createFinderEditor(
			host.getEditorContext as never,
			() => plugin.app.vault as never,
			() => view.file as never,
		),
		host: createFinderHost(host as never, view as never),
		owner: target,
		cid: `browser-${Math.random()}`,
	});
	// Exercise the production Escape handler without constructing a second runtime.
	const events = Object.create(EditorSearch.prototype) as EditorSearch;
	const resources: { removeFinderEvents?: () => void } = {};
	Object.assign(events, { owners: { ensure: () => resources } });
	(
		events as unknown as { registerFinderEvent(view: unknown, finder: unknown): void }
	).registerFinderEvent(view, finder);
	return {
		finder,
		settings,
		view,
		preview,
		destroy() {
			resources.removeFinderEvents?.();
			finder.destroy();
			engine.destroy();
			readingSearch?.destroy();
			if (editorView instanceof EditorView) editorView.destroy();
		},
	};
}
