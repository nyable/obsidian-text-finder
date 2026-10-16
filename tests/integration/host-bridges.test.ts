import { expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import type { MarkdownView } from "obsidian";
import { Menu } from "obsidian";
import { capturePreviewBody, rendererFor } from "../../src/platform/obsidian/preview-renderer";
import { editorContextFor } from "../../src/platform/obsidian/editor-context";
import { eventMenuFor } from "../../src/platform/obsidian/event-menu";

it("keeps menu body capability independent of full-text readiness and rejects stale stamps", () => {
	const dom = new JSDOM("<p>cat</p>");
	try {
		const renderer = { previewEl: dom.window.document.body, lastText: "cat" };
		const view = { previewMode: { renderer } };
		const owner = view as unknown as MarkdownView;
		const captured = capturePreviewBody(owner);
		expect(captured?.body).toBe(renderer.previewEl);
		expect(captured?.current()).toBe(true);
		expect(rendererFor(owner)).toBeNull();
		renderer.lastText = "dog";
		expect(captured?.current()).toBe(false);
		renderer.lastText = "cat";
		view.previewMode.renderer = { ...renderer };
		expect(captured?.current()).toBe(false);
	} finally {
		dom.window.close();
	}
});

it("refuses absent or malformed host editor and preview capabilities", () => {
	for (const previewMode of [undefined, {}, { renderer: {} }, { renderer: { previewEl: {} } }]) {
		const owner = { previewMode } as unknown as MarkdownView;
		expect(capturePreviewBody(owner)).toBeNull();
		expect(rendererFor(owner)).toBeNull();
	}
	for (const editor of [undefined, {}, { cm: {} }, { cm: { state: {} } }]) {
		expect(editorContextFor({ editor } as unknown as MarkdownView)).toBeNull();
	}
});

it("checks the event-menu capability and handles private bridge rejection", () => {
	const dom = new JSDOM();
	const host = Menu as typeof Menu & { forEvent?: (event: MouseEvent) => Menu };
	const old = host.forEvent;
	const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		const event = new dom.window.MouseEvent("contextmenu");
		Reflect.deleteProperty(host, "forEvent");
		expect(eventMenuFor(event)).toBeNull();
		host.forEvent = () => ({}) as Menu;
		expect(eventMenuFor(event)).toBeNull();
		host.forEvent = () => {
			throw new Error("unavailable");
		};
		expect(eventMenuFor(event)).toBeNull();
		expect(warning).toHaveBeenCalledTimes(1);
	} finally {
		if (old) host.forEvent = old;
		else Reflect.deleteProperty(host, "forEvent");
		warning.mockRestore();
		dom.window.close();
	}
});
