// Generates a standalone, self-contained browser harness in approved temp space.
import { bundleSource } from "../build/bundle-source.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { workerSource } from "./worker-experiment-source.mjs";

const directory = "/tmp/opencode/text-finder-worker-browser";
const result = await bundleSource({
	entry: "tools/diagnostics/worker-experiment-browser.mjs",
	format: "iife",
	target: "es2022",
	define: { __workerSource: JSON.stringify(workerSource("browser")) },
});
await mkdir(directory, { recursive: true });
const script = result.replaceAll("</script", "<\\/script");
await writeFile(
	`${directory}/index.html`,
	`<!doctype html><meta charset="utf-8"><title>Text Finder Worker experiment</title>
<h1>Standalone browser Worker experiment</h1>
<p>Does not modify a Vault or integrate into Obsidian. No product execution limit is defined here.</p>
<button id="safe">Run benign semantic comparisons</button>
<button id="cancel">Opt in: isolated dangerous-regex cancellation</button>
<pre>Not executed. Browser Worker availability, CSP and results must be recorded separately.</pre>
<script>${script}</script>`,
);
console.log(`${directory}/index.html`);
