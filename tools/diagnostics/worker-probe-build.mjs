// Independent artifact. Does not install into a Vault or alter production dist.
import { bundleSource } from "../build/bundle-source.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { workerSource } from "./worker-experiment-source.mjs";

const directory = "/tmp/opencode/text-finder-worker-probe/text-finder-worker-probe";
const source = workerSource("browser");
const experimentHash = createHash("sha256");
for (const path of [
	"tools/diagnostics/worker-probe-plugin.mjs",
	"tools/diagnostics/worker-probe-owner.mjs",
	"tools/diagnostics/worker-probe-connection.mjs",
	"tools/diagnostics/worker-experiment-client.mjs",
	"tools/diagnostics/worker-experiment-cases.mjs",
]) {
	experimentHash.update(path);
	experimentHash.update(await readFile(path));
}
const buildId = {
	baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	workerSha256: createHash("sha256").update(source).digest("hex"),
	experimentSha256: experimentHash.digest("hex"),
};
const result = await bundleSource({
	entry: "tools/diagnostics/worker-probe-plugin.mjs",
	target: "es2022",
	external: ["obsidian"],
	define: { __workerSource: JSON.stringify(source), __probeBuild: JSON.stringify(buildId) },
});
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/main.js`, result);
await writeFile(
	`${directory}/manifest.json`,
	JSON.stringify(
		{
			id: "text-finder-worker-probe",
			name: "Text Finder Worker Probe",
			version: "0.0.1",
			minAppVersion: "1.0.0",
			description:
				"Temporary read-only diagnostic; no production search integration or data persistence.",
			author: "Text Finder development",
			isDesktopOnly: false,
		},
		null,
		2,
	),
);
await writeFile(
	`${directory}/BUILD.json`,
	JSON.stringify(
		{
			...buildId,
			mainSha256: createHash("sha256").update(result).digest("hex"),
			boundary: "Separate diagnostic artifact, not installed or host-verified by this build",
		},
		null,
		2,
	),
);
console.log(directory);
