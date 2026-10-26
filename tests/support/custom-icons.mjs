/**
 * Custom-icon stand-in for Obsidian's 100×100 wrapper (checked against 1.14.5).
 * Intentionally not a full host registry or theme implementation.
 */
export function createCustomIcons() {
	const icons = new Map();
	return {
		icons,
		addIcon(id, svg) {
			icons.set(id, svg);
		},
		removeIcon(id) {
			icons.delete(id);
		},
		setIcon(element, id) {
			if (!icons.has(id)) return;
			const svg = element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 100 100");
			svg.classList.add("svg-icon", id);
			// Only fixed, trusted production icon markup is registered in these fixtures.
			svg.innerHTML = icons.get(id);
			element.replaceChildren(svg);
		},
	};
}
