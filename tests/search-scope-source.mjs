import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import { loadSource } from "./source-loader.mjs";

export const editorGeometry = loadSource("../src/editor-geometry.ts");
export const scopeGeometry = loadSource("../src/scope-geometry.ts", { "./editor-geometry": editorGeometry });

export const scopeSource = loadSource("../src/search-scope.ts", {
	"@codemirror/state": state, "@codemirror/view": view,
	"./util/text-helper": loadSource("../src/util/text-helper.ts"),
	"./scope-outline": loadSource("../src/scope-outline.ts"),
	"./editor-geometry": editorGeometry, "./scope-geometry": scopeGeometry,
});
