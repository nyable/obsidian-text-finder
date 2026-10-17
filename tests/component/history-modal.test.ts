// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { HistoryModal } from "../../src/app/history-modal";
import { HistoryController } from "../../src/features/history";
import { PresetController, type SearchRecipe } from "../../src/features/presets";
import { defaultSettings } from "../../src/features/settings/model/settings";
import type { PluginRuntimeHost } from "../../src/app/plugin-host";

vi.mock("obsidian", () => ({
	MarkdownView: class {},
	Modal: class {
		modalEl = document.createElement("div");
		contentEl = Object.assign(document.createElement("div"), {
			empty(this: HTMLElement) {
				this.replaceChildren();
			},
		});
		constructor() {
			this.modalEl.append(this.contentEl);
			document.body.append(this.modalEl);
		}
		close() {
			(this as unknown as HistoryModal).onClose();
			this.modalEl.remove();
		}
	},
}));
vi.mock("../../src/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("../../src/platform/obsidian/date-format", () => ({
	formatDate: () => "date",
	formatRelativeDate: () => "recent",
}));

const recipe: SearchRecipe = {
	search: "cat",
	options: { regexMode: false, caseSensitive: false, wholeWord: false },
	replacement: null,
};
function fixture(draft = false) {
	const settings = defaultSettings();
	const presets = new PresetController(
		() => settings,
		async () => {},
		() => "preset",
	);
	presets.put("Cats", recipe);
	const focusSearch = vi.fn(),
		applyRecipe = vi.fn(() => true),
		getFinder = vi.fn(() => ({ applyRecipe, focusSearch, captureRecipe: () => recipe }));
	const plugin = {
		settings,
		presets,
		history: new HistoryController(
			() => settings,
			async () => {},
		),
		app: { workspace: { getActiveViewOfType: () => ({ getMode: () => "source" }) } },
		editorSearch: { getFinder },
		isUnloaded: () => false,
		reportError: vi.fn(),
	} as unknown as PluginRuntimeHost;
	const closed = vi.fn();
	const modal = new HistoryModal(plugin.app, plugin, closed, {
		tab: "presets",
		...(draft ? { recipe } : {}),
	});
	modal.onOpen();
	return { modal, closed, focusSearch, applyRecipe, getFinder };
}

describe("host search library modal", () => {
	it("returns focus to the applied owner after closing without reapplying or rematching", async () => {
		const h = fixture();
		try {
			h.modal.contentEl.querySelector<HTMLButtonElement>(".nya-preset-apply")!.click();
			await nextTick();
			expect(h.applyRecipe).toHaveBeenCalledTimes(1);
			expect(h.focusSearch).toHaveBeenCalledTimes(1);
			expect(h.closed).toHaveBeenCalledTimes(1);
			expect(h.getFinder).toHaveBeenCalledTimes(1);
			expect(h.modal.component).toBeUndefined();
		} finally {
			h.modal.close(true);
		}
	});
	it("guards host close but force disposal releases a dirty editor and subscriptions", async () => {
		const h = fixture(true);
		try {
			const name = h.modal.contentEl.querySelector<HTMLInputElement>("input")!;
			name.value = "Draft";
			name.dispatchEvent(new Event("input", { bubbles: true }));
			await nextTick();
			h.modal.close();
			await nextTick();
			expect(h.closed).not.toHaveBeenCalled();
			expect(h.modal.contentEl.querySelector(".nya-library-confirm")).not.toBeNull();
			h.modal.close(true);
			expect(h.closed).toHaveBeenCalledTimes(1);
			expect(h.modal.component).toBeUndefined();
		} finally {
			h.modal.close(true);
		}
	});
});
