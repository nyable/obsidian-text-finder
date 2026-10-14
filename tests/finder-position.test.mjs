import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";

const { createFinderPosition } = loadSource("../src/finder-position.ts");
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
function environment(t) {
	const dom = new JSDOM("<!doctype html><body><div><section></section></div></body>");
	const { document: doc } = dom.window, owner = doc.querySelector("div"), node = doc.querySelector("section");
	let ownerBox = rect(100, 60, 700, 600), base = rect(300, 148, 448, 38);
	const viewport = new dom.window.EventTarget(); Object.assign(viewport, { offsetLeft: 0, offsetTop: 0, width: 1024, height: 768 });
	Object.defineProperty(dom.window, "visualViewport", { value: viewport });
	owner.getBoundingClientRect = () => ownerBox;
	node.getBoundingClientRect = () => {
		const [x = 0, y = 0] = (node.style.translate || "0px 0px").split(" ").map(parseFloat);
		return rect(base.left + x, base.top + y, base.width, base.height);
	};
	const position = createFinderPosition(node, owner);
	const update = (extra = {}) => position.update({ visible: true, docked: false, side: "right", toolsHeight: 32, ...extra });
	const pointer = (target, type, x, y, extra = {}) => {
		const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, ...extra });
		if (type === "pointerdown") position.start(event); else target.dispatchEvent(event);
		return event;
	};
	t.after(() => { position.destroy(); dom.window.close(); });
	return { doc, win: dom.window, owner, node, position, update, viewport, pointer,
		setOwner: (value) => { ownerBox = value; }, setBase: (value) => { base = value; } };
}

test("session placement clamps movement to the owner and visual viewport and restores CSS position", (t) => {
	const h = environment(t); h.update();
	assert.deepEqual(h.node.getBoundingClientRect(), rect(300, 148, 448, 38));
	h.position.moveBy(10000, 10000);
	assert.deepEqual(h.node.getBoundingClientRect(), rect(344, 614, 448, 38));
	h.position.moveBy(-10000, -10000);
	assert.deepEqual(h.node.getBoundingClientRect(), rect(108, 100, 448, 38));
	h.position.reset(); assert.deepEqual(h.node.getBoundingClientRect(), rect(300, 148, 448, 38));
	Object.assign(h.viewport, { offsetTop: 100, height: 250 }); h.viewport.dispatchEvent(new h.win.Event("resize"));
	h.position.moveBy(0, 1000); assert.equal(h.node.getBoundingClientRect().bottom, 342);
	h.setOwner(rect(100, 60, 260, 600)); h.setBase(rect(100, 148, 244, 38)); h.win.dispatchEvent(new h.win.Event("resize"));
	assert.equal(h.node.style.getPropertyValue("--nya-available-width"), "244px");
	assert.ok(h.node.getBoundingClientRect().left >= 108);
});

test("docking uses owner edges and expansion follows the marker height and viewport", (t) => {
	const h = environment(t); h.update(); h.position.moveBy(-80, 100);
	h.setBase(rect(300, 148, 88, 44)); h.update({ docked: true });
	assert.equal(h.node.getBoundingClientRect().right, 792); assert.equal(h.node.getBoundingClientRect().top, 248);
	h.update({ docked: true, side: "left" }); assert.equal(h.node.getBoundingClientRect().left, 108);
	Object.assign(h.viewport, { offsetLeft: 140, offsetTop: 300, width: 420, height: 220 }); h.viewport.dispatchEvent(new h.win.Event("scroll"));
	assert.equal(h.node.getBoundingClientRect().left, 148); assert.equal(h.node.getBoundingClientRect().top, 308);
	Object.assign(h.viewport, { offsetLeft: 0, offsetTop: 0, width: 1024, height: 768 });
	h.setBase(rect(300, 148, 448, 38)); h.update();
	assert.equal(h.node.getBoundingClientRect().top, 308); assert.ok(h.node.getBoundingClientRect().left >= 108);
});

