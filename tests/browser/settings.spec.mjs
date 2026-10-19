import { test, expect } from "@playwright/test";
import { build } from "vite";
import { resolve } from "node:path";
import { ownerVue } from "../../tools/vue-plugin.mjs";
import { root, embeddedSources } from "../../tools/vite-build.mjs";

test("production Finder settings definitions navigate, edit and clean up in a browser", async ({
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
		'<style>body{font:14px Arial;--font-interface:Arial;--font-ui-small:13px;--font-ui-medium:16px;--background-primary:white;--background-secondary:#eee;--text-normal:#222;--text-muted:#666;--background-modifier-border:#ccc;--interactive-accent:#2488db}#settings{max-width:680px;margin:auto}.setting-item{padding:12px 0}button,input,select{font:inherit}</style><div id="settings"></div>',
	);
	for (const asset of output.filter(
		(entry) => entry.type === "asset" && entry.fileName.endsWith(".css"),
	))
		await page.addStyleTag({ content: asset.source });
	await page.addScriptTag({ content: output.find((entry) => entry.type === "chunk").code });
	await page.evaluate(() => {
		window.settingsFixture = window.SettingsFixture.mountSettings(
			document.querySelector("#settings"),
		);
	});
	await page.evaluate(() => window.settingsFixture.search("collapse when dragged"));
	await page.locator('[data-target="true"] input').check();
	expect(
		(await page.evaluate(() => window.settingsFixture.state())).settings.finderAutoDock,
	).toBe(true);
	await page.evaluate(() => window.settingsFixture.search("focus border"));
	await page.locator('[data-target="true"] .nya-color-picker').click();
	await expect(page.locator(".nya-color-popover")).toBeVisible();
	await page.locator(".nya-color-value").fill("#1234");
	await page.locator(".nya-color-popover .mod-cta").click();
	expect(
		(await page.evaluate(() => window.settingsFixture.state())).settings.appearanceColors
			.focusBorder,
	).toBe("#11223344");
	await page.evaluate(() => window.settingsFixture.search("show selection outline"));
	await expect(page.locator('[data-target="true"] .nya-settings-section-body')).toBeVisible();
	await page.locator('[data-target="true"] .nya-scope-toggle input').check();
	expect(
		(await page.evaluate(() => window.settingsFixture.state())).settings.scopeAppearance.border,
	).toBe(true);
	await page.evaluate(() => window.settingsFixture.search("search toolbar"));
	await page.locator('[data-target="true"] [data-control="placement"]').first().click();
	await expect(page.locator(".nya-settings-select-popover")).toBeVisible();
	await page.evaluate(() => window.settingsFixture.destroy());
	await expect(
		page.locator(".nya-settings-select-popover, .nya-color-popover, .nya-finder-preview"),
	).toHaveCount(0);
	expect(errors).toEqual([]);
});
