import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "dist");
assert.deepEqual((await readdir(directory)).sort(), ["main.js", "manifest.json", "styles.css"]);
for (const name of ["main.js", "styles.css"]) {
	assert.ok((await readFile(resolve(directory, name))).length > 0, `${name} is empty`);
}
assert.ok(
	(await readFile(resolve(directory, "main.js"), "utf8")).includes(
		(await readFile("THIRD_PARTY_NOTICES.md", "utf8")).trimEnd(),
	),
	"main.js must carry the third-party notice",
);
assert.equal(
	await readFile(resolve(directory, "manifest.json"), "utf8"),
	await readFile("manifest.json", "utf8"),
);
console.log("Verified installable plugin assets and manifest identity");
