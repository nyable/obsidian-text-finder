import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { JSDOM } from "jsdom";
import * as librarySource from "virtual:color-picker";
import * as pickerSource from "../../src/features/settings/ui/color-picker";
vi.mock("../../src/i18n", () => ({ i18n: { t: (key) => key } }));
import { readFileSync } from "node:fs";
import { compileString } from "sass";

test("picker integration preserves the library flex layout for saturation, hue and alpha", () => {
	const css = compileString(readFileSync("src/styles/index.scss", "utf8"), {
		loadPaths: ["src/styles"],
	}).css;
	const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
		([, selector]) => selector.includes(".nya-color-library") && !selector.includes("::part"),
	);
	assert.ok(rules.length > 0, "integration size rule exists");
	for (const [, , declarations] of rules) {
		assert.doesNotMatch(
			declarations,
			/(?:^|;)\s*(?:display|flex-direction)\s*:/,
			"leave the library host flex layout intact",
		);
	}
	assert.ok(
		rules.some(
			([, , declarations]) =>
				/width:\s*100%/.test(declarations) && /height:\s*180px/.test(declarations),
		),
	);
	const dom = new JSDOM("<!doctype html><body></body>");
	try {
		const picker = librarySource.createColorPicker(dom.window.document);
		dom.window.document.body.append(picker);
		const libraryCSS = picker.shadowRoot.querySelector("style").textContent;
		assert.match(libraryCSS, /:host\{[^}]*display:flex[^}]*flex-direction:column/);
		assert.match(libraryCSS, /\[part=saturation\]\{[^}]*flex-grow:1/);
		for (const part of ["hue", "alpha"]) {
			assert.match(libraryCSS, new RegExp(`\\[part=${part}\\]\\{[^}]*flex:0 0 24px`));
		}
	} finally {
		dom.window.close();
	}
});

test("real color library supports alpha keyboard changes in each owner realm and registration survives reload", () => {
	const main = new JSDOM("<!doctype html><body></body>");
	const popup = new JSDOM("<!doctype html><body></body>");
	for (const dom of [main, popup]) {
		const picker = librarySource.createColorPicker(dom.window.document);
		dom.window.document.body.append(picker);
		picker.color = "#ff000080";
		assert.ok(picker instanceof dom.window.HTMLElement);
		assert.equal(picker.shadowRoot.querySelectorAll('[role="slider"]').length, 3);
		let color;
		picker.addEventListener("color-changed", (event) => {
			color = event.detail.value;
		});
		const alpha = picker.shadowRoot.querySelector('[part="alpha"]');
		alpha.dispatchEvent(new dom.window.KeyboardEvent("keydown", { keyCode: 36 }));
		assert.equal(color, "#ff000000");
		alpha.dispatchEvent(new dom.window.KeyboardEvent("keydown", { keyCode: 35 }));
		assert.equal(color, "#ff0000");
		const sameRegistry = librarySource.createColorPicker(dom.window.document);
		assert.equal(
			sameRegistry.constructor,
			picker.constructor,
			"existing custom element reused rather than registered twice",
		);
		picker.remove();
		dom.window.close();
	}
});

test("closing a real picker mid-drag releases only its owner-document library listeners", () => {
	const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
	const { document } = dom.window;
	const listeners = new Map();
	const add = document.addEventListener.bind(document),
		remove = document.removeEventListener.bind(document);
	vi.spyOn(document, "addEventListener").mockImplementation((type, handler, ...rest) => {
		if (["mousemove", "mouseup"].includes(type)) {
			if (!listeners.has(handler)) listeners.set(handler, new Set());
			listeners.get(handler).add(type);
		}
		return add(type, handler, ...rest);
	});
	vi.spyOn(document, "removeEventListener").mockImplementation((type, handler, ...rest) => {
		listeners.get(handler)?.delete(type);
		if (!listeners.get(handler)?.size) listeners.delete(handler);
		return remove(type, handler, ...rest);
	});
	const a = librarySource.createColorPicker(document),
		b = librarySource.createColorPicker(document);
	document.body.append(a, b);
	a.color = b.color = "#ff000080";
	const drag = (picker) => {
		const alpha = picker.shadowRoot.querySelector('[part="alpha"]');
		alpha.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20 });
		alpha.dispatchEvent(new dom.window.MouseEvent("mousedown", { clientX: 25, bubbles: true }));
	};
	drag(a);
	drag(b);
	assert.equal(listeners.size, 2);
	a.remove();
	assert.equal(listeners.size, 1);
	b.release();
	assert.equal(listeners.size, 0);
	b.remove();
	dom.window.close();
});

