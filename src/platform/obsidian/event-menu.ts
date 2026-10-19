import { Menu } from "obsidian";

/** Join the host's shared event menu without consuming unrelated link handlers. */
export function eventMenuFor(event: MouseEvent): Menu | null {
	// Public since 1.6.0. Keep detection for incomplete/changed host environments.
	if (typeof Menu.forEvent !== "function") return null;
	try {
		const menu = Menu.forEvent(event);
		return menu && typeof menu.addItem === "function" && typeof menu.onHide === "function"
			? menu
			: null;
	} catch (error) {
		console.warn("Text Finder: reading context-menu bridge unavailable", error);
		return null;
	}
}
