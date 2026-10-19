// @vitest-environment jsdom
import { expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { nextTick } from "vue";
import { mountView } from "../../src/shared/ui/mount-view";
import OwnerTemplate from "../support/OwnerTemplate.vue";

it("creates compiled static nodes in the current realm after adoption and escapes user text", async () => {
	const first = new JSDOM(),
		second = new JSDOM();
	const target = first.window.document.createElement("div");
	first.window.document.body.append(target);
	const text = '<img src="x" onerror="alert(1)">';
	const view = mountView(OwnerTemplate, target, { alternate: false, text });
	try {
		expect(target.textContent).toBe(text);
		expect(target.querySelector("img")).toBeNull();
		second.window.document.body.append(target);
		view.update({ alternate: true });
		await nextTick();
		expect(target.querySelector("article")).toBeInstanceOf(second.window.HTMLElement);
		expect(target.querySelector("path")).toBeInstanceOf(second.window.SVGElement);
		expect(target.querySelector("mi")?.ownerDocument).toBe(second.window.document);
		expect(target.querySelector("mi")?.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
		expect(target.querySelector("select")?.multiple).toBe(true);
		view.destroy();
		expect(target.childNodes.length).toBe(0);
	} finally {
		view.destroy();
		first.window.close();
		second.window.close();
	}
});
