import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { JSDOM } from "jsdom";
import { createSettingsSelect } from "../../src/features/settings/ui/settings-select";
vi.mock("obsidian", () => ({
	setIcon: (node, name) => {
		node.dataset.icon = name;
	},
}));
function fixture(options = {}) {
	const dom = new JSDOM(
		'<!doctype html><body><div id="container"></div><button id="next">Next</button></body>',
		{ pretendToBeVisual: true },
	);
	const doc = dom.window.document,
		win = dom.window,
		container = doc.querySelector("#container"),
		changes = [];
	let valid = true;
	const control = createSettingsSelect({
		container,
		name: "Placement for regex",
		value: "inline",
		items: [
			{ value: "inline", label: "Inline" },
			{ value: "more", label: "More" },
			{ value: "hidden", label: "Hidden" },
		],
		valid: () => valid,
		beforeOpen: () => {},
		change: (value) => changes.push(value),
		...options,
	});
	const key = (value, extra = {}) => {
		const event = new win.KeyboardEvent("keydown", {
			key: value,
			bubbles: true,
			cancelable: true,
			...extra,
		});
		control.trigger.dispatchEvent(event);
		return event;
	};
	return {
		dom,
		doc,
		win,
		container,
		control,
		changes,
		key,
		invalidate: () => {
			valid = false;
		},
		popup: () => doc.querySelector(".nya-settings-select-popover"),
		finish: () => {
			control.destroy();
			dom.window.close();
		},
	};
}

test("settings select opens in owner document with referenced names, selected check and single explicit commit", () => {
	const f = fixture(),
		{ control, doc, changes } = f;
	assert.equal(control.trigger.dataset.value, "inline");
	assert.equal(control.trigger.getAttribute("aria-expanded"), "false");
	control.trigger.click();
	const popup = f.popup();
	assert.equal(popup.parentElement, doc.body);
	assert.equal(popup.ownerDocument, doc);
	assert.equal(popup.hasAttribute("aria-label"), false);
	assert.equal(doc.getElementById(popup.getAttribute("aria-labelledby")), control.trigger);
	assert.equal(doc.getElementById(control.trigger.getAttribute("aria-controls")), popup);
	assert.equal(popup.querySelector('[aria-selected="true"]').dataset.value, "inline");
	assert.equal(
		popup.querySelector('[aria-selected="true"] .nya-settings-select-check').dataset.icon,
		"check",
	);
	assert.equal(doc.activeElement, control.trigger);
	assert.deepEqual(changes, []);
	const old = popup.querySelector('[data-value="more"]');
	old.click();
	old.click();
	assert.deepEqual(changes, ["more"]);
	assert.equal(f.popup(), null);
	assert.equal(control.trigger.dataset.value, "more");
	control.trigger.click();
	old.click();
	assert.deepEqual(changes, ["more"], "old popup events cannot choose in a new popup");
	f.popup().querySelector('[data-value="more"]').click();
	assert.deepEqual(changes, ["more"], "reselect is not a write");
	f.finish();
});

test("settings select keyboard navigation is provisional, Escape cancels and Tab exits without a trap", () => {
	const f = fixture();
	f.key("Enter");
	f.key("ArrowDown");
	assert.equal(f.popup().querySelector('[data-highlighted="true"]').dataset.value, "more");
	assert.equal(f.popup().querySelector('[aria-selected="true"]').dataset.value, "inline");
	assert.deepEqual(f.changes, []);
	f.key("Escape");
	assert.equal(f.popup(), null);
	assert.deepEqual(f.changes, []);
	f.key(" ");
	f.key("End");
	f.key("Home");
	f.key("ArrowUp");
	f.key("Enter");
	assert.deepEqual(f.changes, ["hidden"]);
	f.key("ArrowDown");
	assert.equal(f.popup().querySelector('[data-highlighted="true"]').dataset.value, "hidden");
	assert.equal(f.key("Tab").defaultPrevented, false);
	assert.equal(f.popup(), null);
	assert.deepEqual(f.changes, ["hidden"]);
	f.key("End");
	assert.equal(f.popup().querySelector('[data-highlighted="true"]').dataset.value, "hidden");
	f.key("Escape");
	f.key("Enter", { isComposing: true });
	assert.equal(f.popup(), null);
	f.key("Home");
	f.key(" ");
	assert.deepEqual(f.changes, ["hidden", "inline"]);
	f.finish();
});

