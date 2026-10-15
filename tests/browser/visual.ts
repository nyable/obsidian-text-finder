import { mountFinder } from "../../src/SearchBox";
import { mountView } from "../../src/ui/mount";
import ToolbarPreview from "../../src/ToolbarPreview.vue";
import HistoryList from "../../src/HistoryList.vue";
import HistoryDetail from "../../src/HistoryDetail.vue";
import { EditorState } from "@codemirror/state";
import { defaultSettings } from "../../src/settings";
import { HistoryController } from "../../src/history";
import { searchScopeField } from "../../src/search-scope";
import { nextTick as tick } from "vue";
import "../../src/styles/index.scss";

// Production components/icons/translations with an explicit simulated host.
const params = new URLSearchParams(location.search);
const target = document.querySelector<HTMLElement>("#owner")!;
const scenario = params.get("scenario") ?? "find";
const settings = defaultSettings();
const plugin = { settings, saveSettings: async () => {}, reportError: console.error,
	app: { vault: { getConfig: () => undefined } } };
Object.assign(plugin, { history: new HistoryController(() => settings, async () => {}) });
const item = { text: "cat\n  exact whitespace  ", createdAt: 1700000000000, lastUsedAt: 1700000060000, count: 3 };
let component: { destroy(): void };
if (scenario === "preview") {
	component = mountView(ToolbarPreview, target, { searchToolbar: settings.searchToolbar, replaceToolbar: settings.replaceToolbar,
		defaultRegexMode: true, defaultWholeWord: true });
} else if (scenario === "history") {
	component = mountView(HistoryList, target, { history: [item, { ...item, text: "another long query with words and symbols .*[]", count: 1 }], settings });
} else if (scenario === "detail") {
	component = mountView(HistoryDetail, target, { item });
} else {
	let state = EditorState.create({ doc: "cat CAT cat2\nA long line with cat and other text.", extensions: [searchScopeField] });
	const editorView = { get state() { return state; }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state; } };
	const editor = { cm: editorView, getValue: () => state.doc.toString(), offsetToPos: (offset: number) => ({ line: 0, ch: offset }), scrollIntoView() {} };
	const file = { path: "fixture.md" };
	const view = { file, containerEl: target, editor, getMode: () => "source", getState: () => ({ mode: "source", source: true }), setState() {} };
	const editorSearch = { plugin, getEditorContext: () => ({ view, editor, editorView, file, doc: state.doc }), clearReadingSearch() {}, openHistory() {} };
	const finder = mountFinder(target, { cid: "baseline", ownerView: view as never, editorSearch: editorSearch as never });
	finder.setVisible(true, scenario === "empty" ? "" : scenario === "no-results" ? "absent" : "cat");
	if (scenario === "replace") finder.showReplace("cat");
	if (scenario === "docked") finder.dockFinder();
	component = finder;
}
await tick();
await document.fonts.ready;
// Avoid capturing component/position transitions mid-flight, without arbitrary sleeps.
for (const animation of document.getAnimations()) animation.finish();
await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
Object.assign(window, { baselineReady: true, destroyBaseline: () => component.destroy() });
