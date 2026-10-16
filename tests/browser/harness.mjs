import assert from "node:assert/strict";
import { build } from "vite";
import vuePlugin from "@vitejs/plugin-vue";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { root, embeddedSources } from "../../tools/vite-build.mjs";

export async function runBrowserChecks(browser, { capture } = {}) {
	const artifacts = resolve(process.env.TEXT_FINDER_ARTIFACTS ?? "artifacts/browser");
	await mkdir(artifacts, { recursive: true });
	const visualResult = await build({
		configFile: false,
		root,
		publicDir: false,
		logLevel: "error",
		define: {
			"process.env.NODE_ENV": JSON.stringify("production"),
			__VUE_OPTIONS_API__: "false",
			__VUE_PROD_DEVTOOLS__: "false",
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
		},
		build: {
			write: false,
			target: "es2022",
			minify: false,
			cssMinify: "lightningcss",
			lib: {
				entry: fileURLToPath(new URL("./visual.ts", import.meta.url)),
				formats: ["es"],
				fileName: () => "baseline.js",
				cssFileName: "styles",
			},
			rolldownOptions: { output: { codeSplitting: false } },
		},
		plugins: [
			{
				name: "simulated-obsidian",
				resolveId(id) {
					if (id === "obsidian")
						return fileURLToPath(new URL("./host-stub.mjs", import.meta.url));
				},
			},
			vuePlugin(),
		],
	});
	const visual = Array.isArray(visualResult) ? visualResult[0] : visualResult;
	const productionResult = await build({
		configFile: false,
		root,
		publicDir: false,
		logLevel: "error",
		define: {
			"process.env.NODE_ENV": JSON.stringify("production"),
			__VUE_OPTIONS_API__: "false",
			__VUE_PROD_DEVTOOLS__: "false",
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
		},
		plugins: [
			{
				name: "browser-host",
				resolveId(id) {
					if (id === "obsidian")
						return fileURLToPath(new URL("./host-stub.mjs", import.meta.url));
				},
			},
			vuePlugin(),
			embeddedSources(),
		],
		build: {
			write: false,
			target: "es2018",
			minify: true,
			lib: {
				entry: fileURLToPath(new URL("./production.ts", import.meta.url)),
				formats: ["cjs"],
				fileName: () => "production.js",
			},
			rolldownOptions: { output: { codeSplitting: false } },
		},
	});
	const production = (Array.isArray(productionResult) ? productionResult[0] : productionResult)
		.output;
	const productionCode = production.find((file) => file.type === "chunk").code;
	const productionCss = production
		.filter((file) => file.type === "asset" && file.fileName.endsWith(".css"))
		.map((file) => file.source)
		.join("\n");
	const js = visual.output.find((file) => file.type === "chunk").code;
	const css = visual.output.find((file) => file.fileName.endsWith(".css")).source;
	const theme = `body{margin:0;padding:20px;font-family:Arial,sans-serif;font-size:14px;--font-interface:Arial,sans-serif;--font-text:Arial,sans-serif;--font-text-size:16px;--font-ui-small:13px;--font-ui-medium:16px;--font-semibold:600;--line-height-normal:1.5;--input-radius:4px;--interactive-accent:#2488db;--text-accent:#2488db;--text-on-accent:white;--background-modifier-hover:#8882;--background-modifier-form-field:var(--background-primary);background:var(--background-primary);color:var(--text-normal)}body{--background-primary:#fff;--background-secondary:#f1f2f3;--text-normal:#242629;--text-muted:#666;--text-faint:#888;--background-modifier-border:#ccc;--modal-border-color:#ccc}body.dark{--background-primary:#202124;--background-secondary:#2b2c30;--text-normal:#eee;--text-muted:#aaa;--text-faint:#888;--background-modifier-border:#555;--modal-border-color:#555}*{box-sizing:border-box}button,textarea{font:inherit;color:inherit;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:4px}button{padding:4px 8px}textarea{padding:2px 6px}#owner{position:relative;min-height:520px;width:100%;max-width:900px}#owner.narrow{width:300px}#owner.wide{width:600px}`;
	const server = createServer((req, res) => {
		const url = new URL(req.url, "http://localhost");
		if (url.pathname === "/baseline.js") {
			res.setHeader("Content-Type", "text/javascript");
			res.end(js);
			return;
		}
		if (url.pathname === "/production") {
			res.setHeader("Content-Type", "text/html");
			res.end(
				`<!doctype html><html><head><style>${theme}\n${productionCss}</style></head><body><div id="owner"></div><script>var module={exports:{}};var exports=module.exports;${productionCode}\nwindow.productionApi=module.exports;</script></body></html>`,
			);
			return;
		}
		res.setHeader("Content-Type", "text/html");
		res.end(
			`<!doctype html><html><head><meta charset="utf-8"><style>${theme}\n${css}</style></head><body class="${url.searchParams.get("theme") === "dark" ? "dark" : ""} ${url.searchParams.get("mobile") === "true" ? "is-mobile" : ""}"><div id="owner"></div><script type="module" src="/baseline.js"></script></body></html>`,
		);
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const base = `http://127.0.0.1:${server.address().port}`;
	const report = {
		sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf8",
		}).trim(),
		sourceDiffSha256: createHash("sha256")
			.update(execFileSync("git", ["diff", "HEAD", "--", "src"], { cwd: root }))
			.digest("hex"),
		fixtureSha256: createHash("sha256")
			.update(theme)
			.update(await readFile(new URL("./visual.ts", import.meta.url)))
			.update(await readFile(new URL("./host-stub.mjs", import.meta.url)))
			.digest("hex"),
		lockfileSha256: createHash("sha256")
			.update(await readFile(new URL("../../pnpm-lock.yaml", import.meta.url)))
			.digest("hex"),
		visualBundleSha256: createHash("sha256").update(js).update(css).digest("hex"),
		fixture: {
			font: "Arial, sans-serif",
			locale: "en-US",
			timezone: "UTC",
			deviceScaleFactor: 1,
			cssSnippets: "none",
			themes: "simulated fixed variables, not Obsidian themes",
		},
		boundary:
			"Chromium simulated host. Not Obsidian GUI, real theme, mobile, or final Finder equivalence evidence.",
		screenshots: [],
		checks: [],
	};
	try {
		report.browser = browser.version();
		const page = await browser.newPage({
			locale: "en-US",
			timezoneId: "UTC",
			deviceScaleFactor: 1,
		});
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		for (const mobile of [false, true])
			for (const dark of [false, true])
				for (const scenario of [
					"empty",
					"find",
					"no-results",
					"replace",
					"docked",
					"preview",
					"history",
					"detail",
				]) {
					await page.setViewportSize(
						mobile ? { width: 390, height: 844 } : { width: 1000, height: 760 },
					);
					await page.goto(
						`${base}/?scenario=${scenario}&theme=${dark ? "dark" : "light"}&mobile=${mobile}`,
					);
					await page.waitForFunction(() => window.baselineReady === true);
					const name = `${mobile ? "mobile-layout" : "desktop"}-${dark ? "dark" : "light"}-${scenario}.png`;
					const image = await page.screenshot({ path: `${artifacts}/${name}` });
					await capture?.(image, name);
					report.screenshots.push({
						name,
						scenario,
						mobileLayout: mobile,
						theme: dark ? "dark" : "light",
						viewport: page.viewportSize(),
						sha256: createHash("sha256").update(image).digest("hex"),
					});
					await page.evaluate(() => window.destroyBaseline());
				}
		assert.deepEqual(errors, []);
		// Compare only when a separately preserved baseline is explicitly supplied.
		// Never overwrite the old assets or silently bless the current screenshots.
		if (process.env.TEXT_FINDER_VISUAL_BASELINE) {
			const baseline = JSON.parse(
				await readFile(`${process.env.TEXT_FINDER_VISUAL_BASELINE}/REPORT.json`, "utf8"),
			);
			assert.equal(
				baseline.browser,
				report.browser,
				"use the same browser version for exact screenshots",
			);
			assert.deepEqual(baseline.fixture, report.fixture, "visual environment changed");
			const expected = new Map(baseline.screenshots.map((file) => [file.name, file.sha256]));
			assert.equal(expected.size, report.screenshots.length);
			report.visualComparison = report.screenshots.map((file) => ({
				name: file.name,
				identical: expected.get(file.name) === file.sha256,
			}));
			assert.deepEqual(
				report.visualComparison.filter((file) => !file.identical),
				[],
				"visual baseline differs",
			);
		}
		await page.goto(`${base}/production`);
		const ownerChecks = await page.evaluate(async () => {
			const { mountFixture, nextTick } = window.productionApi;
			const frame = document.createElement("iframe");
			document.body.append(frame);
			await new Promise((done) => {
				if (frame.contentDocument.readyState === "complete") done();
				else frame.onload = done;
			});
			const doc = frame.contentDocument,
				target = doc.createElement("div");
			doc.body.append(target);
			const h = mountFixture(target);
			h.finder.setVisible(true, "cat");
			await new Promise((resolve, reject) => {
				const start = performance.now();
				const check = () => {
					if (h.finder.getSearchCache().matches.length === 3) resolve();
					else if (performance.now() - start > 10000)
						reject(Error("Worker did not publish"));
					else setTimeout(check, 20);
				};
				check();
			});
			await nextTick();
			const input = target.querySelector("textarea");
			if (!(input instanceof frame.contentWindow.HTMLTextAreaElement))
				throw Error("wrong owner realm");
			input.dispatchEvent(
				new frame.contentWindow.CompositionEvent("compositionstart", { bubbles: true }),
			);
			const event = new frame.contentWindow.KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				bubbles: true,
				cancelable: true,
			});
			input.dispatchEvent(event);
			if (event.defaultPrevented) throw Error("IME Enter intercepted");
			input.dispatchEvent(
				new frame.contentWindow.CompositionEvent("compositionend", { bubbles: true }),
			);
			const replaced = await h.finder.replaceAllMatchedText("dog");
			if (replaced.navigationCompletion) await replaced.navigationCompletion;
			if (!replaced.changed || h.view.editor.getValue() !== "dog dog dog2")
				throw Error("real Worker replacement failed");
			// Adopt the live owner and force a newly-created conditional control in it.
			document.body.append(target);
			h.finder.dockFinder();
			await nextTick();
			if (!(target.querySelector(".nya-dock-expand") instanceof window.HTMLButtonElement))
				throw Error("adopted owner creation realm failed");
			h.destroy();
			if (target.querySelector(".nya-finder")) throw Error("unmount leaked Finder");
			target.remove();
			frame.remove();
			return {
				productionWorkerMatch: true,
				productionWorkerReplacement: true,
				ownerRealm: true,
				ime: true,
				adoptedOwnerCreation: true,
				unmounted: true,
			};
		});
		report.production = ownerChecks;
		report.checks.push(
			"production Finder in second realm: real Worker match/replacement, IME, live owner adoption and unmount",
		);
		assert.deepEqual(errors, []);
		report.passed = true;
		await page.close();
		return report;
	} catch (error) {
		report.passed = false;
		report.error = String(error);
		throw error;
	} finally {
		await writeFile(`${artifacts}/REPORT.json`, JSON.stringify(report, null, 2) + "\n");
		await new Promise((done) => server.close(done));
		console.log(JSON.stringify(report, null, 2));
	}
}