test("settings select dismisses on outside pointer, focus, scroll and owner window exits with no lingering listeners", () => {
	const f = fixture(),
		listeners = new Set();
	// Warm jsdom's style selector engine: its own lazy mouseover/mouseout
	// listeners are unrelated to this control's popup resource ownership.
	f.win.getComputedStyle(f.control.trigger);
	for (const target of [f.doc, f.win]) {
		const add = target.addEventListener.bind(target),
			remove = target.removeEventListener.bind(target);
		vi.spyOn(target, "addEventListener").mockImplementation((type, handler, ...args) => {
			listeners.add(handler);
			return add(type, handler, ...args);
		});
		vi.spyOn(target, "removeEventListener").mockImplementation((type, handler, ...args) => {
			listeners.delete(handler);
			return remove(type, handler, ...args);
		});
	}
	for (const reason of [
		"outside",
		"focus",
		"scroll",
		"blur",
		"resize",
		"pagehide",
		"close",
		"destroy",
	]) {
		f.control.trigger.click();
		assert.ok(f.popup());
		if (reason === "outside")
			f.doc.body.dispatchEvent(new f.win.Event("pointerdown", { bubbles: true }));
		if (reason === "focus") f.doc.querySelector("#next").focus();
		if (reason === "scroll") {
			f.popup().dispatchEvent(new f.win.Event("scroll"));
			assert.ok(f.popup(), "list scrolling stays open");
			f.container.dispatchEvent(new f.win.Event("scroll"));
		}
		if (["blur", "resize", "pagehide"].includes(reason))
			f.win.dispatchEvent(new f.win.Event(reason));
		if (reason === "close") {
			f.control.close();
			f.control.close();
		}
		if (reason === "destroy") f.control.destroy();
		assert.equal(f.popup(), null);
		assert.equal(listeners.size, 0);
		assert.equal(f.control.trigger.hasAttribute("aria-activedescendant"), false);
		assert.equal(f.control.trigger.hasAttribute("aria-controls"), false);
	}
	f.control.trigger.click();
	assert.equal(f.popup(), null);
	assert.deepEqual(f.changes, []);
	f.finish();
});

test("settings select guards hidden, detached and stale controls, and uses unique IDs across instances", () => {
	const f = fixture();
	f.container.hidden = true;
	f.control.trigger.click();
	assert.equal(f.popup(), null);
	f.container.hidden = false;
	f.control.trigger.click();
	const old = f.popup().querySelector('[data-value="more"]');
	f.invalidate();
	old.click();
	assert.deepEqual(f.changes, []);
	assert.equal(f.popup(), null);
	f.control.trigger.click();
	assert.equal(f.popup(), null);
	const other = fixture();
	assert.notEqual(other.control.trigger.id, f.control.trigger.id);
	other.container.remove();
	other.control.trigger.click();
	assert.equal(other.popup(), null);
	f.finish();
	other.finish();
});

