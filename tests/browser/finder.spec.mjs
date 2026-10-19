import { test, expect } from "@playwright/test";
import { runBrowserChecks } from "./harness.mjs";
import { verifyVisualBaseline } from "./visual-contracts.mjs";

test("production Finder Worker, IME, owner realms, adoption and teardown", async ({ browser }) => {
	const report = await runBrowserChecks(browser);
	expect(report.passed).toBe(true);
	expect(Object.values(report.production).every(Boolean)).toBe(true);
});

test("visual contracts match the reviewed Linux Chromium baseline", async ({ browser }) => {
	expect(
		process.platform,
		"Strict visual baseline is fixed to Linux; use smoke checks on other OSes",
	).toBe("linux");
	// An explicitly authorized snapshot update must be able to create new
	// expected files. Normal runs still require reviewed pixels + provenance.
	if (!["all", "changed"].includes(test.info().config.updateSnapshots))
		await verifyVisualBaseline();
	await runBrowserChecks(browser, {
		capture: async (image, name) => {
			// Compare the exact capture used by the preserved baseline. A second
			// screenshot can land in the next caret blink phase despite stable layout.
			expect(image).toMatchSnapshot(name, { maxDiffPixels: 0, threshold: 0 });
		},
	});
});
