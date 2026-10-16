import { Menu } from "obsidian";

/** Join the host's shared event menu without consuming unrelated link handlers. */
export function eventMenuFor(event: MouseEvent): Menu | null {
	const forEvent = (Menu as typeof Menu & { forEvent?: (event: MouseEvent) => Menu }).forEvent;
	if (typeof forEvent !== "function") return null;
	try {
		const menu = forEvent.call(Menu, event);
		return menu && typeof menu.addItem === "function" && typeof menu.onHide === "function"
			? menu
			: null;
	} catch (error) {
		console.warn("Text Finder: reading context-menu bridge unavailable", error);
		return null;
	}
}
