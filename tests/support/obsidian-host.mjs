/** Explicit test-only host surface. Unimplemented services are intentionally absent. */
export const Platform = { isMobile: false };
export class MarkdownView {}
export class Editor {}
export class WorkspaceLeaf {}
export class Modal {}
export class PluginSettingTab {}
export class Plugin {}
export class Notice {
	static notify(_text) {}
	constructor(text) {
		Notice.notify(text);
	}
}
export class Menu {
	static shown = [];
	items = [];
	addItem(callback) {
		const item = {
			setTitle(title) {
				this.title = title;
				return this;
			},
			setIcon() {
				return this;
			},
			onClick(run) {
				this.run = run;
				return this;
			},
		};
		callback(item);
		this.items.push(item);
		return this;
	}
	showAtMouseEvent() {
		Menu.shown.push(this);
	}
	hide() {}
}
export const moment = Object.assign(
	(timestamp) => ({ format: () => String(timestamp), fromNow: () => String(timestamp) }),
	{ locale: () => "en" },
);
export const normalizePath = (path) => path.replaceAll("\\", "/");
export function setIcon() {}
export function setTooltip() {}
