import { test, expect } from "@playwright/test";
import { build } from "vite";
import { resolve } from "node:path";
import { root } from "../../tools/vite-build.mjs";

test("production Finder reading contours bound offscreen geometry in a large mounted block", async ({
	page,
}) => {
	const result = await build({
		configFile: false,
		root,
		logLevel: "error",
		build: {
			write: false,
			lib: {
				entry: resolve(root, "tests/browser/reading.ts"),
				formats: ["iife"],
				name: "ReadingFixture",
			},
			rolldownOptions: { output: { codeSplitting: false } },
		},
	});
	const output = (Array.isArray(result) ? result[0] : result).output;
	await page.setContent(
		'<style>body{margin:0}#root{height:400px;width:500px;overflow:auto;--nya-scope-border-width:1px}pre{margin:0;font:16px/20px monospace}.nya-reading-overlay{position:fixed}.nya-scope-outline{position:absolute;overflow:visible;width:1px;height:1px}</style><div id="root"><pre></pre></div>',
	);
	await page.addScriptTag({ content: output.find((entry) => entry.type === "chunk").code });
	const report = await page.evaluate(() => {
		const root = document.querySelector("#root"),
			pre = root.querySelector("pre");
		pre.textContent = "line of text\n".repeat(20000);
		const original = pre.textContent;
		const index = window.ReadingFixture.indexReadingText([root]);
		const scopes = [{ from: 0, to: index.text.length }];
		const overlay = new window.ReadingFixture.ReadingOverlay(root, () => {});
		const originalBounds = Range.prototype.getBoundingClientRect;
		let measurements = 0;
		Range.prototype.getBoundingClientRect = function () {
			measurements++;
			return originalBounds.call(this);
		};
		const paints = [];
		for (const scroll of [0, 200000, 399000]) {
			root.scrollTop = scroll;
			const start = performance.now();
			measurements = 0;
			overlay.paint(index, scopes, [], 0);
			const path = document.querySelector(".nya-scope-outline path").getAttribute("d");
			paints.push({
				ms: Math.round(performance.now() - start),
				segments: (path.match(/M/g) ?? []).length,
				measurements,
			});
		}
		const newlineMatches = index.breaks
			.filter((br) => br.kind === "text")
			.map((br, i) => ({ from: br.from, to: br.from + 1, index: i }));
		measurements = 0;
		overlay.paint(index, [], newlineMatches, 0);
		const newline = {
			count: newlineMatches.length,
			glyphs: document.querySelectorAll(".nya-newline-match").length,
			measurements,
		};
		const result = {
			paints,
			newline,
			scopeLength: scopes[0].to,
			unchanged: pre.textContent === original,
		};
		overlay.destroy();
		Range.prototype.getBoundingClientRect = originalBounds;
		return { ...result, released: !document.querySelector(".nya-reading-overlay") };
	});
	expect(report.scopeLength).toBeGreaterThan(200000);
	expect(report.unchanged).toBe(true);
	expect(report.released).toBe(true);
	expect(report.newline.count).toBe(20000);
	expect(report.newline.glyphs).toBeGreaterThan(0);
	expect(report.newline.glyphs).toBeLessThan(50);
	expect(report.newline.measurements).toBeLessThan(400);
	// Structural work bound, not a machine-dependent timing threshold.
	for (const paint of report.paints) {
		expect(paint.segments).toBeLessThan(200);
		expect(paint.measurements).toBeLessThan(400);
	}
	console.log("Reading contour geometry:", JSON.stringify(report));
});