test("automatic compact positioning waits for measurable layout and follows safe viewport edges", (t) => {
	for (const side of ["left", "right"]) {
		const h = environment(t); h.setOwner(rect(0, 0, 0, 0)); h.setBase(rect(180, 88, 40, 40));
		h.update({ docked: true, side, autoDock: false }); assert.equal(h.node.style.translate, "");
		h.setOwner(rect(0, 0, 400, 650));
		h.setBase(rect(0, 0, 0, 0)); h.win.dispatchEvent(new h.win.Event("resize"));
		assert.equal(h.node.style.translate, "", "unrendered compact node is not positioned as a zero-width icon");
		h.setBase(rect(180, 88, 40, 40)); h.win.dispatchEvent(new h.win.Event("resize"));
		assert.equal(side === "right" ? h.node.getBoundingClientRect().right : h.node.getBoundingClientRect().left, side === "right" ? 392 : 8);
		const safe = h.doc.querySelector('[aria-hidden="true"]'); safe.style.padding = "10px 18px 20px 12px";
		Object.assign(h.viewport, { offsetLeft: 20, offsetTop: 30, width: 340, height: 500 });
		h.viewport.dispatchEvent(new h.win.Event("resize"));
		assert.equal(side === "right" ? h.node.getBoundingClientRect().right : h.node.getBoundingClientRect().left, side === "right" ? 334 : 40);
		h.position.moveBy(side === "right" ? -100 : 100, 40);
		const parked = h.node.getBoundingClientRect();
		h.update({ docked: true, side }); assert.deepEqual(h.node.getBoundingClientRect(), parked);
		h.setOwner(rect(0, 0, 0, 0)); h.win.dispatchEvent(new h.win.Event("resize"));
		h.setOwner(rect(0, 0, 400, 650)); h.win.dispatchEvent(new h.win.Event("resize"));
		assert.deepEqual(h.node.getBoundingClientRect(), parked, "background visibility changes preserve manual marker intent");
	}
});

test("direct drag isolates pointers and rolls back on cancel/Escape/blur/hide", (t) => {
	const h = environment(t); h.update();
	h.pointer(h.node, "pointerdown", 300, 148); h.pointer(h.doc, "pointermove", 302, 149);
	assert.equal(h.node.classList.contains("nya-finder--dragging"), false);
	h.pointer(h.doc, "pointermove", 240, 200, { pointerId: 2 }); assert.equal(h.node.getBoundingClientRect().left, 300);
	h.pointer(h.doc, "pointermove", 240, 200); assert.equal(h.node.classList.contains("nya-finder--dragging"), true);
	h.pointer(h.doc, "pointercancel", 240, 200, { pointerId: 2 }); assert.equal(h.node.classList.contains("nya-finder--dragging"), true);
	h.pointer(h.doc, "pointerup", 240, 200); assert.deepEqual(h.node.getBoundingClientRect(), rect(240, 200, 448, 38));
	for (const kind of ["pointercancel", "escape", "blur", "pagehide", "hide"]) {
		h.pointer(h.node, "pointerdown", 240, 200); h.pointer(h.doc, "pointermove", 160, 280);
		if (kind === "escape") {
			const event = new h.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); h.node.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
		} else if (kind === "blur" || kind === "pagehide") h.win.dispatchEvent(new h.win.Event(kind));
		else if (kind === "hide") h.update({ visible: false });
		else h.pointer(h.doc, kind, 160, 280);
		h.update(); assert.deepEqual(h.node.getBoundingClientRect(), rect(240, 200, 448, 38));
		h.pointer(h.doc, "pointermove", 400, 400); assert.equal(h.node.getBoundingClientRect().left, 240);
	}
	h.position.destroy(); assert.equal(h.node.style.translate, "");
	assert.equal(h.doc.querySelector('[aria-hidden="true"]'), null);
});

test("position destroy removes document/window/viewport listeners and active drag resources", (t) => {
	const h = environment(t), registrations = new Map();
	for (const target of [h.doc, h.win, h.viewport]) {
		const active = new Set(); registrations.set(target, active);
		const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
		const tracked = ["resize", "scroll", "pointermove", "pointerup", "pointercancel", "keydown", "blur", "pagehide"];
		t.mock.method(target, "addEventListener", (type, fn, options) => { if (tracked.includes(type)) active.add(fn); return add(type, fn, options); });
		t.mock.method(target, "removeEventListener", (type, fn, options) => { if (tracked.includes(type)) active.delete(fn); return remove(type, fn, options); });
	}
	const controller = createFinderPosition(h.node, h.owner);
	controller.update({ visible: true, docked: false, side: "right", toolsHeight: 32 });
	const event = new h.win.Event("pointerdown"); Object.assign(event, { clientX: 0, clientY: 0, pointerId: 1, button: 0, isPrimary: true });
	controller.start(event); assert.ok(registrations.get(h.doc).size > 0);
	controller.destroy(); controller.destroy();
	for (const active of registrations.values()) assert.equal(active.size, 0);
});

