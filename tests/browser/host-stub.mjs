// Browser fixture only; not Obsidian theme/API compatibility evidence.
export const Platform = { isMobile: new URLSearchParams(location.search).get("mobile") === "true" };
export class Menu { addItem() { return this; } showAtMouseEvent() {} hide() {} }
export function moment(value) {
	return { format: () => new Date(value).toISOString().replace("T", " ").slice(0, 19), fromNow: () => "fixed relative time" };
}
moment.locale = () => "en";
export function setTooltip() {}
export function setIcon() {}
export class Notice {}