test("settings select flips above a low trigger and clamps against the right viewport edge", () => {
	const f = fixture();
	Object.defineProperty(f.win, "innerWidth", { value: 320 });
	Object.defineProperty(f.win, "innerHeight", { value: 240 });
	f.control.trigger.getBoundingClientRect = () => ({
		left: 290,
		top: 200,
		bottom: 228,
		width: 96,
	});
	vi.spyOn(f.win.HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(96);
	vi.spyOn(f.win.HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(104);
	f.control.trigger.click();
	assert.equal(f.popup().style.width, "96px");
	assert.equal(f.popup().style.left, "216px");
	assert.equal(f.popup().style.top, "90px");
	assert.equal(f.popup().style.maxHeight, "186px");
	f.finish();
});

test("settings select supports sm/md independently of content/fill width and defaults to sm/content", () => {
	const defaults = fixture();
	assert.equal(defaults.control.trigger.dataset.size, "sm");
	assert.equal(defaults.control.trigger.dataset.width, "content");
	defaults.finish();
	for (const size of ["sm", "md"])
		for (const width of ["content", "fill"]) {
			const f = fixture({ size, width });
			assert.equal(f.control.trigger.dataset.size, size);
			assert.equal(f.control.trigger.dataset.width, width);
			f.control.trigger.getBoundingClientRect = () => ({
				left: 20,
				top: 50,
				bottom: 82,
				width: width === "fill" ? 260 : 112,
			});
			f.control.trigger.click();
			assert.equal(f.popup().dataset.size, size);
			assert.equal(
				f.popup().style.width,
				width === "fill" ? "260px" : "112px",
				"popup follows measured trigger, not a size-specific width",
			);
			assert.deepEqual(f.changes, []);
			f.finish();
		}
});

test("settings select sizes from every option without accessible duplicates or changing width on selection", () => {
	const f = fixture({
		items: [
			{ value: "inline", label: "短" },
			{ value: "more", label: "A much longer translated option" },
			{ value: "hidden", label: "隐藏" },
		],
	});
	const sizing = f.control.trigger.querySelector(".nya-settings-select-sizing");
	assert.equal(sizing.getAttribute("aria-hidden"), "true");
	assert.equal(sizing.hasAttribute("aria-label"), false);
	assert.deepEqual(
		[...sizing.children].map((node) => node.textContent),
		["短", "A much longer translated option", "隐藏"],
	);
	f.control.trigger.click();
	f.popup().querySelector('[data-value="more"]').click();
	assert.equal(
		f.control.trigger.querySelector(".nya-settings-select-value").textContent,
		"A much longer translated option",
	);
	assert.equal(
		f.control.trigger.querySelector(".nya-settings-select-sizing"),
		sizing,
		"all-option intrinsic sizing stays intact",
	);
	f.finish();
});

test("settings select portaled list resolves the trigger typography and size tokens again after a theme change", () => {
	const f = fixture(),
		trigger = f.control.trigger;
	const properties = {
		"font-family": "Example Interface",
		"font-size": "15px",
		"font-weight": "500",
		"font-style": "italic",
		"font-variant": "small-caps",
		"letter-spacing": "0.2px",
		"line-height": "21px",
		"--nya-select-padding-inline": "12px",
		"--nya-select-height": "32px",
		"--nya-select-option-height": "36px",
		"--nya-select-icon-size": "16px",
		"--nya-select-gap": "8px",
	};
	for (const [name, value] of Object.entries(properties)) trigger.style.setProperty(name, value);
	trigger.click();
	const computed = f.win.getComputedStyle(trigger);
	for (const name of Object.keys(properties))
		assert.equal(f.popup().style.getPropertyValue(name), computed.getPropertyValue(name), name);
	f.control.close();
	trigger.style.fontSize = "17px";
	trigger.style.setProperty("--nya-select-padding-inline", "14px");
	trigger.click();
	assert.equal(f.popup().style.fontSize, "17px");
	assert.equal(f.popup().style.getPropertyValue("--nya-select-padding-inline"), "14px");
	f.finish();
});

test("settings select limits an oversized trigger width only at the viewport boundary", () => {
	const f = fixture({ width: "fill" });
	Object.defineProperty(f.win, "innerWidth", { value: 200 });
	f.control.trigger.getBoundingClientRect = () => ({ left: 8, top: 30, bottom: 62, width: 300 });
	f.control.trigger.click();
	assert.equal(f.popup().style.width, "184px");
	f.finish();
});

test("settings select navigation reveals options by scrolling only its own list", () => {
	const f = fixture();
	f.control.trigger.click();
	const panel = f.popup();
	Object.defineProperty(panel, "clientHeight", { value: 40 });
	[...panel.children].forEach((row, index) => {
		Object.defineProperty(row, "offsetTop", { value: index * 32 });
		Object.defineProperty(row, "offsetHeight", { value: 32 });
		row.scrollIntoView = () => {
			throw new Error("must not scroll ancestor documents");
		};
	});
	f.key("End");
	assert.equal(panel.scrollTop, 56);
	f.key("Home");
	assert.equal(panel.scrollTop, 0);
	panel.children[2].dispatchEvent(new f.win.Event("pointermove"));
	assert.equal(panel.scrollTop, 0, "hover never changes scroll");
	assert.deepEqual(f.changes, []);
	f.finish();
});
