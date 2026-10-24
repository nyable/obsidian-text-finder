import assert from "node:assert/strict";

export async function assertCompactTabOverflow(tabs) {
	const originalStyle = await tabs.getAttribute("style");
	try {
		for (const narrow of [false, true]) {
			const layout = await tabs.evaluate((element, narrow) => {
				if (narrow) element.style.maxWidth = "120px";
				element.scrollLeft = 0;
				element.scrollTop = 0;
				const style = getComputedStyle(element);
				const button = element.querySelector('[aria-selected="true"]');
				const box = element.getBoundingClientRect();
				const buttonBox = button.getBoundingClientRect();
				const line = getComputedStyle(button, "::after");
				const underlineBottom = buttonBox.bottom - parseFloat(line.bottom);
				const clipBottom = box.bottom - parseFloat(style.borderBottomWidth);
				element.scrollLeft = element.scrollWidth;
				element.scrollTop = element.scrollHeight;
				return {
					x: style.overflowX,
					y: style.overflowY,
					height: element.clientHeight,
					scrollHeight: element.scrollHeight,
					left: element.scrollLeft,
					top: element.scrollTop,
					underlineFits:
						underlineBottom <= clipBottom &&
						underlineBottom - parseFloat(line.height) >= box.top,
				};
			}, narrow);
			assert.equal(layout.x, "auto", "tabs must retain horizontal scrolling");
			assert.equal(layout.y, "hidden", "tabs must not show a vertical scrollbar");
			assert.equal(layout.scrollHeight, layout.height, "tabs have vertical overflow");
			assert.equal(layout.top, 0, "tabs can scroll vertically");
			assert.ok(layout.underlineFits, "selected underline is clipped by the tab strip");
			if (narrow) assert.ok(layout.left > 0, "narrow tabs cannot scroll horizontally");
		}
	} finally {
		await tabs.evaluate((element, style) => {
			if (style === null) element.removeAttribute("style");
			else element.setAttribute("style", style);
			element.scrollLeft = 0;
			element.scrollTop = 0;
		}, originalStyle);
	}
}
