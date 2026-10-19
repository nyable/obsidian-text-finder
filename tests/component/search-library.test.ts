// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mountView } from "../../src/shared/ui/mount-view";
import HistoryPanel from "../../src/features/history/ui/HistoryPanel.vue";
import { HistoryController, type HistoryView } from "../../src/features/history";
import { PresetController, type SearchRecipe } from "../../src/features/presets";
import { defaultSettings } from "../../src/features/settings/model/settings";

vi.mock("../../src/i18n", () => ({
	i18n: {
		t: (key: string, values?: { count?: number }) =>
			key === "library.LineCount" ? `${values?.count} lines` : key,
	},
}));
vi.mock("../../src/platform/obsidian/date-format", () => ({
	formatDate: () => "date",
	formatRelativeDate: () => "recent",
}));

const cleanups: (() => void)[] = [];
afterEach(() => {
	cleanups.splice(0).forEach((cleanup) => cleanup());
});
const recipe: SearchRecipe = {
	search: "[\\t ]+$",
	options: { regexMode: true, caseSensitive: false, wholeWord: false },
	replacement: { text: "", interpretEscapes: false },
};

function fixture(initialRecipe?: SearchRecipe) {
	const settings = defaultSettings();
	settings.searchHistory = [{ text: " A ", count: 1, createdAt: 0, lastUsedAt: 0 }];
	let id = 0;
	const history = new HistoryController(
		() => settings,
		async () => {},
	);
	const presets = new PresetController(
		() => settings,
		async () => {},
		() => `p-${++id}`,
	);
	presets.put("Clean trailing spaces", recipe);
	const close = vi.fn(),
		apply = vi.fn((_recipe: SearchRecipe) => true);
	const target = document.createElement("div");
	document.body.append(target);
	const view: HistoryView = {
		preferences: () => settings,
		controller: history,
		presets,
		capture: () => recipe,
		apply,
		reuse: () => true,
		copy: async () => {},
		isDisposed: () => false,
		reportError: vi.fn(),
	};
	const component = mountView(HistoryPanel, target, {
		view,
		close,
		initialTab: "presets",
		initialRecipe: initialRecipe ?? null,
	});
	cleanups.push(() => {
		component.destroy();
		target.remove();
	});
	const button = (text: string) =>
		[...target.querySelectorAll<HTMLButtonElement>("button")].find(
			(item) => item.textContent?.trim() === text || item.getAttribute("aria-label") === text,
		)!;
	const click = async (text: string) => {
		const element = button(text);
		expect(element).toBeTruthy();
		element.click();
		await nextTick();
	};
	const input = async (selector: string, value: string) => {
		const element = target.querySelector<HTMLInputElement>(selector)!;
		element.value = value;
		element.dispatchEvent(new Event("input", { bubbles: true }));
		await nextTick();
	};
	return { settings, history, presets, close, apply, target, component, click, input, button };
}

