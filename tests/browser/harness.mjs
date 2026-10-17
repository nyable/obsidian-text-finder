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
		const assertSecondaryButton = async (button) => {
			const normal = await button.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					border: style.borderTopStyle,
					width: style.borderTopWidth,
					color: style.borderTopColor,
					background: style.backgroundColor,
					parentBackground: getComputedStyle(element.ownerDocument.body).backgroundColor,
				};
			});
			assert.equal(normal.border, "solid");
			assert.equal(normal.width, "1px");
			assert.notEqual(normal.color, "rgba(0, 0, 0, 0)");
			assert.notEqual(
				normal.background,
				normal.parentBackground,
				"secondary button blends into page",
			);
			await button.hover();
			assert.notEqual(
				await button.evaluate((element) => getComputedStyle(element).backgroundColor),
				normal.background,
				"secondary button lacks hover feedback",
			);
			await page.mouse.move(0, 0);
		};
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
					"presets",
					"preset-editor",
				]) {
					await page.setViewportSize(
						mobile ? { width: 390, height: 844 } : { width: 1000, height: 760 },
					);
					await page.goto(
						`${base}/?scenario=${scenario}&theme=${dark ? "dark" : "light"}&mobile=${mobile}`,
					);
					await page.waitForFunction(() => window.baselineReady === true);
					// The minimal theme omits this host semantic color; supply it for detail evidence.
					if (scenario === "detail")
						await page
							.locator("body")
							.evaluate((element) =>
								element.style.setProperty("--text-error", "#d64545"),
							);
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
					if (["history", "detail", "presets", "preset-editor"].includes(scenario)) {
						const layout = await page.evaluate(() => ({
							width: document.documentElement.clientWidth,
							scrollWidth: document.documentElement.scrollWidth,
							library: document
								.querySelector(".nya-library")
								.getBoundingClientRect()
								.toJSON(),
						}));
						assert.ok(
							layout.scrollWidth <= layout.width,
							`${scenario}: horizontal overflow`,
						);
						assert.ok(
							layout.library.right <= layout.width,
							`${scenario}: library exceeds viewport`,
						);
						assert.ok(
							layout.library.width <= 640,
							`${scenario}: modal width not bounded`,
						);
					}
					if (scenario === "history") {
						const row = page.locator(".nya-history-item").first();
						const metadata = await row.evaluate((element) => {
							const query = element.querySelector(".nya-history-text");
							const meta = element.querySelector(".nya-history-meta");
							const content = element.querySelector(".nya-history-content");
							const box = meta.getBoundingClientRect();
							return {
								usage: meta.querySelector(".nya-history-usage").textContent,
								expectedUsage: query.textContent.startsWith("cat\n")
									? "Uses: 3"
									: "Uses: 1",
								length: meta.querySelector(".nya-history-length").textContent,
								time: meta
									.querySelector(".nya-history-time-value")
									.innerText.trim(),
								timeRight: meta
									.querySelector(".nya-history-time-combined")
									.getBoundingClientRect().right,
								metaRight: box.right,
								labelHidden:
									getComputedStyle(meta.querySelector(".nya-library-sr"))
										.clipPath === "inset(50%)",
								timeFont: parseFloat(
									getComputedStyle(
										meta.querySelector(".nya-history-time-combined"),
									).fontSize,
								),
								queryLength: query.textContent.length,
								below: box.top >= query.getBoundingClientRect().bottom,
								font: parseFloat(getComputedStyle(meta).fontSize),
								queryFont: parseFloat(getComputedStyle(query).fontSize),
								weight: getComputedStyle(meta).fontWeight,
								withinContent:
									box.right <= content.getBoundingClientRect().right + 1 &&
									meta.scrollWidth <= meta.clientWidth + 1,
							};
						});
						assert.equal(metadata.usage, metadata.expectedUsage);
						assert.equal(metadata.length, `${metadata.queryLength} chars`);
						assert.equal(metadata.time, "fixed relative time");
						assert.ok(
							metadata.labelHidden && metadata.timeFont < metadata.font,
							"time label is visible or time font is not smaller",
						);
						assert.ok(
							Math.abs(metadata.timeRight - metadata.metaRight) <= 1,
							"time is not aligned to the content right edge",
						);
						assert.ok(
							metadata.below &&
								metadata.font < metadata.queryFont &&
								Number(metadata.weight) <= 400,
							"history metadata competes with the query",
						);
						assert.ok(
							metadata.withinContent,
							"history metadata overflows the query/action columns",
						);
						await page.mouse.move(0, 0);
						const before = await row.evaluate(
							(element) => getComputedStyle(element).backgroundColor,
						);
						for (const selector of [
							".nya-history-content",
							".nya-history-checkbox",
							".nya-history-actions button",
						]) {
							const control = row.locator(selector).first();
							await control.hover();
							assert.notEqual(
								await row.evaluate(
									(element) => getComputedStyle(element).backgroundColor,
								),
								before,
								"history row lacks hover feedback",
							);
							assert.deepEqual(
								await control.evaluate((element) => ({
									background: getComputedStyle(element).backgroundColor,
									shadow: getComputedStyle(element).boxShadow,
									cursor: getComputedStyle(element).cursor,
								})),
								{
									background: "rgba(0, 0, 0, 0)",
									shadow: "none",
									cursor: "pointer",
								},
								"history control adds a second hover layer",
							);
						}
						report.checks.push(
							"history: single row hover; quiet usage and exact length, smaller right-aligned relative time with screen-reader-only label; wrapping inside content column",
						);
					}
					if (scenario === "detail") {
						await assertSecondaryButton(
							page.getByRole("button", { name: "Back", exact: true }),
						);
						await assertSecondaryButton(
							page.getByRole("button", { name: "Copy", exact: true }),
						);
						assert.equal(
							await page
								.locator(".nya-history-detail .nya-library-actions svg")
								.count(),
							0,
						);
						const remove = page.getByRole("button", { name: "Delete", exact: true });
						assert.equal(
							await remove.getAttribute("class"),
							"mod-warning nya-library-danger",
						);
						const danger = await remove.evaluate((element) => ({
							color: getComputedStyle(element).color,
							border: getComputedStyle(element).borderTopColor,
						}));
						assert.deepEqual(danger, {
							color: "rgb(214, 69, 69)",
							border: "rgb(214, 69, 69)",
						});
						await remove.focus();
						await page.keyboard.press("Tab");
						assert.equal(
							await page
								.getByRole("button", { name: "Use query", exact: true })
								.evaluate((element) => getComputedStyle(element).outlineStyle),
							"solid",
						);
						await page.evaluate(() => window.destroyBaseline());
						await page.goto(
							`${base}/?scenario=detail&detailLong=true&theme=${dark ? "dark" : "light"}&mobile=${mobile}`,
						);
						await page.waitForFunction(() => window.baselineReady === true);
						for (const height of [mobile ? 844 : 760, 400]) {
							await page.setViewportSize({ width: mobile ? 360 : 1000, height });
							await page.waitForFunction(
								() =>
									document
										.querySelector(".nya-library")
										.style.getPropertyValue("--nya-library-viewport-height") ===
									`${window.visualViewport.height}px`,
							);
							const layout = await page.evaluate(() => {
								const body = document.querySelector(".nya-history-detail-body");
								const meta = document.querySelector(".nya-history-detail-meta");
								const footer = document.querySelector(
									".nya-history-detail .nya-library-footer",
								);
								const before = {
									meta: meta.getBoundingClientRect().toJSON(),
									footer: footer.getBoundingClientRect().toJSON(),
								};
								body.scrollTop = body.scrollHeight;
								return {
									before,
									after: {
										meta: meta.getBoundingClientRect().toJSON(),
										footer: footer.getBoundingClientRect().toJSON(),
									},
									top: body.scrollTop,
									body: body.getBoundingClientRect().toJSON(),
									outerScroll:
										document.querySelector(".nya-history-detail").scrollTop,
									overflow: getComputedStyle(body).overflowY,
								};
							});
							assert.ok(
								layout.top > 0 && layout.body.height > 0,
								"long detail query cannot scroll",
							);
							assert.deepEqual(
								layout.after,
								layout.before,
								"query scrolling moved metadata/actions",
							);
							assert.equal(layout.outerScroll, 0);
							assert.equal(layout.overflow, "auto");
							assert.ok(
								layout.before.meta.bottom <= layout.body.top &&
									layout.body.bottom <= layout.before.footer.top + 1,
								"detail regions overlap",
							);
							assert.ok(
								layout.before.meta.top >= 0 &&
									layout.before.footer.bottom <= height,
								`fixed detail regions outside ${height}px viewport: ${JSON.stringify(layout)}`,
							);
						}
						report.checks.push(
							"history detail: fixed top statistics and bottom text actions, only full query scrolls at normal and 400px viewport heights; bordered secondary and destructive delete buttons retain keyboard feedback",
						);
					}
					if (scenario === "presets") {
						assert.equal(
							await page
								.getByRole("heading", { name: "History and presets", exact: true })
								.count(),
							0,
						);
						assert.equal(
							await page
								.locator(".nya-library-browser > .nya-library-header")
								.count(),
							0,
						);
						assert.equal(
							await page
								.locator(
									".nya-preset-toolbar > .nya-library-new + .nya-library-hint",
								)
								.count(),
							1,
						);
						assert.deepEqual(
							await page
								.locator(".nya-preset-apply [data-preview-action]")
								.evaluateAll((nodes) =>
									nodes.map((node) => node.getAttribute("data-preview-action")),
								),
							["regex", "case", "wholeWord"],
						);
						assert.equal(
							await page
								.getByRole("button", { name: "New preset", exact: true })
								.count(),
							1,
						);
						const widths = await page
							.locator(".nya-preset-item")
							.first()
							.locator(".nya-recipe-value")
							.evaluateAll((values) =>
								values.map((value) => value.getBoundingClientRect().width),
							);
						assert.ok(
							widths[0] > 0 && Math.abs(widths[0] - widths[1]) < 1,
							"find and replacement preview widths differ",
						);
						const grip = page.getByRole("button", {
							name: "Reorder preset: Clean trailing whitespace",
							exact: true,
						});
						assert.equal(await grip.getAttribute("aria-label"), null);
						assert.equal(await grip.getAttribute("title"), null);
						assert.ok(
							await grip.evaluate((element) => {
								const grid = element.parentElement;
								return (
									element.getBoundingClientRect().width <=
									parseFloat(getComputedStyle(grid).gridTemplateColumns) + 1
								);
							}),
							"drag handle overlaps the preview column",
						);
						assert.equal(
							await grip.evaluate((element) => getComputedStyle(element).cursor),
							"grab",
						);
						const targets = [".nya-preset-actions button", ".nya-library-new"];
						for (const selector of targets) {
							await page.mouse.move(0, 0);
							const target = page.locator(selector).first();
							const before = await target.evaluate(
								(element) => getComputedStyle(element).backgroundColor,
							);
							await target.hover();
							const hovered = await target.evaluate((element) => ({
								background: getComputedStyle(element).backgroundColor,
								cursor: getComputedStyle(element).cursor,
							}));
							assert.equal(
								hovered.cursor,
								"pointer",
								`${selector}: missing pointer cursor`,
							);
							assert.notEqual(
								hovered.background,
								before,
								`${selector}: missing hover feedback`,
							);
						}
						await page.mouse.move(0, 0);
						const firstCard = page.locator(".nya-preset-item").first();
						const baseSurface = await firstCard.evaluate(
							(element) => getComputedStyle(element).backgroundImage,
						);
						await firstCard.locator(".nya-preset-apply").hover();
						const hoverSurface = await firstCard.evaluate((element) => {
							const button = element.querySelector(".nya-preset-apply");
							return {
								image: getComputedStyle(element).backgroundImage,
								buttonBackground: getComputedStyle(button).backgroundColor,
								buttonShadow: getComputedStyle(button).boxShadow,
								cursor: getComputedStyle(button).cursor,
							};
						});
						assert.notEqual(
							hoverSurface.image,
							baseSurface,
							"hover feedback does not cover the whole card",
						);
						assert.equal(
							hoverSurface.buttonBackground,
							"rgba(0, 0, 0, 0)",
							"inner apply hover leaves a separate colored rectangle",
						);
						assert.equal(hoverSurface.buttonShadow, "none");
						assert.equal(hoverSurface.cursor, "pointer");
						await firstCard.locator(".nya-preset-actions button").first().hover();
						assert.equal(
							await firstCard.evaluate(
								(element) => getComputedStyle(element).backgroundImage,
							),
							hoverSurface.image,
							"hovering edit loses whole-card feedback",
						);
						await page.mouse.move(0, 0);
						const tabButton = page.getByRole("tab", { name: "Presets", exact: true });
						const tabStyle = await tabButton.evaluate((element) => ({
							x: parseFloat(getComputedStyle(element).paddingLeft),
							y: parseFloat(getComputedStyle(element).paddingTop),
							radius: parseFloat(getComputedStyle(element).borderRadius),
							background: getComputedStyle(element).backgroundColor,
						}));
						assert.ok(
							tabStyle.x === 12 && tabStyle.y === 5 && tabStyle.radius === 5,
							"tabs lack hover breathing room",
						);
						await tabButton.hover();
						assert.notEqual(
							await tabButton.evaluate(
								(element) => getComputedStyle(element).backgroundColor,
							),
							tabStyle.background,
						);
						const sharedTabStyles = await page.evaluate(() => {
							// Only compare the two production style scopes here; settings DOM behavior has separate component coverage.
							const root = document.createElement("div");
							root.className = "nya-settings";
							root.innerHTML =
								'<div class="nya-settings-tabs"><button aria-selected="true">General</button></div>';
							document.body.append(root);
							const read = (element) => {
								const style = getComputedStyle(element);
								const line = getComputedStyle(element, "::after");
								return {
									padding: style.padding,
									minHeight: style.minHeight,
									lineHeight: style.lineHeight,
									radius: style.borderRadius,
									underline: {
										bottom: line.bottom,
										left: line.left,
										right: line.right,
										height: line.height,
									},
								};
							};
							const values = [
								read(root.querySelector("button")),
								read(document.querySelector(".nya-library-tabs button")),
							];
							root.remove();
							return values;
						});
						assert.deepEqual(
							sharedTabStyles[0],
							sharedTabStyles[1],
							"settings/library tab styles diverged",
						);
						const card = await page
							.locator(".nya-preset-item")
							.first()
							.evaluate((element) => {
								const box = element.getBoundingClientRect();
								const grip = element
									.querySelector(".nya-preset-grip")
									.getBoundingClientRect();
								const name = element
									.querySelector(".nya-preset-name")
									.getBoundingClientRect();
								const frame = element
									.querySelector(".nya-recipe-finder")
									.getBoundingClientRect();
								return {
									card: { top: box.top, bottom: box.bottom },
									grip: { top: grip.top, bottom: grip.bottom },
									nameBottom: name.bottom,
									frameTop: frame.top,
									emptyReplacement:
										element.querySelectorAll(".nya-recipe-text")[1]
											?.textContent,
								};
							});
						assert.ok(
							card.grip.top - card.card.top <= 2 &&
								card.card.bottom - card.grip.bottom <= 2,
							"grip does not span the full card height",
						);
						assert.ok(
							card.frameTop >= card.nameBottom,
							"Finder preview must sit below its name",
						);
						assert.equal(
							card.emptyReplacement,
							"",
							"preview injected explanatory text into an empty replacement",
						);
						assert.equal(
							await page
								.locator(".nya-library-browser > .nya-library-footer")
								.count(),
							0,
							"persistent list explanation remains",
						);
					}
					if (scenario === "preset-editor") {
						assert.deepEqual(
							await page
								.locator(".nya-recipe-form .nya-library-footer button")
								.allTextContents()
								.then((values) => values.map((value) => value.trim())),
							["Save", "Cancel", "Save as preset"],
						);
						assert.equal(
							await page.locator(".nya-recipe-form .nya-recipe-finder").count(),
							0,
						);
						const fields = page.locator(".nya-recipe-form textarea");
						for (const field of await fields.all()) {
							const initial = await field.evaluate((element) => ({
								height: element.getBoundingClientRect().height,
								rows: element.rows,
								resize: getComputedStyle(element).resize,
								font: parseFloat(getComputedStyle(element).fontSize),
								lineHeight: parseFloat(getComputedStyle(element).lineHeight),
							}));
							assert.equal(initial.rows, 4);
							assert.equal(initial.resize, "none");
							assert.ok(
								Math.abs(initial.height - (4 * initial.lineHeight + 18)) < 1,
								"textarea does not have four fixed text rows",
							);
							await field.fill(
								"  exact text\n\tsecond line\nthird\nfourth\nfifth\nsixth\nseventh\neighth\n",
							);
							const after = await field.evaluate((element) => ({
								height: element.getBoundingClientRect().height,
								scroll: element.scrollHeight > element.clientHeight,
								value: element.value,
							}));
							assert.equal(
								after.height,
								initial.height,
								"long text resized textarea",
							);
							assert.equal(after.scroll, true, "long textarea content cannot scroll");
							assert.ok(after.value.startsWith("  exact text\n\tsecond line"));
						}
						await page
							.getByRole("checkbox", {
								name: "Fold replacement row when applied",
								exact: true,
							})
							.check();
						assert.equal(
							await fields.count(),
							2,
							"fold setting hid the replacement editor",
						);
						const other = page.locator(".nya-recipe-other");
						await other.scrollIntoViewIfNeeded();
						assert.equal(
							await other.evaluate(
								(element) => element.parentElement.lastElementChild === element,
							),
							true,
						);
						assert.equal(
							await page
								.getByRole("button", { name: "Save", exact: true })
								.isVisible(),
							true,
						);
						report.checks.push(
							"preset editor: separate option/settings groups, fixed four-line textareas with exact multiline content and stable Save/Cancel/Save as preset actions",
						);
					}
					if (["history", "preset-editor"].includes(scenario)) {
						// Simulate a host theme that adds its own focus border, shadow and outline.
						const hostFocus = await page.addStyleTag({
							content:
								"input:focus, textarea:focus { border-color: red; outline: 2px solid red; box-shadow: 0 0 0 3px red; }",
						});
						const fields = page.locator(
							'.nya-library input:not([type="checkbox"]), .nya-library textarea',
						);
						for (const field of await fields.all()) {
							if (!(await field.isVisible())) continue;
							await field.focus();
							const focused = await field.evaluate((element) => {
								const style = getComputedStyle(element);
								return {
									outline: style.outlineStyle,
									border: style.borderTopColor,
									shadow: style.boxShadow,
									width: element.getBoundingClientRect().width,
								};
							});
							assert.equal(
								focused.outline,
								"none",
								"text inputs must not stack an outer focus outline",
							);
							assert.equal(
								focused.border,
								"rgba(0, 0, 0, 0)",
								"text inputs must not retain host focus borders",
							);
							assert.ok(
								focused.shadow.includes("inset") && focused.shadow.includes("1px"),
								"one inset focus edge remains visible",
							);
							assert.ok(
								!focused.shadow.includes("3px"),
								"host outer focus shadow leaked into the library",
							);
						}
						await hostFocus.evaluate((element) => element.remove());
					}
					if (!dark && !mobile && scenario === "presets") {
						const original = await page.locator(".nya-library").boundingBox();
						await page
							.getByRole("button", { name: "Edit preset", exact: true })
							.click();
						await page.getByLabel("Name", { exact: true }).fill("Renamed preset");
						const mode = page.getByRole("button", { name: "Match case", exact: true });
						await mode.focus();
						await page.keyboard.press("Space");
						assert.equal(await mode.getAttribute("aria-pressed"), "true");
						assert.equal(
							await mode.evaluate(
								(element) => element === element.ownerDocument.activeElement,
							),
							true,
						);
						assert.deepEqual(
							await page.locator(".nya-library").boundingBox(),
							original,
							"editor changed modal geometry",
						);
						await page.getByRole("button", { name: "Save", exact: true }).click();
						assert.equal(
							await page.getByText("Renamed preset", { exact: true }).count(),
							1,
						);
						assert.equal(
							await page
								.locator(".nya-preset-item [data-preview-action].nya-btn--active")
								.count(),
							2,
						);
						await page.getByRole("button", { name: "Delete", exact: true }).click();
						assert.equal(
							await page.getByText("Renamed preset", { exact: true }).count(),
							0,
						);
						await page.getByRole("button", { name: "Undo", exact: true }).click();
						assert.equal(
							await page.getByText("Renamed preset", { exact: true }).count(),
							1,
						);
						report.checks.push(
							"search library: real browser edit/update, delete/undo and responsive width",
						);
					}
					if (!dark && scenario === "history") {
						const geometry = () =>
							page.evaluate(() => {
								const box = (selector) => {
									const r = document
										.querySelector(selector)
										.getBoundingClientRect();
									return { x: r.x, y: r.y, width: r.width, height: r.height };
								};
								return {
									shell: box(".nya-library"),
									filter: box(".nya-library-filter"),
									list: box(".nya-library-content"),
								};
							});
						const original = await geometry();
						assert.equal(original.shell.height, 560);
						assert.equal(
							await page
								.getByRole("button", { name: "New preset", exact: true })
								.count(),
							0,
						);
						await page.getByRole("checkbox").first().click();
						assert.deepEqual(await geometry(), original, "selection moved content");
						await page.getByRole("tab", { name: "Presets", exact: true }).click();
						assert.equal(
							await page
								.getByRole("button", { name: "New preset", exact: true })
								.count(),
							1,
						);
						assert.deepEqual(await geometry(), original, "tab switch moved content");
						await page.getByRole("searchbox").fill("not found");
						assert.deepEqual(await geometry(), original, "empty results shrank modal");
						await page
							.getByRole("tab", { name: "Search History", exact: true })
							.click();
						assert.equal(
							await page.getByRole("checkbox", { checked: true }).count(),
							0,
							"tab switch retained selections",
						);
						assert.equal(
							await page
								.getByRole("button", { name: "New preset", exact: true })
								.count(),
							0,
						);
						await page
							.getByRole("button", { name: "Details", exact: true })
							.first()
							.click();
						assert.deepEqual(
							await page.locator(".nya-library").boundingBox(),
							original.shell,
							"details changed modal size",
						);
						await page.getByRole("button", { name: "Back", exact: true }).click();
						await page
							.getByRole("button", { name: "Delete", exact: true })
							.first()
							.click();
						assert.deepEqual(await geometry(), original, "undo notice moved content");
						await page.evaluate(() => window.destroyBaseline());
						await page.goto(`${base}/?scenario=history&stress=true&mobile=${mobile}`);
						await page.waitForFunction(() => window.baselineReady === true);
						const scroll = await page.evaluate(() => {
							const list = document.querySelector(".nya-library-content");
							const before = document
								.querySelector(".nya-library-filter")
								.getBoundingClientRect().y;
							list.scrollTop = 200;
							return {
								top: list.scrollTop,
								before,
								after: document
									.querySelector(".nya-library-filter")
									.getBoundingClientRect().y,
							};
						});
						assert.ok(scroll.top > 0, "long list does not scroll");
						assert.equal(scroll.before, scroll.after, "list scrolling moved filter");
						report.checks.push(
							"search library: stable shell/filter/list across tabs, empty results, selection and undo; no persistent footer, long list scrolls independently",
						);
					}
					if (scenario === "preset-editor")
						await assertSecondaryButton(
							page.getByRole("button", { name: "Cancel", exact: true }),
						);
					if (!dark && mobile && scenario === "preset-editor") {
						await page.setViewportSize({ width: 360, height: 400 });
						await page
							.getByRole("button", { name: "Save", exact: true })
							.scrollIntoViewIfNeeded();
						const visible = await page
							.getByRole("button", { name: "Save", exact: true })
							.boundingBox();
						assert.ok(
							visible && visible.y >= 0 && visible.y + visible.height <= 400,
							"save action unreachable with low viewport",
						);
						report.checks.push(
							"search library: save action reachable in 360x400 viewport",
						);
					}
					if (!dark && scenario === "presets") {
						await page.evaluate(() => window.destroyBaseline());
						await page.goto(
							`${base}/?scenario=presets&multiline=true&mobile=${mobile}`,
						);
						await page.waitForFunction(() => window.baselineReady === true);
						const multiline = page.locator(".nya-preset-item").nth(1);
						await multiline.scrollIntoViewIfNeeded();
						assert.deepEqual(
							await multiline
								.locator(".nya-recipe-lines")
								.allTextContents()
								.then((values) => values.map((value) => value.trim())),
							["4 lines", "2 lines"],
						);
						const previews = await multiline
							.locator(".nya-recipe-value")
							.evaluateAll((values) =>
								values.map((value) => {
									const text = value.querySelector(".nya-recipe-text");
									return {
										width: value.getBoundingClientRect().width,
										height: text.getBoundingClientRect().height,
										valueHeight: value.getBoundingClientRect().height,
										lineHeight: parseFloat(getComputedStyle(text).lineHeight),
										text: text.textContent,
										fullText:
											value.querySelector(".nya-library-sr").textContent,
										countRight: value
											.querySelector(".nya-recipe-lines")
											.getBoundingClientRect().right,
										textRight: text.getBoundingClientRect().right,
										countTop: value
											.querySelector(".nya-recipe-lines")
											.getBoundingClientRect().top,
										textTop: text.getBoundingClientRect().top,
									};
								}),
							);
						assert.ok(
							Math.abs(previews[0].width - previews[1].width) < 1,
							"multiline preview widths differ",
						);
						assert.ok(
							previews.every(
								(value) =>
									value.height <= value.lineHeight + 1 &&
									value.valueHeight === 28 &&
									value.countRight > value.textRight &&
									Math.abs(value.countTop - value.textTop) <= 4,
							),
							"multiline preview must stay single-line with its count on the right",
						);
						assert.equal(previews[0].text, "TODO");
						assert.equal(previews[0].fullText, "TODO\n待办\n待处理\n");
						assert.equal(
							await multiline.locator("[aria-label], [title]").count(),
							2,
							"preview/handle adds unwanted tooltip attributes",
						);
						await page.locator(".nya-library-content").evaluate((element) => {
							element.scrollTop = 0;
						});
						await page.screenshot({
							path: `${artifacts}/${mobile ? "mobile-layout" : "desktop"}-light-presets-multiline.png`,
						});
						report.checks.push(
							"preset list: no title row, inset tab hover, inline new/count toolbar, whole-card hover, equal single-line values with right-aligned line counts, only three saved match modes and accessible tooltip-free handles",
						);
						await multiline
							.getByRole("button", { name: "Edit preset", exact: true })
							.click();
						await page
							.getByRole("button", { name: "Save as preset", exact: true })
							.click();
						const copyName = page.getByRole("textbox", {
							name: "New preset name",
							exact: true,
						});
						assert.equal(await copyName.inputValue(), "Multiline task labels");
						assert.equal(
							await copyName.evaluate(
								(element) =>
									element.selectionStart === 0 &&
									element.selectionEnd === element.value.length &&
									element === element.ownerDocument.activeElement,
							),
							true,
						);
						assert.equal(
							await page
								.getByRole("button", { name: "Create preset", exact: true })
								.isDisabled(),
							true,
						);
						await copyName.fill(" Clean trailing whitespace ");
						await assertSecondaryButton(
							page.getByRole("button", { name: "Back to editing", exact: true }),
						);
						assert.equal(await copyName.getAttribute("aria-invalid"), "true");
						await page.screenshot({
							path: `${artifacts}/${mobile ? "mobile-layout" : "desktop"}-light-preset-copy-name.png`,
						});
						await page
							.getByRole("button", { name: "Back to editing", exact: true })
							.click();
						assert.equal(
							await page
								.getByRole("textbox", { name: "Find", exact: true })
								.inputValue(),
							"TODO\n待办\n待处理\n",
						);
						await page
							.getByRole("button", { name: "Save as preset", exact: true })
							.click();
						await page
							.getByRole("textbox", { name: "New preset name", exact: true })
							.fill("Task labels copy");
						await page
							.getByRole("textbox", { name: "New preset name", exact: true })
							.press("Enter");
						assert.equal(await page.locator(".nya-preset-item").count(), 3);
						assert.deepEqual(await page.locator(".nya-preset-name").allTextContents(), [
							"Clean trailing whitespace",
							"Multiline task labels",
							"Task labels copy",
						]);
						report.checks.push(
							"preset names: inline save-as naming, selected input/focus, duplicate-name rejection, draft-preserving return and native Enter creates one uniquely named copy; shared compact tab geometry",
						);
						await page.evaluate(() => window.destroyBaseline());
						await page.goto(
							`${base}/?scenario=presets&presetStress=true&mobile=${mobile}`,
						);
						await page.waitForFunction(() => window.baselineReady === true);
						const ids = () =>
							page
								.locator("[data-preset-id]")
								.evaluateAll((cards) =>
									cards.map((card) => card.getAttribute("data-preset-id")),
								);
						const original = await ids();
						const first = page.locator(".nya-preset-grip").first();
						await first.focus();
						await page.keyboard.press("ArrowDown");
						assert.deepEqual((await ids()).slice(0, 2), [original[1], original[0]]);
						assert.equal(
							await page
								.locator(`[data-preset-id="${original[0]}"] .nya-preset-grip`)
								.evaluate((el) => el === el.ownerDocument.activeElement),
							true,
						);
						// Simulate touch pointer events in the same real browser DOM; this
						// exercises the shared pointer path, not native mobile gesture support.
						await page.evaluate(() => {
							const handle = document.querySelector(".nya-preset-grip");
							const target = document
								.querySelectorAll("[data-preset-id]")[2]
								.getBoundingClientRect();
							const box = handle.getBoundingClientRect();
							// Synthetic pointers have no browser capture ownership.
							handle.setPointerCapture = () => {};
							handle.dispatchEvent(
								new PointerEvent("pointerdown", {
									pointerId: 51,
									pointerType: "touch",
									button: 0,
									clientX: box.x + 8,
									clientY: box.y + 8,
									bubbles: true,
									cancelable: true,
								}),
							);
							document.dispatchEvent(
								new PointerEvent("pointermove", {
									pointerId: 51,
									pointerType: "touch",
									clientX: box.x + 8,
									clientY: target.bottom - 3,
									bubbles: true,
									cancelable: true,
								}),
							);
							document.dispatchEvent(
								new PointerEvent("pointerup", {
									pointerId: 51,
									pointerType: "touch",
									clientX: box.x + 8,
									clientY: target.bottom - 3,
									bubbles: true,
								}),
							);
						});
						assert.deepEqual((await ids()).slice(0, 3), [
							original[0],
							original[2],
							original[1],
						]);
						const grip = page.locator(".nya-preset-grip").first();
						const start = await grip.boundingBox();
						await page.mouse.move(start.x + 10, start.y + 10);
						await page.mouse.down();
						const secondBox = await page
							.locator("[data-preset-id]")
							.nth(1)
							.boundingBox();
						await page.mouse.move(
							secondBox.x + 15,
							secondBox.y + secondBox.height - 3,
							{ steps: 8 },
						);
						await page.mouse.up();
						assert.deepEqual((await ids()).slice(0, 3), [
							original[2],
							original[0],
							original[1],
						]);
						const after = await ids();
						const cancelStart = await page
							.locator(".nya-preset-grip")
							.first()
							.boundingBox();
						await page.mouse.move(cancelStart.x + 10, cancelStart.y + 10);
						await page.mouse.down();
						await page.mouse.move(cancelStart.x + 10, cancelStart.y + 90, { steps: 5 });
						await page.keyboard.press("Escape");
						await page.mouse.up();
						assert.deepEqual(await ids(), after, "Escape committed a drag");
						await page.getByRole("searchbox").fill("Rule");
						assert.equal(await page.locator(".nya-preset-grip:enabled").count(), 0);
						await page.getByRole("searchbox").fill("");
						// Edge dragging must scroll a long list without moving the filter.
						await page
							.locator(".nya-library-content")
							.evaluate((el) => (el.scrollTop = 0));
						const autoStart = await page
							.locator(".nya-preset-grip")
							.first()
							.boundingBox();
						const listBox = await page.locator(".nya-library-content").boundingBox();
						await page.mouse.move(autoStart.x + 10, autoStart.y + 10);
						await page.mouse.down();
						await page.mouse.move(autoStart.x + 10, listBox.y + listBox.height - 4, {
							steps: 8,
						});
						await page.waitForFunction(
							() => document.querySelector(".nya-library-content").scrollTop > 20,
						);
						await page.keyboard.press("Escape");
						await page.mouse.up();
						report.checks.push(
							"preset cards: mouse/touch-pointer/keyboard reorder, focus retention, Escape cancellation, filtered disable and edge autoscroll",
						);
					}
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
