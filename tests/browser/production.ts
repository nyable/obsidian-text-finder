import { mountFinder } from "../../src/features/finder/ui/mount-finder";
import { MatchEngine } from "../../src/platform/browser/match-engine";
import { defaultSettings } from "../../src/features/settings/model/settings";
import { HistoryController } from "../../src/features/history";
import { EditorState } from "@codemirror/state";
import { searchScopeField } from "../../src/platform/codemirror/search-scope";
import { nextTick } from "vue";
import { createFinderEditor } from "../../src/platform/codemirror/finder-editor";
import { createFinderHost } from "../../src/app/create-finder-host";
export { nextTick };

/** Production Finder, controller, Worker and renderer; only Obsidian is stubbed. */
export function mountFixture(
	target: HTMLElement,
	{ rejectChanges = false, partialChanges = false } = {},
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
	const editorView = {
		get state() {
			return state;
		},
		dispatch(
			spec: Parameters<typeof state.update>[0] | import("@codemirror/state").Transaction,
		) {
			state = "startState" in spec ? spec.state : state.update(spec).state;
		},
	};
	const editor = {
		cm: editorView,
		getValue: () => state.doc.toString(),
		offsetToPos: (ch: number) => ({ line: 0, ch }),
		scrollIntoView() {},
	};
	const view = {
		file: { path: "same.md" },
		containerEl: target,
		editor,
		getMode: () => "source",
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
			vault: {
				getConfig() {
					return undefined;
				},
			},
		},
	};
	const host = {
		plugin,
		activateFloatingFinder: () => true,
		getReadingSelection: () => null,
		getEditorContext: () => ({ view, editor, editorView, file: view.file, doc: state.doc }),
		clearReadingSearch() {},
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
	return {
		finder,
		settings,
		view,
		destroy() {
			finder.destroy();
			engine.destroy();
		},
	};
}
