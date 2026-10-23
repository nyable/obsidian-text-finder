import { test, expect } from "@playwright/test";
import { build } from "vite";
import { resolve } from "node:path";
import { ownerVue } from "../../tools/vue-plugin.mjs";
import { root, embeddedSources } from "../../tools/vite-build.mjs";

test("production Finder desktop handle press does not scroll or jump after command focus", async ({
	page,
}) => {
	const result = await build({
		configFile: false,
		root,
		logLevel: "error",
		resolve: { alias: { obsidian: resolve(root, "tests/browser/host-stub.mjs") } },
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
				entry: resolve(root, "tests/browser/production.ts"),
				formats: ["iife"],
				name: "FinderFixture",
			},
			rolldownOptions: { output: { codeSplitting: false } },
		},
	});
	const output = (Array.isArray(result) ? result[0] : result).output;
	await page.setContent(`<style>
		body{margin:0;font:14px Arial;--nya-default-width:448px;--nya-focus-border-color:#2488db;--interactive-accent:#8060dd;--nya-dragger-color:#888;--font-interface:Arial;--font-ui-small:13px;--font-ui-medium:16px;--background-primary:white;--text-normal:#222;--text-muted:#666;--background-modifier-border:#ccc;--modal-border-color:#ccc}
		*{box-sizing:border-box}textarea{border:1px solid #ccc}
		#shell{width:850px;height:420px;overflow:auto;margin:60px 20px}
		#owner{position:relative;height:700px;overflow:auto}
		#content{height:1600px}
	</style><button id="keyboard-entry" style="position:fixed;top:0;left:0">Keyboard entry</button><div id="shell"><div id="owner"><div id="content"></div></div></div>`);
	for (const asset of output.filter(
		(entry) => entry.type === "asset" && entry.fileName.endsWith(".css"),
	))
		await page.addStyleTag({ content: asset.source });
	await page.addScriptTag({ content: output.find((entry) => entry.type === "chunk").code });
	await page.evaluate(() => {
		window.h = window.FinderFixture.mountFixture(document.querySelector("#owner"));
		window.pressDefaults = [];
		document.addEventListener("pointerdown", (event) => {
			if (event.target.closest(".nya-drag-handle"))
				window.pressDefaults.push(event.defaultPrevented);
		});
		window.h.finder.setVisible(true, "cat");
	});
	await page.waitForTimeout(1100);
	const snapshot = () =>
		page.evaluate(() => {
			const node = document.querySelector(".nya-finder"),
				handle = document.querySelector(".nya-drag-handle");
			const box = node.getBoundingClientRect(),
				grip = handle.getBoundingClientRect();
			return {
				x: box.x,
				y: box.y,
				width: box.width,
				height: box.height,
				handle: { x: grip.x, y: grip.y, width: grip.width, height: grip.height },
				translate: node.style.translate,
				rootScroll: node.scrollTop,
				ownerScroll: document.querySelector("#owner").scrollTop,
				shellScroll: document.querySelector("#shell").scrollTop,
				focus: document.activeElement.className,
				focusVisible: handle.matches(":focus-visible"),
				outline: getComputedStyle(handle).outlineStyle,
				shadow: getComputedStyle(handle).boxShadow,
			};
		});
	for (const scenario of [
		"normal",
		"immediate",
		"hidden owner",
		"scrolled owner",
		"scrolled ancestor",
		"expanded",
		"clipped handle",
	]) {
		await page.evaluate((scenario) => {
			const owner = document.querySelector("#owner"),
				shell = document.querySelector("#shell");
			shell.scrollTop = 0;
			owner.scrollTop = 0;
			shell.style.height = scenario === "clipped handle" ? "120px" : "420px";
			owner.style.overflow = scenario === "hidden owner" ? "hidden" : "auto";
			window.h.finder.setCollapse(!["expanded", "clipped handle"].includes(scenario));
			window.h.finder.setVisible(true, "cat");
			if (scenario === "scrolled owner") owner.scrollTop = 50;
			if (scenario === "scrolled ancestor") shell.scrollTop = 50;
		}, scenario);
		if (scenario !== "immediate") await page.waitForTimeout(1100);
		const before = await snapshot();
		expect(before.focus).toBe("nya-input");
		await page.mouse.move(before.handle.x + 1, before.handle.y + 10);
		await page.mouse.down();
		const pressed = await snapshot();
		expect(await page.evaluate(() => window.pressDefaults.at(-1)), scenario).toBe(true);
		expect(pressed.focus, scenario).toBe("nya-input");
		expect(pressed.focusVisible, scenario).toBe(false);
		expect(pressed.outline, scenario).toBe("none");
		expect(pressed.shadow, scenario).toBe("none");
		expect(pressed.y, scenario).toBeCloseTo(before.y, 1);
		expect(pressed.x, scenario).toBeCloseTo(before.x, 1);
		expect(pressed.ownerScroll, scenario).toBe(before.ownerScroll);
		expect(pressed.shellScroll, scenario).toBe(before.shellScroll);
		expect(pressed.rootScroll, scenario).toBe(before.rootScroll);
		await page.mouse.up();
		const released = await snapshot();
		expect(released.y, scenario).toBeCloseTo(before.y, 1);
		if (scenario === "normal" || scenario === "expanded") {
			await page.mouse.down();
			await page.mouse.move(before.handle.x + 21, before.handle.y + 28, { steps: 3 });
			await expect.poll(async () => (await snapshot()).y).toBeCloseTo(before.y + 18, 1);
			await page.keyboard.press("Escape");
			await page.mouse.up();
			expect((await snapshot()).y).toBeCloseTo(before.y, 1);
			// Keyboard entry is separate from pointer dragging and retains its visible ring.
			await page.locator("#keyboard-entry").focus();
			await page.keyboard.press("Tab");
			await expect(page.locator(".nya-drag-handle")).toBeFocused();
			expect((await snapshot()).focusVisible).toBe(true);
			expect((await snapshot()).outline).toBe("solid");
			await page.keyboard.press("ArrowDown");
			expect((await snapshot()).y).toBeCloseTo(before.y + 8, 1);
			await page.keyboard.press("Home");
		}
	}
	for (const collapsed of [true, false]) {
		await page.evaluate((collapsed) => {
			document.querySelector("#shell").style.height = "420px";
			window.h.finder.setCollapse(collapsed);
			window.h.finder.setVisible(true, "cat");
		}, collapsed);
		const initial = await snapshot();
		await page.mouse.move(initial.handle.x + 1, initial.handle.y + 10);
		await page.mouse.down();
		await page.mouse.move(initial.handle.x + 21, initial.handle.y + 28, { steps: 3 });
		await page.mouse.up();
		expect((await snapshot()).y).toBeCloseTo(initial.y + 18, 1);
		const saved = await snapshot();
		for (let cycle = 0; cycle < 2; cycle++) {
			await page.evaluate(() => window.h.finder.setVisible(false));
			await page.waitForTimeout(350);
			await page.evaluate(() => window.h.finder.setVisible(true, "cat"));
			await page.waitForTimeout(1100);
			const opened = await snapshot();
			expect(opened.y, `reopen ${cycle}, collapsed=${collapsed}`).toBeCloseTo(saved.y, 1);
			await page.mouse.move(opened.handle.x + 1, opened.handle.y + 10);
			await page.mouse.down();
			const pressed = await snapshot();
			expect(pressed.y).toBeCloseTo(opened.y, 1);
			expect(pressed.translate).toBe(opened.translate);
			expect(pressed.focus).toBe("nya-input");
			expect(pressed.focusVisible).toBe(false);
			expect(pressed.outline).toBe("none");
			await page.mouse.move(opened.handle.x + 2, opened.handle.y + 11);
			await page.mouse.up();
			const released = await snapshot();
			expect(released.y).toBeCloseTo(opened.y, 1);
			expect(released.translate).toBe(opened.translate);
			expect(released.ownerScroll).toBe(opened.ownerScroll);
			expect(released.shellScroll).toBe(opened.shellScroll);
		}
		await page.locator(".nya-drag-handle").focus();
		await page.keyboard.press("Home");
	}
	await page.evaluate(() => {
		document.querySelector("#shell").style.height = "420px";
		window.h.finder.dockFinder();
	});
	await page.locator(".nya-dock-expand").click();
	await expect(page.locator(".nya-finder--docked")).toHaveCount(0);
	await expect(page.locator(".nya-drag-handle")).toBeFocused();
	await page.evaluate(() => window.h.destroy());
});