test("direct drag begins after 3px without waiting; a stationary press remains a click", (t) => {
	const h = environment(t); h.update({ autoDock: true });
	h.pointer(h.node, "pointerdown", 300, 148); h.pointer(h.doc, "pointerup", 300, 148);
	assert.equal(h.node.classList.contains("nya-finder--dragging"), false);
	h.pointer(h.node, "pointerdown", 300, 148); h.pointer(h.doc, "pointermove", 280, 148);
	assert.equal(h.node.classList.contains("nya-finder--dragging"), true);
	assert.equal(h.node.getBoundingClientRect().left, 280);
	h.pointer(h.doc, "pointerup", 280, 148); assert.equal(h.node.classList.contains("nya-finder--dragging"), false);
});

test("optional held-click suppression leaves short taps and keyboard activation intact and expires", (t) => {
	const h = environment(t); h.update();
	let now = 0; t.mock.method(h.win.performance, "now", () => now);
	const timers = new Map(); let serial = 0;
	t.mock.method(h.win, "setTimeout", (fn) => { timers.set(++serial, fn); return serial; });
	t.mock.method(h.win, "clearTimeout", (id) => timers.delete(id));
	const click = (detail = 1) => {
		const event = new h.win.MouseEvent("click", { detail, cancelable: true });
		Object.defineProperty(event, "target", { value: h.node }); return h.position.consumeClick(event);
	};
	const start = (enabled) => {
		const event = new h.win.Event("pointerdown");
		Object.assign(event, { clientX: 300, clientY: 148, button: 0, pointerId: 1, isPrimary: true });
		Object.defineProperty(event, "target", { value: h.node }); h.position.start(event, enabled);
	};
	start(true); now += 100; h.pointer(h.doc, "pointerup", 300, 148); assert.equal(click(), false);
	start(true); now += 600; h.pointer(h.doc, "pointerup", 300, 148);
	assert.equal(click(0), false); assert.equal(click(), true); assert.equal(click(), false);
	start(false); now += 600; h.pointer(h.doc, "pointerup", 300, 148); assert.equal(click(), false, "desktop held press is unchanged");
	start(true); now += 600; h.pointer(h.doc, "pointercancel", 300, 148); assert.equal(click(), true);
	start(true); now += 600; h.pointer(h.doc, "pointerup", 300, 148);
	assert.equal(timers.size, 1); const expire = [...timers.values()][0]; timers.clear(); expire(); assert.equal(click(), false);
	start(true); now += 600; h.pointer(h.doc, "pointerup", 300, 148);
	h.position.destroy(); assert.equal(timers.size, 0);
});

test("mobile pointer ownership captures on down and bypasses ancestor swipe handlers even without capture", (t) => {
	for (const captureMode of ["available", "throws", "missing"]) {
		const h = environment(t); h.setBase(rect(300, 148, 40, 40)); h.update({ docked: true });
		let captured = false, captures = 0, releases = 0, hostMoves = 0;
		if (captureMode !== "missing") {
			h.node.setPointerCapture = () => { captures++; if (captureMode === "throws") throw new Error("capture unavailable"); captured = true; };
			h.node.hasPointerCapture = () => captured;
			h.node.releasePointerCapture = () => { captured = false; releases++; };
		}
		h.node.addEventListener("pointerdown", (event) => h.position.start(event, true));
		for (const type of ["pointerdown", "pointermove", "pointerup"]) h.owner.addEventListener(type, (event) => { hostMoves++; event.stopPropagation(); });
		const send = (target, type, x, extra = {}) => {
			const event = new h.win.Event(type, { bubbles: true, cancelable: true });
			Object.assign(event, { button: 0, isPrimary: true, pointerId: 1, pointerType: "touch", clientX: x, clientY: 148, ...extra });
			target.dispatchEvent(event); return event;
		};
		const down = send(h.node, "pointerdown", 780);
		assert.equal(down.defaultPrevented, false); assert.equal(captured, captureMode === "available");
		assert.equal(captures, captureMode === "missing" ? 0 : 1);
		const smallMove = send(h.node, "pointermove", 779);
		assert.equal(smallMove.defaultPrevented, true); assert.equal(h.node.classList.contains("nya-finder--dragging"), false);
		send(h.node, "pointermove", 740); assert.equal(h.node.getBoundingClientRect().left, 712);
		const up = send(h.node, "pointerup", 720); assert.equal(up.defaultPrevented, false);
		assert.equal(h.node.getBoundingClientRect().left, 692); assert.equal(hostMoves, 0);
		assert.equal(releases, captureMode === "available" ? 1 : 0);
		send(h.node, "pointerdown", 720); send(h.node, "pointermove", 680); send(h.node, "pointercancel", 680);
		assert.equal(h.node.getBoundingClientRect().left, 692, "genuine cancellation rolls back");
		send(h.node, "pointermove", 600); assert.equal(hostMoves, 1, "after cleanup normal events reach host again");
	}
});

