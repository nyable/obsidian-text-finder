import { build, normalizePath } from "vite";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const hostExternal = (id) =>
	id === "obsidian" ||
	id === "electron" ||
	builtinModules.includes(id) ||
	id.startsWith("node:") ||
	/^@(codemirror|lezer)\//.test(id);

export function embeddedEntry(entry, source) {
	// Vite resolves lib.entry with native path.resolve, restoring backslashes
	// on Windows. Canonicalize both hooks, not just the configured entry.
	const canonical = (id) => normalizePath(id.replaceAll("\\", "/"));
	const virtual = canonical(entry);
	return {
		name: "embedded-entry",
		resolveId(id) {
			if (canonical(id) === virtual) return virtual;
		},
		load(id) {
			if (canonical(id) === virtual) return source;
		},
	};
}

/** In-memory standalone browser bundle; no esbuild or extra runtime asset. */
/** @param {{ entry?: string, source?: string, name?: string }} options */
export async function embeddedBundle({ entry, source, name }) {
	if (source == null && !entry) throw new Error("Embedded build requires an entry or source");
	const virtual = normalizePath(resolve(root, "tools/__embedded-entry__.js"));
	const result = await build({
		configFile: false,
		root,
		publicDir: false,
		logLevel: "error",
		plugins: source == null ? [] : [embeddedEntry(virtual, source)],
		build: {
			write: false,
			target: "es2018",
			minify: false,
			lib: {
				entry: source == null ? resolve(root, entry) : virtual,
				formats: ["iife"],
				name: name ?? "WorkerBundle",
				fileName: () => "embedded.js",
			},
			rolldownOptions: { output: { codeSplitting: false } },
		},
	});
	const output = (Array.isArray(result) ? result[0] : result).output;
	if (output.length !== 1 || output[0].type !== "chunk" || output[0].dynamicImports.length)
		throw new Error("Embedded build must be self-contained");
	return output[0];
}

export function embeddedSources() {
	return {
		name: "text-finder-embedded-sources",
		resolveId(id) {
			if (["text-finder:match-worker", "virtual:color-picker"].includes(id)) return `\0${id}`;
		},
		async load(id) {
			if (id === "\0text-finder:match-worker") {
				const chunk = await embeddedBundle({
					entry: "src/platform/browser/match-worker.ts",
				});
				for (const path of Object.keys(chunk.modules))
					if (!path.startsWith("\0")) this.addWatchFile(path);
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
	return {
		name: "text-finder-release-assets",
		buildStart() {
			this.addWatchFile(resolve(root, "manifest.json"));
		},
		async generateBundle(_options, bundle) {
			this.emitFile({
				type: "asset",
				fileName: "manifest.json",
				source: await readFile(resolve(root, "manifest.json")),
			});
			const names = Object.keys(bundle).sort();
			if (names.some((name) => !["main.js", "styles.css", "main.js.map"].includes(name)))
				throw new Error(`Unexpected plugin assets: ${names}`);
		},
	};
}
