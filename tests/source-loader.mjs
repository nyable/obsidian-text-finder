import { readFileSync } from "node:fs";
import ts from "typescript";

// Exercise the component's actual exported actions without an Obsidian DOM.
// Svelte handles reactive labels separately; they are not part of these actions.
export function loadSource(relativePath, imports = {}) {
	const filename = new URL(relativePath, import.meta.url);
	let source = readFileSync(filename, "utf8");
	if (relativePath.endsWith(".svelte")) {
		source = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
	}
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2018,
		},
		transformers: {
			before: [(context) => {
				const visit = (node) => {
					if (ts.isLabeledStatement(node) && node.label.text === "$") {
						return undefined;
					}
					return ts.visitEachChild(node, visit, context);
				};
				return (node) => ts.visitNode(node, visit);
			}],
		},
	});
	const module = { exports: {} };
	const require = (name) => {
		if (!(name in imports)) {
			throw new Error(`Unexpected import in ${relativePath}: ${name}`);
		}
		return imports[name];
	};
	new Function("require", "module", "exports", outputText)(
		require, module, module.exports,
	);
	return module.exports;
}