test("mobile capture-phase listeners and early pointer capture are released on every teardown path", (t) => {
	for (const action of ["hide", "reset", "destroy", "blur", "pagehide", "lostcapture"]) {
		const h = environment(t); h.update();
		const listeners = new Map();
		const add = h.doc.addEventListener.bind(h.doc), remove = h.doc.removeEventListener.bind(h.doc);
		t.mock.method(h.doc, "addEventListener", (type, fn, options) => {
			if (type.startsWith("pointer")) listeners.set(fn, typeof options === "boolean" ? options : options?.capture ?? false);
			return add(type, fn, options);
		});
		t.mock.method(h.doc, "removeEventListener", (type, fn, options) => {
			if (listeners.has(fn)) {
				assert.equal(typeof options === "boolean" ? options : options?.capture ?? false, listeners.get(fn)); listeners.delete(fn);
			}
			return remove(type, fn, options);
		});
		let captured = false;
		h.node.setPointerCapture = () => { captured = true; };
		h.node.hasPointerCapture = () => captured;
		h.node.releasePointerCapture = () => { captured = false; };
		const down = new h.win.Event("pointerdown");
		Object.assign(down, { button: 0, pointerId: 1, clientX: 300, clientY: 148 });
		Object.defineProperty(down, "target", { value: h.node }); h.position.start(down, true);
		assert.equal(captured, true); assert.deepEqual([...listeners.values()], [true, true, true]);
		if (action === "hide") h.update({ visible: false });
		else if (action === "reset") h.position.reset();
		else if (action === "destroy") h.position.destroy();
		else if (action === "lostcapture") h.pointer(h.node, "lostpointercapture", 300, 148);
		else h.win.dispatchEvent(new h.win.Event(action));
		assert.equal(captured, false, action); assert.equal(listeners.size, 0, action);
	}
});

test("auto-dock confirms only on release, supports both edges and blocks during replacement", (t) => {
	const h = environment(t), sides = []; h.position.destroy(); let blocked = false;
	const controller = createFinderPosition(h.node, h.owner, (side) => sides.push(side), () => !blocked);
	t.after(() => controller.destroy());
	const down = () => { const e = new h.win.Event("pointerdown"); Object.assign(e, { clientX: 300, clientY: 148, button: 0, pointerId: 1, isPrimary: true }); controller.start(e); };
	const update = (autoDock = true) => controller.update({ visible: true, docked: false, side: "right", toolsHeight: 0, autoDock });
	for (const [x, side] of [[80, "left"], [550, "right"]]) {
		controller.reset(); update(); down();
		h.pointer(h.doc, "pointermove", x, 148); assert.equal(h.node.dataset.dockPreview, side); assert.equal(sides.length, side === "left" ? 0 : 1);
		h.pointer(h.doc, "pointerup", x, 148); assert.equal(sides.at(-1), side); assert.equal(h.node.dataset.dockPreview, undefined);
	}
	for (const config of ["disabled", "blocked", "cancelled", "returned"]) {
		controller.reset(); update(config !== "disabled"); blocked = config === "blocked";
		down(); h.pointer(h.doc, "pointermove", 80, 148);
		if (config === "returned") h.pointer(h.doc, "pointermove", 300, 148);
		h.pointer(h.doc, config === "cancelled" ? "pointercancel" : "pointerup", config === "returned" ? 300 : 80, 148);
		assert.equal(sides.length, 2);
	}
});

