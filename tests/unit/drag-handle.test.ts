// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { dragHandle } from "../../src/features/finder/interaction/drag-handle";

it("desktop press prevents native focus scrolling without moving focus away from the query", () => {
	const input = document.createElement("textarea"),
		node = document.createElement("button");
	document.body.append(input, node);
	input.focus();
	const focus = vi.spyOn(node, "focus"),
		start = vi.fn();
	const binding = dragHandle(node, true, false, () => ({ start }) as never);
	try {
		const event = new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true });
		node.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(focus).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(input);
		expect(start).toHaveBeenCalledExactlyOnceWith(event, false);
	} finally {
		binding.destroy();
		node.remove();
		input.remove();
	}
});

it.each(["mobile", "disabled", "secondary", "non-primary"])(
	"%s press retains its existing default behavior",
	(kind) => {
		const node = document.createElement("button"),
			focus = vi.spyOn(node, "focus"),
			start = vi.fn();
		const binding = dragHandle(
			node,
			kind !== "disabled",
			kind === "mobile",
			() => ({ start }) as never,
		);
		try {
			const event = new MouseEvent("pointerdown", {
				button: kind === "secondary" ? 2 : 0,
				cancelable: true,
			});
			if (kind === "non-primary") Object.defineProperty(event, "isPrimary", { value: false });
			node.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
			expect(focus).not.toHaveBeenCalled();
			expect(start).toHaveBeenCalledTimes(kind === "mobile" ? 1 : 0);
		} finally {
			binding.destroy();
		}
	},
);
