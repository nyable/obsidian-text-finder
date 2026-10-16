import { build } from "vite";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { root, hostExternal } from "../vite-build.mjs";

const entries = {
	reading: "tools/diagnostics/reading-benchmark.mjs",
	search: "tools/diagnostics/search-benchmark.mjs",
	index: "tools/diagnostics/reading-index-benchmark.mjs",
	worker: "tools/diagnostics/worker-experiment-benchmark.mjs",
};
const name = process.argv[2],
	entry = entries[name];
if (!entry) throw new Error(`Choose a diagnostic: ${Object.keys(entries).join(", ")}`);
// The official bundler resolves production TypeScript imports. No source
// extraction, custom TS loader or mock dependency graph is maintained here.
const built = await build({
	configFile: false,
	root,
	logLevel: "error",
	publicDir: false,
	build: {
		write: false,
		target: "esnext",
		minify: false,
		lib: { entry: resolve(root, entry), formats: ["es"], fileName: () => "diagnostic.mjs" },
		rolldownOptions: {
			makeAbsoluteExternalsRelative: false,
			external: (id) =>
				id.endsWith("/vite-build.mjs") ||
				hostExternal(id) ||
				(!id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0")),
			output: {
				codeSplitting: false,
				// The stdin entry has no file URL. Keep build helpers anchored to
				// their original module so their own import.meta.url stays valid.
				paths: (id) =>
					id.endsWith("/vite-build.mjs")
						? pathToFileURL(resolve(root, "tools/vite-build.mjs")).href
						: id,
			},
		},
	},
});
const output = (Array.isArray(built) ? built[0] : built).output;
const chunk = output.find((file) => file.type === "chunk");
if (!chunk || chunk.dynamicImports.length) throw new Error("Diagnostic must be a single module");
const child = spawn(
	process.execPath,
	["--expose-gc", "--input-type=module", "-", ...process.argv.slice(3)],
	{ cwd: root, stdio: ["pipe", "inherit", "inherit"] },
);
child.stdin.end(chunk.code);
process.exitCode = await new Promise((done, reject) => {
	child.on("error", reject);
	child.on("exit", (code) => done(code ?? 1));
});
