import { mountFinder } from "../../src/features/finder/ui/mount-finder";
import { mountView } from "../../src/shared/ui/mount-view";
import ToolbarPreview from "../../src/features/settings/ui/ToolbarPreview.vue";
import HistoryPanel from "../../src/features/history/ui/HistoryPanel.vue";
import { EditorState } from "@codemirror/state";
import { defaultSettings } from "../../src/features/settings/model/settings";
import { HistoryController } from "../../src/features/history";
import { PresetController, type SearchRecipe } from "../../src/features/presets";
import { searchScopeField } from "../../src/platform/codemirror/search-scope";
import { nextTick as tick } from "vue";
import { createFinderEditor } from "../../src/platform/codemirror/finder-editor";
import { createFinderHost } from "../../src/app/create-finder-host";
import { synchronousMatcher } from "../support/synchronous-matcher";
import "../../src/styles/index.scss";

// Production components/icons/translations with an explicit simulated host.
const params = new URLSearchParams(location.search);
const target = document.querySelector<HTMLElement>("#owner")!;
const scenario = params.get("scenario") ?? "find";
const settings = defaultSettings();
const plugin = {
	settings,
	saveSettings: async () => {},
	reportError: console.error,
	app: { vault: { getConfig: () => undefined } },
};
Object.assign(plugin, {
	history: new HistoryController(
		() => settings,
		async () => {},
	),
});
const item = {
	text: "cat\n  exact whitespace  ",
	createdAt: 1700000000000,
	lastUsedAt: 1700000060000,
	count: 3,
};
let component: { destroy(): void };
if (scenario === "preview") {
	component = mountView(ToolbarPreview, target, {
		searchToolbar: settings.searchToolbar,
		replaceToolbar: settings.replaceToolbar,
		defaultRegexMode: true,
		defaultWholeWord: true,
	});
} else if (["history", "detail", "presets", "preset-editor"].includes(scenario)) {
	target.classList.add("nya-library-host");
	// #owner's generic full-width fixture rule would override the modal class.
	target.style.width = "min(640px, calc(100vw - 40px))";
	settings.searchHistory = [
		item,
		{ ...item, text: "another long query with words and symbols .*[]", count: 1 },
	];
	if (params.get("detailLong") === "true")
		settings.searchHistory = settings.searchHistory.map((entry) => ({
			...entry,
			text: `${entry.text}\n${"long original query with exact whitespace  \n".repeat(120)}`,
		}));
	if (params.get("stress") === "true")
		settings.searchHistory = Array.from({ length: 40 }, (_, index) => ({
			...item,
			text: `Query ${index}\n  exact whitespace  `,
		}));
	const recipe: SearchRecipe = {
		search: "[\\t ]+$",
		options: { regexMode: true, caseSensitive: false, wholeWord: false },
		replacement: { text: "", interpretEscapes: true },
	};
	const history = new HistoryController(
		() => settings,
		async () => {},
	);
	let presetId = 0;
	const presets = new PresetController(
		() => settings,
		async () => {},
		() => `fixture-preset-${++presetId}`,
	);
	presets.put("Clean trailing whitespace", recipe);
	if (params.get("multiline") === "true")
		presets.put("Multiline task labels", {
			...recipe,
			search: "TODO\n待办\n待处理\n",
			replacement: { text: "任务\n待办事项", interpretEscapes: false },
		});
	if (params.get("presetStress") === "true") {
		for (let index = 1; index <= 8; index++)
			presets.put(`Rule ${index}`, {
				...recipe,
				search: `query ${index}`,
				collapse: index % 2 === 1,
			});
	}
	component = mountView(HistoryPanel, target, {
		view: {
			preferences: () => settings,
			controller: history,
			presets,
			capture: () => recipe,
			apply: () => true,
			reuse: () => true,
			copy: async () => {},
			isDisposed: () => false,
			reportError: console.error,
		},
		close() {},
		initialTab: scenario.startsWith("preset") ? "presets" : "history",
		initialRecipe: scenario === "preset-editor" ? recipe : null,
	});
	if (scenario === "detail") {
		await tick();
		target.querySelector<HTMLButtonElement>('[aria-label="Details"]')?.click();
	}
} else {
	let state = EditorState.create({
		doc: "cat CAT cat2\nA long line with cat and other text.",
		extensions: [searchScopeField],
	});
	const editorView = {
		get state() {
			return state;
		},
		dispatch(spec: Parameters<typeof state.update>[0]) {
			state = state.update(spec).state;
		},
	};
	const editor = {
		cm: editorView,
		getValue: () => state.doc.toString(),
		offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
		scrollIntoView() {},
	};
	const file = { path: "fixture.md" };
	const view = {
		file,
		containerEl: target,
		editor,
		getMode: () => "source",
		getState: () => ({ mode: "source", source: true }),
		setState() {},
	};
	const editorSearch = {
		plugin,
		getMatchEngine: synchronousMatcher,
		activateFloatingFinder: () => true,
		getReadingSelection: () => null,
		getEditorContext: () => ({ view, editor, editorView, file, doc: state.doc }),
		clearReadingSearch() {},
		openHistory() {},
	};
	const finder = mountFinder(target, {
		editor: createFinderEditor(
			editorSearch.getEditorContext as never,
			() => plugin.app.vault as never,
			() => file as never,
		),
		cid: "baseline",
		owner: target,
		host: createFinderHost(editorSearch as never, view as never),
	});
	finder.setVisible(
		true,
		scenario === "empty" ? "" : scenario === "no-results" ? "absent" : "cat",
	);
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