test("real touch drag uses nonpassive owner listeners and disconnection cancels them", () => {
	const dom = new JSDOM("<!doctype html><body></body>");
	const doc = dom.window.document,
		listeners = new Set();
	const add = doc.addEventListener.bind(doc),
		remove = doc.removeEventListener.bind(doc);
	vi.spyOn(doc, "addEventListener").mockImplementation((type, handler, options) => {
		if (type === "touchmove" || type === "touchend") {
			assert.equal(options.passive, false);
			listeners.add(type);
		}
		return add(type, handler, options);
	});
	vi.spyOn(doc, "removeEventListener").mockImplementation((type, handler, ...rest) => {
		listeners.delete(type);
		return remove(type, handler, ...rest);
	});
	const picker = librarySource.createColorPicker(doc);
	doc.body.append(picker);
	picker.color = "#ff000080";
	const alpha = picker.shadowRoot.querySelector('[part="alpha"]');
	alpha.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20 });
	const start = new dom.window.Event("touchstart", { bubbles: true, cancelable: true });
	Object.defineProperty(start, "touches", { value: [{ pageX: 25, pageY: 0 }] });
	alpha.dispatchEvent(start);
	assert.equal(listeners.size, 2);
	picker.remove();
	assert.equal(listeners.size, 0);
	dom.window.close();
});

test("picker shell traps Tab, cancels drafts on owner blur/pagehide/scroll and removes listeners", () => {
	const dom = new JSDOM(
		'<!doctype html><body><button id="trigger"></button><div id="scroller"></div></body>',
		{ pretendToBeVisual: true },
	);
	const doc = dom.window.document,
		trigger = doc.querySelector("#trigger");
	let saves = 0,
		previews = [];
	const frames = new Map();
	let next = 0;
	vi.spyOn(dom.window, "requestAnimationFrame").mockImplementation((fn) => {
		frames.set(++next, fn);
		return next;
	});
	vi.spyOn(dom.window, "cancelAnimationFrame").mockImplementation((id) => frames.delete(id));
	for (const reason of ["blur", "pagehide", "scroll", "cancel"]) {
		const close = pickerSource.openColorPicker({
			trigger,
			color: "#12345680",
			name: "Color",
			preview: (color) => previews.push(color),
			apply: () => saves++,
		});
		const panel = doc.querySelector(".nya-color-popover");
		assert.equal(
			panel.hasAttribute("aria-label"),
			false,
			"dialog container does not create an Obsidian hover label",
		);
		const title = doc.getElementById(panel.getAttribute("aria-labelledby"));
		assert.equal(title.textContent, "Color");
		assert.equal(panel.querySelector("input").getAttribute("aria-labelledby"), title.id);
		assert.equal(
			panel.querySelector("input").hasAttribute("aria-label"),
			false,
			"input keeps its hex hint instead of a duplicate name tooltip",
		);
		const picker = panel.querySelector(".nya-color-library");
		assert.equal(picker.shadowRoot.activeElement.getAttribute("part"), "saturation");
		panel.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
		);
		assert.equal(doc.activeElement, panel.querySelector(".mod-cta"));
		const input = panel.querySelector("input");
		input.value = "#abcdef44";
		input.dispatchEvent(new dom.window.Event("input"));
		assert.equal(frames.size, 1);
		if (reason === "blur" || reason === "pagehide")
			dom.window.dispatchEvent(new dom.window.Event(reason));
		if (reason === "scroll")
			doc.querySelector("#scroller").dispatchEvent(new dom.window.Event("scroll"));
		if (reason === "cancel") panel.querySelector("button:not(.mod-cta)").click();
		close();
		assert.equal(frames.size, 0);
		assert.equal(doc.querySelector(".nya-color-popover"), null);
		assert.equal(previews.at(-1), null);
		assert.equal(saves, 0);
		picker.dispatchEvent(
			new dom.window.CustomEvent("color-changed", { detail: { value: "#ff000080" } }),
		);
		input.dispatchEvent(new dom.window.Event("input"));
		panel.querySelector(".mod-cta").click();
		assert.equal(frames.size, 0);
		assert.equal(saves, 0, "late detached events cannot stage or save");
	}
	dom.window.close();
});
