import assert from "node:assert/strict";
import { test } from "vitest";
import {
	visualScenarios,
	visualSnapshotNames,
	visualBaselineProblems,
	verifyVisualBaseline,
} from "../browser/visual-contracts.mjs";

const fixture = () => ({
	provenance: {
		sources: { reviewed: { report: "reviewed.json", sha256: "report-hash" } },
		screenshots: visualSnapshotNames.map((name) => ({
			name,
			sha256: `hash:${name}`,
			source: "reviewed",
		})),
	},
	hashes: new Map(visualSnapshotNames.map((name) => [name, `hash:${name}`])),
	sourceReports: new Map([
		[
			"reviewed",
			{
				sha256: "report-hash",
				screenshots: visualSnapshotNames.map((name) => ({ name, sha256: `hash:${name}` })),
			},
		],
	]),
});

test("checked-in baselines resolve to a complete hash-verified reviewed collection", async () => {
	await verifyVisualBaseline();
});

test("strict baseline covers every smoke scenario in both themes and layouts", () => {
	const { provenance, hashes, sourceReports } = fixture();
	assert.equal(visualSnapshotNames.length, visualScenarios.length * 4);
	assert.equal(new Set(visualSnapshotNames).size, visualSnapshotNames.length);
	assert.deepEqual(visualBaselineProblems(provenance, hashes, sourceReports), []);
});

test("reports every missing preset baseline before launching a comparison", () => {
	const { provenance, hashes, sourceReports } = fixture();
	const missing = visualSnapshotNames.filter((name) =>
		/-(presets|preset-editor)\.png$/.test(name),
	);
	for (const name of missing) hashes.delete(name);
	provenance.screenshots = provenance.screenshots.filter(({ name }) => !missing.includes(name));
	const problems = visualBaselineProblems(provenance, hashes, sourceReports);
	assert.equal(missing.length, 8);
	assert.equal(problems.length, 16);
	for (const name of missing) {
		assert.ok(problems.includes(`Missing baseline: ${name}`));
		assert.ok(problems.includes(`Missing provenance: ${name}`));
	}
});

test("rejects altered pixels, duplicate records and orphaned baseline assets", () => {
	const { provenance, hashes, sourceReports } = fixture();
	const name = visualSnapshotNames[0];
	hashes.set(name, "unreviewed pixels");
	provenance.screenshots.push(provenance.screenshots[0]);
	hashes.set("orphan.png", "orphan");
	provenance.screenshots.push({ name: "stale.png", sha256: "stale" });
	const problems = visualBaselineProblems(provenance, hashes, sourceReports);
	for (const problem of [
		`Duplicate provenance entry: ${name}`,
		`Provenance hash mismatch: ${name}`,
		"Unexpected baseline: orphan.png",
		"Unexpected provenance: stale.png",
		"Missing recorded file: stale.png",
	])
		assert.ok(problems.includes(problem), problem);
});

test("requires every image to resolve to preserved, hash-checked source evidence", () => {
	const { provenance, hashes, sourceReports } = fixture();
	provenance.screenshots[0].source = "missing";
	provenance.screenshots[1].sha256 = "unreviewed";
	sourceReports.get("reviewed").sha256 = "altered report";
	const problems = visualBaselineProblems(provenance, hashes, sourceReports);
	assert.ok(problems.includes(`Missing source report: ${visualSnapshotNames[0]}`));
	assert.ok(problems.includes(`Source report mismatch: ${visualSnapshotNames[1]}`));
	assert.ok(problems.includes("Source report hash mismatch: reviewed"));
});
