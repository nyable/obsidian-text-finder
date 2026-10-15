import { build, normalizePath } from "vite";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const hostExternal = (id) => id === "obsidian" || id === "electron"
	|| builtinModules.includes(id) || id.startsWith("node:") || /^@(codemirror|lezer)\//.test(id);

/** In-memory standalone browser bundle; no esbuild or extra runtime asset. */
export async function embeddedBundle({ entry, source, name }) {
	const virtual = normalizePath(resolve(root, "tools/__embedded-entry__.js"));
	const result = await build({ configFile: false, root, publicDir: false, logLevel: "error",
		plugins: source == null ? [] : [{ name: "embedded-entry", resolveId(id) { if (id === virtual) return id; },
			load(id) { if (id === virtual) return source; } }],
		build: { write: false, target: "es2018", minify: false,
			lib: { entry: source == null ? resolve(root, entry) : virtual, formats: ["iife"], name: name ?? "WorkerBundle", fileName: () => "embedded.js" },
			rolldownOptions: { output: { codeSplitting: false } },
		} });
	const output = (Array.isArray(result) ? result[0] : result).output;
	if (output.length !== 1 || output[0].type !== "chunk" || output[0].dynamicImports.length) throw new Error("Embedded build must be self-contained");
	return output[0];
}

export function embeddedSources() {
	return { name: "text-finder-embedded-sources",
		resolveId(id) { if (["text-finder:match-worker", "virtual:color-picker"].includes(id)) return `\0${id}`; },
		async load(id) {
			if (id === "\0text-finder:match-worker") {
				const chunk = await embeddedBundle({ entry: "src/match-worker.ts" });
				for (const path of Object.keys(chunk.modules)) if (!path.startsWith("\0")) this.addWatchFile(path);
				return `export default ${JSON.stringify(chunk.code)}`;
			}
			if (id === "\0virtual:color-picker") {
				this.addWatchFile(resolve(root, "tools/color-picker-build.mjs"));
				const { colorPickerModule } = await import("./color-picker-build.mjs");
				return colorPickerModule({ watch: (path) => this.addWatchFile(path) });
			}
		},
	};
}

export function releaseAssets() {
	return { name: "text-finder-release-assets", buildStart() { this.addWatchFile(resolve(root, "manifest.json")); }, async generateBundle(_options, bundle) {
		this.emitFile({ type: "asset", fileName: "manifest.json", source: await readFile(resolve(root, "manifest.json")) });
		const names = Object.keys(bundle).sort();
		if (names.some((name) => !["main.js", "styles.css", "main.js.map"].includes(name))) throw new Error(`Unexpected plugin assets: ${names}`);
	} };
}
