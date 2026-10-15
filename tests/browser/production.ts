import { mountFinder } from "../../src/SearchBox";
import { MatchEngine } from "../../src/match-engine";
import { defaultSettings } from "../../src/settings";
import { HistoryController } from "../../src/history";
import { EditorState } from "@codemirror/state";
import { searchScopeField } from "../../src/search-scope";
import { nextTick } from "vue";
export { nextTick };

/** Production Finder, controller, Worker and renderer; only Obsidian is stubbed. */
export function mountFixture(target: HTMLElement) {
	const settings = defaultSettings();
	settings.moveCursorToMatch = false; settings.sourceModeWhenSearch = false;
	let state = EditorState.create({doc: "cat CAT cat2", extensions: [searchScopeField]});
	const editorView = {get state() {return state;}, dispatch(spec: Parameters<typeof state.update>[0]) {state = state.update(spec).state;}};
	const editor = {cm: editorView, getValue: () => state.doc.toString(), offsetToPos: (ch: number) => ({line: 0, ch}), scrollIntoView() {}};
	const view = {file: {path: "same.md"}, containerEl: target, editor, getMode: () => "source", getState: () => ({mode: "source",source: true}), setState() {}};
	const engine = new MatchEngine(() => target.ownerDocument.defaultView);
	const plugin = {settings, history: new HistoryController(() => settings, async () => {}), reportError: console.error, app: {vault: {getConfig() {return undefined;}}}};
	const host = {plugin, getEditorContext: () => ({view,editor,editorView,file: view.file,doc: state.doc}),
		clearReadingSearch() {}, getMatchEngine: () => engine, openHistory() {}};
	const finder = mountFinder(target, {editorSearch: host as never, ownerView: view as never, cid: `browser-${Math.random()}`});
	return {finder, settings, view, destroy() {finder.destroy(); engine.destroy();}};
}
