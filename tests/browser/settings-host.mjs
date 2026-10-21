// Public settings shell/control stand-in, not Obsidian internals or theme evidence.
export * from "./host-stub.mjs";
export class PluginSettingTab {
	constructor(_app, plugin) {
		this.containerEl = plugin.containerEl;
	}
	getSettingDefinitions() {
		return [];
	}
}
HTMLElement.prototype.empty = function () {
	this.replaceChildren();
};
export class Setting {
	constructor(root) {
		const doc = root.ownerDocument;
		this.settingEl = doc.createElement("div");
		this.settingEl.className = "setting-item";
		root.append(this.settingEl);
		this.nameEl = doc.createElement("div");
		this.settingEl.append(this.nameEl);
	}
	setName(name) {
		this.nameEl.textContent = name;
		return this;
	}
	setDesc() {
		return this;
	}
	addToggle(callback) {
		const el = this.settingEl.ownerDocument.createElement("input");
		el.type = "checkbox";
		this.settingEl.append(el);
		callback({
			toggleEl: el,
			setValue(value) {
				el.checked = value;
				return this;
			},
			onChange(fn) {
				el.addEventListener("change", () => fn(el.checked));
				return this;
			},
		});
		return this;
	}
	addText(callback) {
		const el = this.settingEl.ownerDocument.createElement("input");
		this.settingEl.append(el);
		callback({
			inputEl: el,
			setValue(value) {
				el.value = value;
				return this;
			},
			setPlaceholder(value) {
				el.placeholder = value;
				return this;
			},
		});
		return this;
	}
	addDropdown(callback) {
		const el = this.settingEl.ownerDocument.createElement("select");
		this.settingEl.append(el);
		callback({
			addOption(value, label) {
				const option = el.ownerDocument.createElement("option");
				option.value = value;
				option.textContent = label;
				el.append(option);
				return this;
			},
			setValue(value) {
				el.value = value;
				return this;
			},
			onChange(fn) {
				el.addEventListener("change", () => fn(el.value));
				return this;
			},
		});
		return this;
	}
}