test("full-width gestures distinguish horizontal collapse from vertical movement; markers move freely", (t) => {
	const h = environment(t); h.position.destroy(); const sides = [];
	h.setOwner(rect(100, 60, 400, 600)); h.setBase(rect(108, 148, 384, 38));
	const controller = createFinderPosition(h.node, h.owner, (side) => sides.push(side)); t.after(() => controller.destroy());
	const state = { visible: true, docked: false, side: "right", toolsHeight: 28, autoDock: true };
	controller.update(state);
	const down = () => { const e = new h.win.Event("pointerdown"); Object.assign(e, { clientX: 200, clientY: 148, button: 0, pointerId: 1, isPrimary: true }); controller.start(e); };
	down(); h.pointer(h.doc, "pointermove", 205, 240); h.pointer(h.doc, "pointerup", 205, 240);
	assert.equal(sides.length, 0); assert.equal(h.node.getBoundingClientRect().top, 240); assert.equal(h.node.getBoundingClientRect().left, 108);
	down(); h.pointer(h.doc, "pointermove", 260, 150); assert.equal(h.node.dataset.dockPreview, "right");
	h.pointer(h.doc, "pointerup", 260, 150); assert.deepEqual(sides, ["right"]);
	h.setBase(rect(108, 148, 44, 44)); controller.update({ ...state, docked: true });
	const edge = h.node.getBoundingClientRect().left; down();
	h.pointer(h.doc, "pointermove", 150, 280); h.pointer(h.doc, "pointerup", 150, 280);
	assert.equal(h.node.getBoundingClientRect().left, edge - 50); assert.equal(sides.length, 1);
	h.setBase(rect(108, 148, 384, 38)); controller.update(state); assert.equal(h.node.getBoundingClientRect().left, 108);
});

test("pointer frames coalesce cached geometry and capture releases on completion/cancel", (t) => {
	const h = environment(t); h.update();
	const frames = new Map(); let serial = 0, captures = 0, releases = 0;
	h.win.requestAnimationFrame = () => 0; h.win.cancelAnimationFrame = () => {};
	t.mock.method(h.win, "requestAnimationFrame", (fn) => { frames.set(++serial, fn); return serial; });
	t.mock.method(h.win, "cancelAnimationFrame", (id) => frames.delete(id));
	h.node.setPointerCapture = () => captures++; h.node.hasPointerCapture = () => true; h.node.releasePointerCapture = () => releases++;
	const start = () => {
		const event = new h.win.Event("pointerdown");
		Object.defineProperty(event, "target", { value: h.node });
		Object.assign(event, { clientX: 300, clientY: 148, pointerId: 1, button: 0, isPrimary: true });
		h.position.start(event);
	};
	start();
	const reads = t.mock.method(h.node, "getBoundingClientRect", h.node.getBoundingClientRect);
	h.pointer(h.doc, "pointermove", 305, 160); h.pointer(h.doc, "pointermove", 330, 180);
	assert.equal(captures, 1); assert.equal(frames.size, 1); assert.equal(reads.mock.calls.length, 0);
	const fn = frames.values().next().value; frames.clear(); fn();
	assert.equal(h.node.style.translate, "30px 32px"); assert.equal(reads.mock.calls.length, 0);
	h.pointer(h.doc, "pointermove", 340, 190); h.pointer(h.doc, "pointerup", 350, 200);
	assert.equal(frames.size, 0); assert.equal(h.node.style.translate, "44px 52px"); assert.equal(releases, 1);
	start(); h.pointer(h.doc, "pointermove", 360, 210); h.pointer(h.doc, "pointercancel", 360, 210);
	assert.equal(frames.size, 0); assert.equal(releases, 2); assert.equal(h.node.style.translate, "44px 52px");
	start(); h.pointer(h.doc, "pointermove", 310, 220);
	h.pointer(h.node, "lostpointercapture", 310, 220);
	assert.equal(frames.size, 0); assert.equal(releases, 3); assert.equal(h.node.style.translate, "44px 52px");
});

test("compact marker can park away from edges, snap to either edge and roll back without changing query state", (t) => {
	const h = environment(t); h.update(); h.setBase(rect(300, 148, 30, 30)); h.update({ docked: true });
	const drag = (x, y, cancel = false) => {
		h.pointer(h.node, "pointerdown", 300, 148); h.pointer(h.doc, "pointermove", x, y);
		h.pointer(h.doc, cancel ? "pointercancel" : "pointerup", x, y);
	};
	drag(0, 198); assert.deepEqual(h.node.getBoundingClientRect(), rect(462, 198, 30, 30));
	h.update({ docked: true }); assert.equal(h.node.getBoundingClientRect().left, 462, "background updates do not snap a parked marker");
	drag(280, 188, true); assert.deepEqual(h.node.getBoundingClientRect(), rect(462, 198, 30, 30));
	drag(-1000, 148); assert.equal(h.node.getBoundingClientRect().left, 108);
	drag(1000, 148); assert.equal(h.node.getBoundingClientRect().right, 792);
});
