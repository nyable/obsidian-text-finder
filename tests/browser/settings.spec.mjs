import { test, expect } from "@playwright/test";
import { build } from "vite";
import { resolve } from "node:path";
import { ownerVue } from "../../tools/vue-plugin.mjs";
import { root, embeddedSources } from "../../tools/vite-build.mjs";
import { assertCompactTabOverflow } from "./compact-tabs.mjs";

test("production Finder five-tab settings stay consistent across host versions and clean up in a browser", async ({
	page,
}) => {
	const result = await build({
		configFile: false,
		root,
		logLevel: "error",
		resolve: { alias: { obsidian: resolve(root, "tests/browser/settings-host.mjs") } },
		plugins: [ownerVue(), embeddedSources()],
		define: {
			"process.env.NODE_ENV": JSON.stringify("production"),
			__VUE_OPTIONS_API__: "false",
			__VUE_PROD_DEVTOOLS__: "false",
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
		},
		build: {
			write: false,
			lib: {
				entry: resolve(root, "tests/browser/settings.ts"),
				formats: ["iife"],
				name: "SettingsFixture",
			},
			rolldownOptions: { output: { codeSplitting: false } },
		},
	});
	const output = (Array.isArray(result) ? result[0] : result).output;
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setContent(
		'<style>body{font:14px Arial;--font-interface:Arial;--font-ui-small:13px;--font-ui-medium:16px;--background-primary:white;--background-secondary:#eee;--text-normal:#222;--text-muted:#666;--background-modifier-border:#ccc;--interactive-accent:#2488db}#settings{max-width:680px;height:520px;margin:auto}.setting-item{padding:12px 0}button,input,select{font:inherit}</style><div id="settings"></div>',
	);
	for (const asset of output.filter(
		(entry) => entry.type === "asset" && entry.fileName.endsWith(".css"),
	))
		await page.addStyleTag({ content: asset.source });
	await page.addScriptTag({ content: output.find((entry) => entry.type === "chunk").code });
	for (const modern of [false, true]) {
		await page.evaluate((modern) => {
			window.settingsFixture = window.SettingsFixture.mountSettings(
				document.querySelector("#settings"),
				modern,
			);
		}, modern);
		await expect(page.getByRole("tab")).toHaveText([
			"General",
			"Find",
			"Replace",
			"Search history",
			"Appearance",
		]);
		await expect(page.getByRole("tab", { selected: true })).toHaveText("General");
		await assertCompactTabOverflow(page.locator(".nya-settings-tabs"));
		await page
			.locator(".setting-item")
			.filter({ hasText: "Collapse when dragged" })
			.locator("input")
			.check();
		expect(
			(await page.evaluate(() => window.settingsFixture.state())).settings.finderAutoDock,
		).toBe(true);
		await page.getByRole("tab", { name: "Appearance", exact: true }).click();
		await assertCompactTabOverflow(page.locator(".nya-settings-tabs"));
		await expect(
			page.locator('.nya-settings-section-toggle[aria-expanded="false"]'),
		).toHaveCount(4);
		await page.locator('[data-section="colors"] .nya-settings-section-toggle').click();
		await page.locator('[data-color="focusBorder"] .nya-color-picker').click();
		await expect(page.locator(".nya-color-popover")).toBeVisible();
		await page.locator(".nya-color-value").fill("#1234");
		await page.locator(".nya-color-popover .mod-cta").click();
		expect(
			(await page.evaluate(() => window.settingsFixture.state())).settings.appearanceColors
				.focusBorder,
		).toBe("#11223344");
		await page.locator('[data-section="scope"] .nya-settings-section-toggle').click();
		await page.locator(".nya-scope-toggle input").check();
		expect(
			(await page.evaluate(() => window.settingsFixture.state())).settings.scopeAppearance
				.border,
		).toBe(true);
		await page.locator('[data-section="search"] .nya-settings-section-toggle').click();
		const previewTop = await page
			.locator(".nya-appearance-preview")
			.evaluate((el) => el.getBoundingClientRect().top);
		await page.locator(".nya-appearance-controls").evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		expect(
			await page.locator(".nya-appearance-controls").evaluate((el) => el.scrollTop),
		).toBeGreaterThan(0);
		expect(
			await page
				.locator(".nya-appearance-preview")
				.evaluate((el) => el.getBoundingClientRect().top),
		).toBe(previewTop);
		const placement = page
			.locator('[data-section="search"] [data-control="placement"]')
			.first();
		await placement.scrollIntoViewIfNeeded();
		// Let the scroll event finish before opening a popup that closes on scroll.
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		await placement.click();
		await expect(page.locator(".nya-settings-select-popover")).toBeVisible();
		await page.getByRole("tab", { name: "Find", exact: true }).click();
		await expect(page.locator(".nya-settings-select-popover, .nya-finder-preview")).toHaveCount(
			0,
		);
		await page.getByRole("tab", { name: "Appearance", exact: true }).click();
		await placement.scrollIntoViewIfNeeded();
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		await placement.click();
		await expect(page.locator(".nya-settings-select-popover")).toBeVisible();
		await page.evaluate(() => window.settingsFixture.destroy());
		await expect(
			page.locator(".nya-settings-select-popover, .nya-color-popover, .nya-finder-preview"),
		).toHaveCount(0);
	}
	expect(errors).toEqual([]);
});
