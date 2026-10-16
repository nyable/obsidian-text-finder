import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { createStaticVNode, defineComponent, h, nextTick, useId } from "vue";
import { mountView } from "../../src/shared/ui/mount-view";

const windows: JSDOM[] = [];
const owner = () => {
	const dom = new JSDOM("<!doctype html><body></body>");
	windows.push(dom);
	return dom.window;
};
afterEach(() => {
	windows.splice(0).forEach((dom) => dom.window.close());
});

it("creates HTML, SVG and unique labels without a global document or layout wrapper", async () => {
	const first = owner(),
		second = owner();
	const View = defineComponent({
		props: { text: { type: String, required: true } },
		setup(props) {
			const id = useId();
			return () =>
				h("section", { "aria-labelledby": id }, [
					h("span", { id }, props.text),
					h("svg", null, [h("path")]),
				]);
		},
	});
	const target = first.document.createElement("div");
	first.document.body.append(target);
	const one = mountView(View, target, { text: "first" });
	const two = mountView(View, target, { text: "second" });
	expect(target.children.length).toBe(2);
	expect(new Set([...target.querySelectorAll("span")].map((el) => el.id)).size).toBe(2);
	expect(target.querySelector("span")).toBeInstanceOf(first.HTMLElement);
	expect(target.querySelector("path")).toBeInstanceOf(first.SVGElement);
	second.document.body.append(target);
	one.update({ text: "adopted" });
	await nextTick();
	expect(target.querySelector("span")?.textContent).toBe("adopted");
	one.destroy();
	one.destroy();
	expect(target.children.length).toBe(1);
	two.destroy();
	expect(target.childNodes.length).toBe(0);
});

it("keeps conditional root replacement inside its owner range", async () => {
	const win = owner();
	const View = defineComponent({
		props: { alternate: Boolean },
		setup(props) {
			return () => (props.alternate ? h("button") : h("span"));
		},
	});
	const first = mountView(View, win.document.body, { alternate: false });
	const second = mountView(View, win.document.body, { alternate: false });
	first.update({ alternate: true });
	await nextTick();
	expect([...win.document.body.children].map((el) => el.tagName)).toEqual(["BUTTON", "SPAN"]);
	first.destroy();
	second.destroy();
	expect(win.document.body.childNodes.length).toBe(0);
});

it("creates compiler static HTML and SVG fragments in the current realm", () => {
	const win = owner();
	const View = {
		setup: () => () =>
			h("div", null, [
				createStaticVNode("<span>one</span><span>two</span>", 2),
				h("svg", null, [createStaticVNode('<path d="M0 0L1 1"/>', 1)]),
			]),
	};
	const view = mountView(View, win.document.body, {});
	expect(win.document.querySelectorAll("span").length).toBe(2);
	expect(win.document.querySelector("path")).toBeInstanceOf(win.SVGElement);
	view.destroy();
	expect(win.document.body.childNodes.length).toBe(0);
});
