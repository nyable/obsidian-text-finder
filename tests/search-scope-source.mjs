import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import { loadSource } from "./source-loader.mjs";

export const scopeSource = loadSource("../src/search-scope.ts", {
	"@codemirror/state": state, "@codemirror/view": view,
	"./util/text-helper": loadSource("../src/util/text-helper.ts"),
});