describe("unified search library", () => {
	it("marks only the preset delete icon as destructive without losing its name", () => {
		const h = fixture();
		const remove = h.target.querySelector<HTMLButtonElement>(".nya-library-delete-icon")!;
		expect(remove.getAttribute("aria-label")).toBe("history.Delete");
		expect(remove.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
		expect(h.target.querySelectorAll(".nya-library-delete-icon")).toHaveLength(1);
		expect(h.button("library.Edit").classList.contains("nya-library-delete-icon")).toBe(false);
	});
	it("keeps secondary and discard text actions distinct across editor, naming and close protection", async () => {
		const h = fixture(recipe);
		for (const key of ["settings.Appearance.cancel", "library.SaveAs"])
			expect(h.button(key).classList.contains("nya-library-secondary")).toBe(true);
		await h.click("library.SaveAs");
		expect(h.button("library.BackToEditor").classList.contains("nya-library-secondary")).toBe(
			true,
		);
		await h.click("library.BackToEditor");
		await h.input("textarea", "changed");
		await h.click("settings.Appearance.cancel");
		expect(h.button("library.KeepEditing").classList.contains("nya-library-secondary")).toBe(
			true,
		);
		expect(h.button("library.Discard").classList.contains("nya-library-danger")).toBe(true);
	});
	it("shows an accessible new-preset icon only on the presets tab", async () => {
		const h = fixture();
		const create = h.target.querySelector<HTMLButtonElement>(".nya-library-new")!;
		expect(h.target.querySelector(".nya-library-browser > .nya-library-header")).toBeNull();
		expect(h.target.querySelector(".nya-library-browser h2")).toBeNull();
		expect(create.parentElement?.classList.contains("nya-preset-toolbar")).toBe(true);
		expect(create.nextElementSibling?.textContent).toBe("library.PresetCount");
		expect(create.getAttribute("aria-label")).toBe("library.New");
		expect(create.textContent?.trim()).toBe("");
		expect(create.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
		expect(create.hasAttribute("title")).toBe(false);
		await h.click("history.Title");
		expect(h.target.querySelector(".nya-library-new")).toBeNull();
		await h.click("library.Presets");
		await h.click("library.New");
		expect(h.target.querySelector(".nya-recipe-form")).not.toBeNull();
		expect(h.target.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(recipe.search);
		expect(h.apply).not.toHaveBeenCalled();
	});
	it("names drag handles through unique owner-document references without tooltip attributes, including after reordering", async () => {
		const h = fixture();
		const other = fixture();
		h.presets.put("Second", recipe);
		await nextTick();
		const handles = () => [...document.querySelectorAll<HTMLButtonElement>(".nya-preset-grip")];
		const check = () => {
			const ids = handles().map((handle) => {
				expect(handle.hasAttribute("aria-label")).toBe(false);
				expect(handle.hasAttribute("title")).toBe(false);
				expect(handle.querySelector("[aria-label], [title]")).toBeNull();
				const id = handle.getAttribute("aria-labelledby")!;
				expect(handle.ownerDocument.getElementById(id)?.textContent).toBe(
					"library.ReorderPreset",
				);
				expect(
					handle.ownerDocument.getElementById(handle.getAttribute("aria-describedby")!)
						?.textContent,
				).toBe("library.DragHelp");
				return id;
			});
			expect(new Set(ids).size).toBe(ids.length);
		};
		check();
		h.presets.move("p-2", "p-1");
		await nextTick();
		check();
		expect(other.apply).not.toHaveBeenCalled();
	});
	it.each(["\n", "\r\n", "\r"])(
		"indicates actual multiline text (%j), preserves raw values and ignores literal backslash escapes",
		async (newline) => {
			const h = fixture();
			const search = ` first${newline}${newline}last${newline}`;
			h.presets.put(
				"Multiline",
				{ ...recipe, search, replacement: { text: "one\ntwo", interpretEscapes: false } },
				"p-1",
			);
			await nextTick();
			expect(
				[...h.target.querySelectorAll(".nya-recipe-text")].map((node) => node.textContent),
			).toEqual([" first", "one"]);
			expect(
				[...h.target.querySelectorAll(".nya-recipe-value > .nya-library-sr")].map(
					(node) => node.textContent,
				),
			).toEqual([search, "one\ntwo"]);
			expect(
				[...h.target.querySelectorAll(".nya-recipe-lines")].map((node) =>
					node.textContent?.trim(),
				),
			).toEqual(["4 lines", "2 lines"]);
			expect(h.target.querySelector('.nya-recipe-lines [aria-hidden="true"]')).not.toBeNull();
			h.target.querySelector<HTMLButtonElement>(".nya-preset-apply")!.click();
			expect(h.apply.mock.calls[0]?.[0].search).toBe(search);
			h.presets.put(
				"Literal",
				{
					...recipe,
					search: "\\n",
					replacement: { text: "\\r\\n", interpretEscapes: true },
				},
				"p-1",
			);
			await nextTick();
			expect(h.target.querySelector(".nya-recipe-lines")).toBeNull();
			h.presets.put(
				"Folded",
				{
					...recipe,
					search: "single line",
					collapse: true,
					replacement: { text: "one\ntwo", interpretEscapes: true },
				},
				"p-1",
			);
			await nextTick();
			expect(h.target.querySelectorAll(".nya-recipe-value")).toHaveLength(1);
			expect(h.target.querySelector(".nya-recipe-lines")).toBeNull();
		},
	);
	it("does not skip a blank first line in a multiline preview", async () => {
		const h = fixture();
		h.presets.put(
			"Blank first line",
			{
				...recipe,
				search: "\nsecond",
				replacement: { text: "\r\nlast", interpretEscapes: false },
			},
			"p-1",
		);
		await nextTick();
		expect(
			[...h.target.querySelectorAll(".nya-recipe-text")].map((node) => node.textContent),
		).toEqual(["", ""]);
		expect(
			[...h.target.querySelectorAll(".nya-recipe-lines")].map((node) =>
				node.textContent?.trim(),
			),
		).toEqual(["2 lines", "2 lines"]);
	});
	it("applies a complete preset and closes only after a successful application", async () => {
		const h = fixture();
		h.apply.mockReturnValueOnce(false);
		h.target.querySelector<HTMLButtonElement>(".nya-preset-apply")!.click();
		expect(h.close).not.toHaveBeenCalled();
		h.target.querySelector<HTMLButtonElement>(".nya-preset-apply")!.click();
		expect(h.close).toHaveBeenCalledTimes(1);
		expect(h.apply.mock.calls[0]?.[0]).toMatchObject(recipe);
	});
	it("filters independently in both tabs, preserving exact query text and valid label references", async () => {
		const h = fixture();
		await h.input('input[type="search"]', "Clean");
		await h.click("history.Title");
		expect(h.target.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("");
		expect(h.target.querySelector(".nya-history-text")!.textContent).toBe(" A ");
		await h.input('input[type="search"]', "no such query");
		expect(h.target.querySelector(".nya-history-empty")!.textContent).toContain(
			"library.NoResults",
		);
		await h.click("library.Presets");
		expect(h.target.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe(
			"Clean",
		);
		for (const element of h.target.querySelectorAll("[aria-labelledby]")) {
			expect(element.hasAttribute("aria-label")).toBe(false);
			for (const id of element.getAttribute("aria-labelledby")!.split(" "))
				expect(h.target.ownerDocument.getElementById(id)?.textContent).toBeTruthy();
		}
	});
	it("guards dirty drafts and allows explicit discard without saving", async () => {
		const h = fixture(recipe);
		await h.input(".nya-recipe-field input", "My rule");
		const exposed = h.component.exposed as { canClose(): boolean };
		expect(exposed.canClose()).toBe(false);
		await nextTick();
		expect(h.target.querySelector(".nya-library-confirm")).toBeTruthy();
		await h.click("library.KeepEditing");
		expect(h.target.ownerDocument.activeElement).toBe(
			h.target.querySelector(".nya-recipe-field input"),
		);
		expect(exposed.canClose()).toBe(false);
		await nextTick();
		await h.click("library.Discard");
		expect(h.close).toHaveBeenCalledTimes(1);
		expect(h.settings.searchPresets).toHaveLength(1);
	});
	it("saves empty replacement values, supports save-as, and undo restores deleted presets", async () => {
		const h = fixture(recipe);
		await h.input(".nya-recipe-field input", "Delete spaces");
		h.target
			.querySelector<HTMLFormElement>("form")!
			.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await nextTick();
		expect(h.settings.searchPresets[1]?.replacement).toEqual({
			text: "",
			interpretEscapes: false,
		});
		await h.click("library.Edit");
		await h.input(".nya-recipe-field input", "Copy");
		await h.click("library.SaveAs");
		expect(h.settings.searchPresets).toHaveLength(2);
		await h.click("library.CreatePreset");
		expect(h.settings.searchPresets).toHaveLength(3);
		await h.click("history.Delete");
		expect(h.settings.searchPresets).toHaveLength(2);
		await h.click("library.Undo");
		expect(h.settings.searchPresets).toHaveLength(3);
	});
	it("creates a history-derived preset without borrowing current options or replacement", async () => {
		const h = fixture();
		await h.click("history.Title");
		h.target.querySelector<HTMLButtonElement>('[aria-label="history.Details"]')!.click();
		await nextTick();
		await h.click("library.Save");
		expect(h.target.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(" A ");
		expect(h.target.querySelector<HTMLInputElement>(".nya-recipe-other input")!.checked).toBe(
			false,
		);
		expect(
			h.target.querySelectorAll<HTMLInputElement>(".nya-recipe-other input")[1]!.checked,
		).toBe(true);
		expect(
			[...h.target.querySelectorAll(".nya-match-option[aria-pressed]")].map((button) =>
				button.getAttribute("aria-pressed"),
			),
		).toEqual(["false", "false", "false"]);
	});
	it("undoing history deletion retains newer usage", async () => {
		const h = fixture();
		await h.click("history.Title");
		h.target.querySelector<HTMLButtonElement>('[aria-label="history.Delete"]')!.click();
		await nextTick();
		h.history.record(" A ");
		h.history.record(" A ");
		await h.click("library.Undo");
		expect(h.settings.searchHistory[0]?.count).toBe(2);
	});
	it("a deleted preset cannot be revived by a stale editor, but can be saved as new", async () => {
		const h = fixture();
		await h.click("library.Edit");
		await h.input(".nya-recipe-field input", "Edited");
		h.presets.remove("p-1");
		await h.click("library.SaveAction");
		expect(h.settings.searchPresets).toHaveLength(0);
		expect(h.target.querySelector('[role="alert"]')?.textContent).toContain(
			"library.SaveConflict",
		);
		await h.click("library.SaveAs");
		await h.click("library.CreatePreset");
		expect(h.settings.searchPresets[0]?.name).toBe("Edited");
		expect(h.settings.searchPresets[0]?.id).not.toBe("p-1");
	});
	it("requires a unique name before creating a copy and returns to the exact editing draft", async () => {
		const h = fixture();
		await h.click("library.Edit");
		await h.input(".nya-recipe-field textarea", " draft\nquery ");
		await h.click("library.SaveAs");
		const field = h.target.querySelector<HTMLInputElement>(".nya-recipe-copy input")!;
		expect(field.value).toBe("Clean trailing spaces");
		expect(h.target.ownerDocument.activeElement).toBe(field);
		expect(field.selectionStart).toBe(0);
		expect(field.selectionEnd).toBe(field.value.length);
		expect(field.getAttribute("aria-invalid")).toBe("true");
		expect(h.button("library.CreatePreset").disabled).toBe(true);
		expect(h.settings.searchPresets).toHaveLength(1);
		await h.click("library.BackToEditor");
		expect(h.target.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
			" draft\nquery ",
		);
		expect(h.target.querySelector<HTMLInputElement>(".nya-recipe-field input")!.value).toBe(
			"Clean trailing spaces",
		);
		await h.click("library.SaveAs");
		await h.input(".nya-recipe-copy input", " Copy ");
		expect(h.button("library.CreatePreset").disabled).toBe(false);
		// Another window claims the name after the draft was entered.
		h.presets.put("Copy", recipe);
		await nextTick();
		expect(h.button("library.CreatePreset").disabled).toBe(true);
		await h.input(".nya-recipe-copy input", "Another");
		await h.click("library.CreatePreset");
		expect(h.settings.searchPresets.map((item) => item.name)).toEqual([
			"Clean trailing spaces",
			"Copy",
			"Another",
		]);
		expect(h.settings.searchPresets[0]?.search).toBe(recipe.search);
		expect(h.settings.searchPresets[2]?.search).toBe(" draft\nquery ");
	});
	it("validates duplicate names for new and edited presets without discarding drafts", async () => {
		const h = fixture(recipe);
		await h.input(".nya-recipe-field input", " Clean trailing spaces ");
		expect(h.button("library.SaveAction").disabled).toBe(true);
		const field = h.target.querySelector<HTMLInputElement>(".nya-recipe-field input")!;
		expect(field.getAttribute("aria-invalid")).toBe("true");
		expect(
			field.ownerDocument.getElementById(field.getAttribute("aria-describedby")!)
				?.textContent,
		).toBe("library.DuplicateName");
		await h.input(".nya-recipe-field input", "Unique");
		await h.click("library.SaveAction");
		await h.click("library.Edit");
		expect(h.button("library.SaveAction").disabled).toBe(false);
		await h.input(".nya-recipe-field input", "Unique");
		expect(h.button("library.SaveAction").disabled).toBe(true);
		expect(h.settings.searchPresets.map((item) => item.name)).toEqual([
			"Clean trailing spaces",
			"Unique",
		]);
	});
	it("rechecks names against the latest controller state even if a different window has not notified this editor", async () => {
		const h = fixture(recipe);
		await h.input(".nya-recipe-field input", "Claimed");
		h.settings.searchPresets.push({
			...h.settings.searchPresets[0]!,
			id: "other-window",
			name: "Claimed",
		});
		await h.click("library.SaveAction");
		expect(h.target.querySelector('[role="alert"]')?.textContent).toBe("library.DuplicateName");
		expect(h.settings.searchPresets).toHaveLength(2);
		expect(h.target.querySelector<HTMLInputElement>(".nya-recipe-field input")!.value).toBe(
			"Claimed",
		);
	});
	it("guards closing a naming step without creating a preset and keeps the naming focus on continuation", async () => {
		const h = fixture();
		await h.click("library.Edit");
		await h.click("library.SaveAs");
		await h.input(".nya-recipe-copy input", "Unsaved copy");
		expect((h.component.exposed as { canClose(): boolean }).canClose()).toBe(false);
		await nextTick();
		await h.click("library.KeepEditing");
		expect(h.target.ownerDocument.activeElement).toBe(
			h.target.querySelector(".nya-recipe-copy input"),
		);
		expect(h.settings.searchPresets).toHaveLength(1);
	});
	it("does not undo into an occupied name and warns about preserved legacy duplicates", async () => {
		const h = fixture();
		await h.click("history.Delete");
		h.presets.put("Clean trailing spaces", { ...recipe, search: "newer" });
		await h.click("library.Undo");
		expect(h.target.querySelector(".nya-library-undo")?.textContent).toContain(
			"library.UndoNameConflict",
		);
		expect(h.settings.searchPresets).toHaveLength(1);
		expect(h.settings.searchPresets[0]?.search).toBe("newer");
		h.settings.searchPresets.push({
			...h.settings.searchPresets[0]!,
			id: "legacy",
			search: "legacy",
		});
		h.presets.notify();
		await nextTick();
		expect(h.target.textContent).toContain("library.LegacyDuplicateNames");
		expect(h.target.querySelectorAll(".nya-preset-item")).toHaveLength(2);
	});
	it("restores list scroll and trigger focus after leaving details", async () => {
		const h = fixture();
		await h.click("history.Title");
		const list = h.target.querySelector<HTMLElement>(".nya-library-content")!;
		list.scrollTop = 80;
		const trigger = h.target.querySelector<HTMLButtonElement>(
			'[aria-label="history.Details"]',
		)!;
		trigger.focus();
		trigger.click();
		await nextTick();
		await h.click("history.Back");
		expect(list.scrollTop).toBe(80);
		expect(h.target.ownerDocument.activeElement).toBe(trigger);
	});
	it("uses the Finder toolbar in a static frame without fake results or nested controls", async () => {
		const h = fixture();
		const states = [
			...h.target.querySelectorAll(
				'.nya-preset-item [data-preview-action="regex"], .nya-preset-item [data-preview-action="case"], .nya-preset-item [data-preview-action="wholeWord"]',
			),
		];
		expect(states).toHaveLength(3);
		expect(states.map((state) => state.classList.contains("nya-btn--active"))).toEqual([
			true,
			false,
			false,
		]);
		for (const state of states) {
			expect(state.tagName).toBe("SPAN");
			expect(state.getAttribute("aria-hidden")).toBe("true");
			expect(state.hasAttribute("aria-label")).toBe(false);
		}
		expect(
			h.target.querySelector(
				".nya-preset-apply button, .nya-preset-apply textarea, .nya-preset-apply [tabindex]",
			),
		).toBeNull();
		expect(h.target.querySelector(".nya-preset-apply")?.textContent).toContain(
			"library.Expanded",
		);
		expect(h.target.querySelector(".nya-tip, .nya-preview-count")).toBeNull();
		expect(h.apply).not.toHaveBeenCalled();
		expect(h.settings.searchPresets[0]?.options).toEqual(recipe.options);
	});
	it("explains both other settings without exposing a preset escape override", async () => {
		const h = fixture(recipe);
		const controls = h.target.querySelectorAll<HTMLInputElement>(".nya-recipe-other input");
		expect(controls).toHaveLength(2);
		const description = (element: Element) =>
			element.ownerDocument.getElementById(element.getAttribute("aria-describedby")!);
		expect(controls[0]!.labels?.[0]?.textContent).toContain("library.IncludeReplacement");
		expect(description(controls[0]!)?.textContent).toContain("library.EmptyReplacement");
		expect(controls[1]!.labels?.[0]?.textContent).toContain("library.CollapseOnApply");
		expect(description(controls[1]!)?.textContent).toContain("library.CollapseOnApplyHint");
		expect(description(h.target.querySelectorAll("textarea")[1]!)?.textContent).toContain(
			"library.EmptyReplacement",
		);
		expect(h.target.textContent).not.toContain("library.Escapes");
		controls[0]!.click();
		await nextTick();
		expect(description(controls[0]!)?.textContent).toContain("library.ReplacementNotSaved");
		for (const element of h.target.querySelectorAll(".nya-recipe-other [aria-describedby]")) {
			expect(element.hasAttribute("aria-label")).toBe(false);
			expect(element.hasAttribute("title")).toBe(false);
			expect(description(element)?.textContent?.trim()).toBeTruthy();
		}
	});
	it("stores folded replacement drafts without discarding text or legacy compatibility fields", async () => {
		const h = fixture({
			...recipe,
			replacement: { text: "\\n", interpretEscapes: false },
			collapse: false,
		});
		await h.input(".nya-recipe-field input", "Folded");
		h.target.querySelectorAll<HTMLInputElement>(".nya-recipe-other input")[1]!.click();
		await nextTick();
		expect(h.target.querySelectorAll(".nya-recipe-form textarea")).toHaveLength(2);
		expect(
			h.target.querySelectorAll<HTMLTextAreaElement>(".nya-recipe-form textarea")[1]!.value,
		).toBe("\\n");
		h.target
			.querySelector<HTMLFormElement>("form")!
			.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await nextTick();
		expect(h.settings.searchPresets[1]).toMatchObject({
			collapse: true,
			replacement: { text: "\\n", interpretEscapes: false },
		});
		expect(
			h.target
				.querySelectorAll(".nya-preset-item")[1]
				?.querySelector(".nya-recipe-finder")
				?.classList.contains("is-collapsed"),
		).toBe(true);
	});
	it("reorders via handle keys without applying, retains renamed position, and disables reorder during filtering", async () => {
		const h = fixture();
		h.presets.put("Second", { ...recipe, collapse: true });
		await nextTick();
		const handle = h.target.querySelectorAll<HTMLButtonElement>(".nya-preset-grip")[1]!;
		handle.focus();
		handle.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
		);
		await nextTick();
		expect(h.settings.searchPresets.map((item) => item.name)).toEqual([
			"Second",
			"Clean trailing spaces",
		]);
		expect(h.target.ownerDocument.activeElement).toBe(handle);
		expect(h.apply).not.toHaveBeenCalled();
		h.presets.put("ZZZ", recipe, "p-2");
		await nextTick();
		expect(h.settings.searchPresets[0]?.name).toBe("ZZZ");
		await h.input('input[type="search"]', "ZZZ");
		expect(h.target.querySelector<HTMLButtonElement>(".nya-preset-grip")!.disabled).toBe(true);
	});
	it("summarizes only saved match settings independently of live toolbar order and placement", async () => {
		const h = fixture();
		h.settings.searchToolbar = [
			{ id: "case", placement: "inline" },
			{ id: "regex", placement: "inline" },
			{ id: "wholeWord", placement: "hidden" },
		];
		h.history.notify();
		await nextTick();
		expect(
			[...h.target.querySelectorAll(".nya-preset-apply [data-preview-action]")].map((el) =>
				el.getAttribute("data-preview-action"),
			),
		).toEqual(["regex", "case", "wholeWord"]);
		expect(h.target.querySelectorAll(".nya-recipe-tools")).toHaveLength(1);
		expect(h.settings.searchToolbar.map((item) => item.id)).toEqual([
			"case",
			"regex",
			"wholeWord",
		]);
		expect(
			h.target.querySelector(".nya-preset-apply [aria-label], .nya-preset-apply [title]"),
		).toBeNull();
	});
	it("cancels a pending pointer operation and releases document/window listeners when unmounted", async () => {
		const h = fixture();
		await nextTick();
		const docRemove = vi.spyOn(document, "removeEventListener");
		const winRemove = vi.spyOn(window, "removeEventListener");
		try {
			const event = new Event("pointerdown", { bubbles: true, cancelable: true });
			Object.assign(event, {
				button: 0,
				pointerId: 7,
				pointerType: "touch",
				clientX: 10,
				clientY: 10,
			});
			h.target.querySelector(".nya-preset-grip")!.dispatchEvent(event);
			h.component.destroy();
			for (const type of ["pointermove", "pointerup", "pointercancel", "keydown"])
				expect(docRemove.mock.calls.some((call) => call[0] === type)).toBe(true);
			expect(winRemove.mock.calls.some((call) => call[0] === "blur")).toBe(true);
			expect(h.settings.searchPresets).toHaveLength(1);
		} finally {
			docRemove.mockRestore();
			winRemove.mockRestore();
		}
	});
	it("falls back from throwing pointer capture and releases listeners even when capture release throws", async () => {
		const h = fixture();
		await nextTick();
		const handle = h.target.querySelector<HTMLButtonElement>(".nya-preset-grip")!;
		handle.setPointerCapture = vi.fn(() => {
			throw new Error("capture unavailable");
		});
		handle.hasPointerCapture = () => true;
		handle.releasePointerCapture = vi.fn(() => {
			throw new Error("detached pointer");
		});
		const docRemove = vi.spyOn(document, "removeEventListener");
		const winRemove = vi.spyOn(window, "removeEventListener");
		try {
			const event = Object.assign(
				new Event("pointerdown", { bubbles: true, cancelable: true }),
				{
					button: 0,
					pointerId: 7,
					pointerType: "touch",
					clientX: 10,
					clientY: 10,
				},
			);
			handle.dispatchEvent(event);
			expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
			expect(() => h.component.destroy()).not.toThrow();
			for (const type of ["pointermove", "pointerup", "pointercancel", "keydown"])
				expect(docRemove.mock.calls.some((call) => call[0] === type)).toBe(true);
			expect(winRemove.mock.calls.some((call) => call[0] === "blur")).toBe(true);
			expect(handle.releasePointerCapture).toHaveBeenCalledWith(7);
		} finally {
			docRemove.mockRestore();
			winRemove.mockRestore();
		}
	});
	it("commits preset order using the release coordinate, not the last pointermove", async () => {
		const h = fixture();
		h.presets.put("B", recipe);
		h.presets.put("C", recipe);
		await nextTick();
		const cards = [...h.target.querySelectorAll<HTMLElement>("[data-preset-id]")];
		cards.forEach((card, index) => {
			vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
				top: index * 100,
				bottom: (index + 1) * 100,
				height: 100,
				left: 0,
				right: 200,
				width: 200,
				x: 0,
				y: index * 100,
				toJSON() {},
			});
		});
		const event = (type: string, y: number) =>
			Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
				button: 0,
				pointerId: 7,
				pointerType: "mouse",
				clientX: 10,
				clientY: y,
			});
		const move = vi.spyOn(h.presets, "move");
		cards[0]!.querySelector(".nya-preset-grip")!.dispatchEvent(event("pointerdown", 20));
		document.dispatchEvent(event("pointermove", 180));
		document.dispatchEvent(event("pointerup", 350));
		await nextTick();
		expect(move).toHaveBeenCalledExactlyOnceWith("p-1", null);
		expect(h.presets.list().map((item) => item.id)).toEqual(["p-2", "p-3", "p-1"]);
		expect(h.apply).not.toHaveBeenCalled();
	});
	it("does not activate sorting from a distant release without crossing the move threshold", async () => {
		const h = fixture();
		h.presets.put("B", recipe);
		await nextTick();
		const event = (type: string, y: number) =>
			Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
				button: 0,
				pointerId: 7,
				pointerType: "touch",
				clientX: 10,
				clientY: y,
			});
		const move = vi.spyOn(h.presets, "move");
		h.target.querySelector(".nya-preset-grip")!.dispatchEvent(event("pointerdown", 20));
		document.dispatchEvent(event("pointermove", 22));
		document.dispatchEvent(event("pointerup", 350));
		await nextTick();
		expect(move).not.toHaveBeenCalled();
		expect(h.presets.list().map((item) => item.id)).toEqual(["p-1", "p-2"]);
	});
	it("icon toggles keep focus, do not submit, and save only the local option draft", async () => {
		const h = fixture(recipe);
		const buttons = [
			...h.target.querySelectorAll<HTMLButtonElement>(".nya-match-option[aria-pressed]"),
		];
		expect(buttons).toHaveLength(3);
		for (const button of buttons) {
			expect(button.type).toBe("button");
			expect(button.getAttribute("aria-label")).toBeTruthy();
			expect(button.hasAttribute("title")).toBe(false);
			button.focus();
			button.click();
			await nextTick();
			expect(h.target.ownerDocument.activeElement).toBe(button);
		}
		expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
			"false",
			"true",
			"true",
		]);
		expect(h.settings.searchPresets).toHaveLength(1);
		expect(h.settings.searchPresets[0]?.options).toEqual(recipe.options);
		await h.input(".nya-recipe-field input", "Changed");
		h.target
			.querySelector<HTMLFormElement>("form")!
			.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await nextTick();
		expect(h.settings.searchPresets[1]?.options).toEqual({
			regexMode: false,
			caseSensitive: true,
			wholeWord: true,
		});
	});
	it("separates matching, multiline inputs and other settings, with three consistent footer actions", async () => {
		const h = fixture({ ...recipe, collapse: true });
		const editor = h.target.querySelector(".nya-recipe-form")!;
		expect(editor.querySelector(".nya-recipe-finder")).toBeNull();
		const fields = [...editor.querySelectorAll<HTMLTextAreaElement>("textarea")];
		expect(fields.map((field) => field.rows)).toEqual([4, 4]);
		expect(editor.querySelector(".nya-recipe-options .nya-match-options")).not.toBeNull();
		expect(
			editor
				.querySelector(".nya-recipe-fields")!
				.lastElementChild?.classList.contains("nya-recipe-other"),
		).toBe(true);
		expect(
			[...editor.querySelectorAll(".nya-library-footer button")].map((button) =>
				button.textContent?.trim(),
			),
		).toEqual(["library.SaveAction", "settings.Appearance.cancel", "library.SaveAs"]);
		for (const section of editor.querySelectorAll("section")) {
			expect(section.hasAttribute("aria-label")).toBe(false);
			expect(
				h.target.ownerDocument.getElementById(section.getAttribute("aria-labelledby")!)
					?.textContent,
			).toBeTruthy();
		}
		await h.input(".nya-recipe-field input", "Multiline");
		const find = " first\n\tsecond\n third ";
		const replace = "\tline one\nline two\n";
		fields[0]!.value = find;
		fields[0]!.dispatchEvent(new Event("input", { bubbles: true }));
		fields[1]!.value = replace;
		fields[1]!.dispatchEvent(new Event("input", { bubbles: true }));
		await nextTick();
		await h.click("library.SaveAction");
		expect(h.settings.searchPresets[1]).toMatchObject({
			search: find,
			collapse: true,
			replacement: { text: replace },
		});
	});
	it("keeps excluded replacement drafts editable without implicitly enabling or saving them", async () => {
		const h = fixture({ ...recipe, replacement: null, collapse: true });
		await h.input(".nya-recipe-field input", "Find only");
		const replacement = h.target.querySelectorAll<HTMLTextAreaElement>(
			".nya-recipe-form textarea",
		)[1]!;
		replacement.value = " retained\n draft ";
		replacement.dispatchEvent(new Event("input", { bubbles: true }));
		await nextTick();
		const include = h.target.querySelector<HTMLInputElement>(".nya-recipe-other input")!;
		expect(include.checked).toBe(false);
		include.click();
		await nextTick();
		include.click();
		await nextTick();
		expect(replacement.value).toBe(" retained\n draft ");
		await h.click("library.SaveAction");
		expect(h.settings.searchPresets[1]?.replacement).toBeNull();
	});
	it("has no persistent list explanation and shows only temporary undo feedback after deletion", async () => {
		const h = fixture();
		expect(h.target.querySelector(".nya-library-browser > .nya-library-footer")).toBeNull();
		expect(h.target.querySelector(".nya-library-list-feedback")).toBeNull();
		expect(h.target.querySelector(".nya-recipe-text")?.textContent).toBe(recipe.search);
		expect(h.target.querySelectorAll(".nya-recipe-value")[1]?.textContent).toBe("");
		await h.click("history.Delete");
		expect(
			h.target.querySelector(".nya-library-list-feedback .nya-library-undo"),
		).not.toBeNull();
		await h.click("library.Undo");
		expect(h.target.querySelector(".nya-library-list-feedback")).toBeNull();
	});
	it("tracks the owner visual viewport and releases the keyboard resize listener on destroy", () => {
		const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
		const viewport = {
			height: 800,
			addEventListener: vi.fn((_type: string, _listener: () => void) => {}),
			removeEventListener: vi.fn((_type: string, _listener: () => void) => {}),
		};
		Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
		try {
			const h = fixture(recipe);
			const root = h.target.querySelector<HTMLElement>(".nya-library")!;
			expect(root.style.getPropertyValue("--nya-library-viewport-height")).toBe("800px");
			const listener = viewport.addEventListener.mock.calls[0]?.[1] as () => void;
			expect(viewport.addEventListener.mock.calls[0]?.[0]).toBe("resize");
			viewport.height = 360;
			listener();
			expect(root.style.getPropertyValue("--nya-library-viewport-height")).toBe("360px");
			expect(root.classList.contains("nya-library--compact")).toBe(true);
			viewport.height = 700;
			listener();
			expect(root.classList.contains("nya-library--compact")).toBe(false);
			h.component.destroy();
			expect(viewport.removeEventListener).toHaveBeenCalledWith("resize", listener);
		} finally {
			if (original) Object.defineProperty(window, "visualViewport", original);
			else Reflect.deleteProperty(window, "visualViewport");
		}
	});
});
