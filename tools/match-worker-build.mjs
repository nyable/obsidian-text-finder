import { build } from "esbuild";

export function matchWorkerPlugin() {
	return { name: "match-worker-source", setup(builder) {
		builder.onResolve({ filter: /^text-finder:match-worker$/ }, () => ({ path: "match-worker", namespace: "match-worker" }));
		builder.onLoad({ filter: /.*/, namespace: "match-worker" }, async () => {
			// Rebuilt on every parent rebuild, including helper edits in watch mode.
			const result = await build({ entryPoints: ["src/match-worker.ts"], bundle: true, write: false,
				format: "iife", platform: "browser", target: "es2018", minify: true, metafile: true });
			return { contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
				watchFiles: Object.keys(result.metafile.inputs) };
		});
	} };
}
