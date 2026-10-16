import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/browser",
	testMatch: "*.spec.mjs",
	fullyParallel: false,
	workers: 1,
	timeout: 180000,
	outputDir: "artifacts/playwright",
	snapshotPathTemplate: "{testDir}/baselines/chromium-linux/{arg}{ext}",
	updateSnapshots: "none",
	expect: { toHaveScreenshot: { maxDiffPixels: 0, threshold: 0 } },
	use: {
		browserName: "chromium",
		headless: true,
		locale: "en-US",
		timezoneId: "UTC",
		deviceScaleFactor: 1,
		trace: "retain-on-failure",
	},
});
