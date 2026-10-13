import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import { compileString } from "sass";
import ts from "typescript";

// Real preview and toolbar components; only the host translation API and icons
// are replaced. Sass resolves the same shared primitives as the production build.
const root = fileURLToPath(new URL("../", import.meta.url));
export const previewStyles = [];
const bundle = await build({
	stdin: { contents: `export {default as ToolbarPreview} from './src/ToolbarPreview.svelte'; export {tick} from 'svelte';`, resolveDir: root },
	bundle: true, write: false, format: "cjs", platform: "browser",
	plugins: [{
		name: "toolbar-preview-components",
		setup(build) {
			build.onResolve({ filter: /^lucide-svelte$|^\.\/i18n$/ }, ({ path }) => ({ path, namespace: "stub" }));
			build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => {
				if (path === "./i18n") return { contents: `export const i18n = {t: (key, values) => key + (values?.name ? ': ' + values.name : '')};` };
				const icon = compile("<span></span>", { generate: "dom", css: "external" }).js.code.replace("export default Component;", "");
				return { contents: icon + `\nexport {Component as ArrowDown, Component as ArrowUp, Component as ReplaceAll, Component as Replace, Component as Regex, Component as CaseSensitive, Component as History, Component as Ellipsis, Component as ChevronDown, Component as ChevronRight, Component as X};`, resolveDir: root };
			});
			build.onLoad({ filter: /\.svelte$/ }, ({ path: filename }) => {
				const source = readFileSync(filename, "utf8")
					.replace(/<script lang="ts">([\s\S]*?)<\/script>/, (_, script) => `<script>${ts.transpileModule(script, {
						compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
					}).outputText}</script>`)
					.replace(/<style lang="scss">([\s\S]*?)<\/style>/g, (_, styles) => `<style>${compileString(styles, { loadPaths: [path.dirname(filename)] }).css}</style>`);
				const compiled = compile(source, { filename, generate: "dom", css: "injected" });
				previewStyles.push(compiled.css.code);
				return { contents: compiled.js.code, resolveDir: path.dirname(filename) };
			});
		},
	}],
});
const module = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(module, module.exports);
export const { ToolbarPreview, tick } = module.exports;
