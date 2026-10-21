// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { nextTick } from "vue";
import { mobileToolbar } from "../../src/features/finder/interaction/mobile-toolbar";
import { alignFinderRows } from "../../src/features/finder/interaction/row-alignment";
import { mountView } from "../../src/shared/ui/mount-view";
import SearchStatus from "../../src/features/finder/ui/SearchStatus.vue";

vi.mock("../../src/i18n", () => ({ i18n: { t: (key: string) => key } }));
const cleanups: (() => void)[] = [];
afterEach(() =>
	cleanups
		.splice(0)
		.reverse()
		.forEach((cleanup) => cleanup()),
);

function owner() {
	const dom = new JSDOM("<!doctype html><body></body>");
	cleanups.push(() => dom.window.close());
	const viewport = new dom.window.EventTarget();
	Object.assign(viewport, { height: 600, offsetTop: 0 });
	Object.defineProperty(dom.window, "visualViewport", { value: viewport });
	const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
	class Observer {
		disconnect = vi.fn();
		observe = vi.fn();
		constructor(public callback: () => void) {
			observers.push(this);
		}
	}
	Object.defineProperty(dom.window, "ResizeObserver", { value: Observer });
	const remove = vi.spyOn(dom.window, "removeEventListener");
	const viewportRemove = vi.spyOn(viewport, "removeEventListener");
	return { win: dom.window, viewport, observers, remove, viewportRemove };
}

it("moves mobile toolbar observers and resize/viewport listeners to the adopted owner", async () => {
	const a = owner(),
		b = owner();
	const row = a.win.document.createElement("div");
	row.className = "finder";
	row.innerHTML =
		'<textarea></textarea><div class="nya-toolbar"><button data-toolbar-action="regex" data-toolbar-order="0"></button></div><div class="results"></div>';
	a.win.document.body.append(row);
	let width = 200;
	row.getBoundingClientRect = () => ({ width }) as DOMRect;
	const toolbar = row.querySelector<HTMLElement>(".nya-toolbar")!;
	const target = row.querySelector<HTMLElement>(".results")!;
	toolbar.querySelector<HTMLElement>("button")!.getBoundingClientRect = () =>
		({ width: 40 }) as DOMRect;
	const action = mobileToolbar(toolbar, target);
	cleanups.push(() => action.destroy());
	await Promise.resolve();
	b.win.document.body.append(row);
	a.remove.mockClear();
	a.viewportRemove.mockClear();
	action.update(target);
	await Promise.resolve();
	expect(a.observers[0]!.disconnect).toHaveBeenCalled();
	expect(a.remove).toHaveBeenCalledWith("resize", expect.any(Function));
	expect(a.viewportRemove).toHaveBeenCalledWith("resize", expect.any(Function));
	expect(b.observers).toHaveLength(1);
	width = 110;
	a.win.dispatchEvent(new a.win.Event("resize"));
	await Promise.resolve();
	expect(target.children).toHaveLength(0);
	b.viewport.dispatchEvent(new b.win.Event("resize"));
	await Promise.resolve();
	expect(target.children).toHaveLength(1);
	action.destroy();
	a.win.document.body.append(row);
	action.update(target);
	a.observers[0]!.callback();
	await Promise.resolve();
	expect(a.observers).toHaveLength(1);
	expect(b.observers[0]!.disconnect).toHaveBeenCalled();
	expect(b.remove).toHaveBeenCalledWith("resize", expect.any(Function));
	expect(b.viewportRemove).toHaveBeenCalledWith("resize", expect.any(Function));
});

it("rebinds row alignment and releases the old owner before measuring", () => {
	const a = owner(),
		b = owner();
	const row = a.win.document.createElement("div");
	row.innerHTML =
		'<span class="nya-tip"></span><div class="finder-act"></div><div class="replacer-act"><div class="nya-toolbar"></div></div>';
	a.win.document.body.append(row);
	for (const element of row.querySelectorAll<HTMLElement>("*"))
		element.getBoundingClientRect = () => ({ width: 30 }) as DOMRect;
	const setDimensions = vi.fn();
	const action = alignFinderRows(row, false, { measureEnabled: () => true, setDimensions });
	cleanups.push(() => action.destroy());
	b.win.document.body.append(row);
	action.update();
	expect(a.observers[0]!.disconnect).toHaveBeenCalled();
	expect(b.observers).toHaveLength(1);
	setDimensions.mockClear();
	a.win.dispatchEvent(new a.win.Event("resize"));
	expect(setDimensions).not.toHaveBeenCalled();
	b.win.dispatchEvent(new b.win.Event("resize"));
	expect(setDimensions).toHaveBeenCalledOnce();
	action.destroy();
	a.win.document.body.append(row);
	action.update();
	b.observers[0]!.callback();
	expect(a.observers).toHaveLength(1);
	expect(b.observers[0]!.disconnect).toHaveBeenCalled();
});

it("moves a live search status to the new viewport and preserves the modified-write message", async () => {
	const a = owner(),
		b = owner();
	const target = a.win.document.createElement("div");
	a.win.document.body.append(target);
	const panel = mountView(SearchStatus, target, {
		visible: true,
		pending: false,
		unsupported: false,
		error: "failed",
		query: "cat",
		context: {},
		retry() {},
		nativeFind() {},
		modified: false,
	});
	cleanups.push(() => panel.destroy());
	b.win.document.body.append(target);
	panel.update({ modified: true });
	await nextTick();
	expect(target.textContent).toContain("search.ReplacementModified");
	expect(a.observers[0]!.disconnect).toHaveBeenCalled();
	expect(a.viewportRemove).toHaveBeenCalledWith("scroll", expect.any(Function));
	expect(b.observers).toHaveLength(1);
	const status = target.querySelector<HTMLElement>(".nya-search-status")!;
	const box = vi.spyOn(target, "getBoundingClientRect");
	box.mockClear();
	a.win.dispatchEvent(new a.win.Event("resize"));
	expect(box).not.toHaveBeenCalled();
	b.viewport.dispatchEvent(new b.win.Event("scroll"));
	expect(box).toHaveBeenCalled();
	expect(status.style.maxHeight).not.toBe("");
	panel.destroy();
	expect(b.observers[0]!.disconnect).toHaveBeenCalled();
	expect(b.viewportRemove).toHaveBeenCalledWith("scroll", expect.any(Function));
});
