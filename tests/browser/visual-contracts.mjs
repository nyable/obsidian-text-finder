import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Smoke and strict comparison must enumerate the same product states.
export const visualScenarios = [
	"empty",
	"find",
	"no-results",
	"replace",
	"docked",
	"preview",
	"history",
	"detail",
	"presets",
	"preset-editor",
];

export const visualSnapshotNames = [false, true].flatMap((mobile) =>
	[false, true].flatMap((dark) =>
		visualScenarios.map(
			(scenario) =>
				`${mobile ? "mobile-layout" : "desktop"}-${dark ? "dark" : "light"}-${scenario}.png`,
		),
	),
);

export function visualBaselineProblems(provenance, actualHashes, sourceReports) {
	const expected = new Set(visualSnapshotNames);
	const recorded = new Map();
	const problems = [];
	for (const { name, sha256, source } of provenance.screenshots) {
		if (recorded.has(name)) problems.push(`Duplicate provenance entry: ${name}`);
		recorded.set(name, sha256);
		const report = sourceReports.get(source);
		if (!report || !provenance.sources[source]) problems.push(`Missing source report: ${name}`);
		else if (report.screenshots.find((entry) => entry.name === name)?.sha256 !== sha256)
			problems.push(`Source report mismatch: ${name}`);
	}
	for (const [source, { sha256 }] of Object.entries(provenance.sources)) {
		if (sourceReports.get(source)?.sha256 !== sha256)
			problems.push(`Source report hash mismatch: ${source}`);
	}
	for (const name of expected) {
		if (!actualHashes.has(name)) problems.push(`Missing baseline: ${name}`);
		if (!recorded.has(name)) problems.push(`Missing provenance: ${name}`);
	}
	for (const [name, hash] of actualHashes) {
		if (!expected.has(name)) problems.push(`Unexpected baseline: ${name}`);
		if (recorded.get(name) !== hash) problems.push(`Provenance hash mismatch: ${name}`);
	}
	for (const name of recorded.keys()) {
		if (!expected.has(name)) problems.push(`Unexpected provenance: ${name}`);
		if (!actualHashes.has(name) && !expected.has(name))
			problems.push(`Missing recorded file: ${name}`);
	}
	return problems;
}

export async function verifyVisualBaseline(
	directory = fileURLToPath(new URL("./baselines/chromium-linux/", import.meta.url)),
) {
	const provenance = JSON.parse(await readFile(resolve(directory, "provenance.json"), "utf8"));
	const sourceReports = new Map(
		await Promise.all(
			Object.entries(provenance.sources).map(async ([source, { report }]) => {
				const bytes = await readFile(resolve(directory, report));
				return [
					source,
					{
						...JSON.parse(bytes.toString()),
						sha256: createHash("sha256").update(bytes).digest("hex"),
					},
				];
			}),
		),
	);
	const files = (await readdir(directory)).filter((name) => name.endsWith(".png"));
	const hashes = new Map(
		await Promise.all(
			files.map(async (name) => [
				name,
				createHash("sha256")
					.update(await readFile(resolve(directory, name)))
					.digest("hex"),
			]),
		),
	);
	assert.deepEqual(
		visualBaselineProblems(provenance, hashes, sourceReports),
		[],
		"Visual baseline is incomplete or unreviewed; review images and provenance, never auto-accept output",
	);
}
