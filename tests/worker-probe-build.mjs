// Independent artifact. Does not install into a Vault or alter production dist.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { workerSource } from "./worker-experiment-source.mjs";

const directory = "/tmp/opencode/text-finder-worker-probe/text-finder-worker-probe";
const source = workerSource("browser");
const experimentHash = createHash("sha256");
for (const path of ["tests/worker-probe-plugin.mjs", "tests/worker-probe-owner.mjs", "tests/worker-probe-connection.mjs",
	"tests/worker-experiment-client.mjs", "tests/worker-experiment-cases.mjs"]) {
	experimentHash.update(path); experimentHash.update(await readFile(path));
}
const buildId = { baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	workerSha256: createHash("sha256").update(source).digest("hex"),
	experimentSha256: experimentHash.digest("hex") };
const result = await build({ entryPoints: ["tests/worker-probe-plugin.mjs"], bundle: true, write: false,
	platform: "browser", format: "cjs", target: "es2022", external: ["obsidian"],
	define: { __workerSource: JSON.stringify(source), __probeBuild: JSON.stringify(buildId) } });
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/main.js`, result.outputFiles[0].text);
await writeFile(`${directory}/manifest.json`, JSON.stringify({ id: "text-finder-worker-probe", name: "Text Finder Worker Probe",
	version: "0.0.1", minAppVersion: "1.0.0", description: "Temporary read-only diagnostic; no production search integration or data persistence.",
	author: "Text Finder development", isDesktopOnly: false }, null, 2));
await writeFile(`${directory}/BUILD.json`, JSON.stringify({ ...buildId,
	mainSha256: createHash("sha256").update(result.outputFiles[0].text).digest("hex"),
	boundary: "Separate diagnostic artifact, not installed or host-verified by this build" }, null, 2));
console.log(directory);
