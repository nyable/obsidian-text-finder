// @vitest-environment jsdom
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { nextTick } from "vue";
import { i18n, initializeLanguage } from "../../src/i18n";
import { mountView } from "../../src/shared/ui/mount-view";
import HistoryList from "../../src/features/history/ui/HistoryList.vue";
import PresetList from "../../src/features/presets/ui/PresetList.vue";

vi.mock("../../src/platform/obsidian/date-format", () => ({
	formatDate: () => "date",
	formatRelativeDate: () => "recent",
}));

for (const [language, locale] of [
	["en", "en"],
	["zh_cn", "zh-cn"],
]) {
	test(`real ${language} interpolation preserves exact text in names and announcements without HTML`, async () => {
		initializeLanguage(locale);
		await nextTick();
		assert.equal(i18n.language, language);
		const target = document.createElement("div");
		document.body.append(target);
		const text = `a < b && x > 0 " ' <img src=x onerror=alert(1)> {{count}} $t(secret) $&`;
		const history = mountView(HistoryList, target, {
			history: [{ text, count: 1, createdAt: 0, lastUsedAt: 0 }],
			settings: { historySortOrder: "lastUsedAt" },
			selectedTexts: new Set(),
		});
		try {
			const label = target.querySelector(".nya-history-checkbox").getAttribute("aria-label");
			assert.ok(label.endsWith(text), label);
			assert.equal(target.querySelector(".nya-history-text").textContent, text);
			assert.equal(target.querySelector("img"), null);
		} finally {
			history.destroy();
		}
		const recipe = {
			search: text,
			replacement: null,
			options: { regexMode: false, caseSensitive: false, wholeWord: false },
			createdAt: 0,
			updatedAt: 0,
		};
		const presets = mountView(PresetList, target, {
			items: [
				{ ...recipe, id: "a", name: text },
				{ ...recipe, id: "b", name: "other" },
			],
			filtered: false,
		});
		try {
			const grip = target.querySelector(".nya-preset-grip");
			const label = document.getElementById(grip.getAttribute("aria-labelledby")).textContent;
			assert.ok(label.includes(text), label);
			grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
			await nextTick();
			assert.ok(target.querySelector('[role="status"]').textContent.includes(text));
			assert.equal(target.querySelector("img"), null);
		} finally {
			presets.destroy();
			target.remove();
		}
	});
}
