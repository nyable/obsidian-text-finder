import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute framework-independent TypeScript controllers with explicit host ports.
export function loadSource(relativePath, imports = {}) {
	const filename = new URL(relativePath, import.meta.url);
	let source = readFileSync(filename, "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2018,
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
