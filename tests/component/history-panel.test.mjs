// @vitest-environment jsdom
import assert from "node:assert/strict";
import { test, vi, onTestFinished } from "vitest";
import { JSDOM } from "jsdom";
import { HistoryController } from "../../src/features/history";
import { mountView } from "../../src/shared/ui/mount-view";
import HistoryPanel from "../../src/features/history/ui/HistoryPanel.vue";
import { nextTick as tick } from "vue";

// Compile the actual components, including bindings, reactive sorting and DOM
// event modifiers. Only host APIs and decorative icons are stubbed.
vi.mock("../../src/platform/obsidian/date-format", () => ({
	formatDate: (timestamp) => {
		(globalThis.__historyDates ??= []).push(timestamp);
		return "date";
	},
	formatRelativeDate: (timestamp) => {
		(globalThis.__historyDates ??= []).push(timestamp);
		return "relative";
	},
}));
vi.mock("../../src/i18n", () => ({
	i18n: {
		t: (key, values) =>
			["history.UsageCount", "history.Characters"].includes(key)
				? `${key}: ${values.count}`
				: key,
	},
}));
const attachHistory = (plugin) => {
	plugin.history = new HistoryController(
		() => plugin.settings,
		async () => {
			try {
				await plugin.saveSettings();
			} catch (error) {
				console.error("Text Finder: failed to save search history", error);
				throw error;
			}
		},
	);
};

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.Element = dom.window.Element;
globalThis.SVGElement = dom.window.SVGElement;

function mount(_t, sortOrder = "lastUsedAt", texts = ["A", "B", "C"], sharedPlugin) {
	const copied = [];
	const searched = [];
	let saves = 0;
	let closes = 0;
	const errors = [];
	navigator.clipboard = {
		writeText: async (text) => {
			copied.push(text);
		},
	};
	const plugin = sharedPlugin ?? {
		settings: {
			enableHistory: true,
			historySortOrder: sortOrder,
			historyMaxCount: 10,
			searchHistory: texts.map((text, index) => ({
				text,
				count: 1,
				createdAt: 100 - index,
				lastUsedAt: 100 - index,
			})),
		},
		isUnloaded: () => false,
		saveSettings: async () => {
			saves++;
		},
		reportError: (key, error) => errors.push({ key, error }),
	};
	if (!sharedPlugin) attachHistory(plugin);
	if (!sharedPlugin)
		plugin.editorSearch = {
			getFinder: () => ({
				setVisibleFromHistory: (text) => {
					searched.push(text);
					plugin.history.record(text);
					return true;
				},
			}),
		};
	const target = document.createElement("div");
	document.body.append(target);
	const view = {
		preferences: () => plugin.settings,
		controller: plugin.history,
		reuse: (text) => plugin.editorSearch?.getFinder().setVisibleFromHistory(text) ?? false,
		copy: (text) => target.ownerDocument.defaultView.navigator.clipboard.writeText(text),
		isDisposed: () => plugin.isUnloaded(),
		reportError: (key, error) => plugin.reportError(key, error),
	};
	const component = mountView(HistoryPanel, target, {
		view,
		close: () => {
			closes++;
		},
	});
	onTestFinished(() => {
		component.destroy();
		target.remove();
	});
	const rows = () => [...target.querySelectorAll(".nya-history-item")];
	const row = (text) =>
		rows().find((row) => row.querySelector(".nya-history-text").textContent === text);
	const click = async (element) => {
		assert.ok(element, "action exists");
		element.click();
		await tick();
	};
	const key = async (element, key = "Enter") => {
		element.focus();
		const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		if (!event.defaultPrevented && (key === "Enter" || key === " ")) element.click();
		await tick();
		return event;
	};
	return {
		target,
		plugin,
		component,
		row,
		rows,
		click,
		key,
		copied,
		searched,
		errors,
		saves: () => saves,
		closes: () => closes,
		select: async (text) => {
			await click(row(text).querySelector('[role="checkbox"]'));
		},
		action: (text, name) => click(row(text).querySelector(`[aria-label="history.${name}"]`)),
		bulkDelete: () => click(target.querySelector(".nya-history-toolbar button.delete")),
		selectAll: async () => {
			await click(target.querySelector(".nya-history-select-all"));
		},
		texts: () => plugin.settings.searchHistory.map((item) => item.text).sort(),
	};
}

for (const sortOrder of ["lastUsedAt", "count"]) {
	test(`copy leaves usage and keyed DOM unchanged with ${sortOrder} sorting`, async (t) => {
		const h = mount(t, sortOrder);
		await h.select("A");
		const originalA = h.row("A");
		const originalB = h.row("B");
		await h.action("B", "Copy");
		assert.deepEqual(h.copied, ["B"]);
		assert.equal(h.rows()[0], originalA);
		assert.equal(h.row("B"), originalB);
		assert.equal(h.row("A"), originalA);
		assert.equal(
			h.row("A").querySelector('[role="checkbox"]').getAttribute("aria-checked"),
			"true",
		);
		assert.equal(
			h.row("B").querySelector('[role="checkbox"]').getAttribute("aria-checked"),
			"false",
		);
		await h.bulkDelete();
		assert.deepEqual(h.texts(), ["B", "C"]);
		assert.equal(h.saves(), 1);
		assert.equal(h.closes(), 0);
	});
}

test("single deletion preserves unrelated selections", async (t) => {
	const h = mount(t);
	await h.select("A");
	await h.select("C");
	await h.action("A", "Delete");
	assert.equal(
		h.row("C").querySelector('[role="checkbox"]').getAttribute("aria-checked"),
		"true",
	);
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["B"]);
});

test("deleting an unselected row does not clear the selection", async (t) => {
	const h = mount(t);
	await h.select("A");
	await h.action("B", "Delete");
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["C"]);
});

test("select all, unselect all and select all after a reorder operate on identities", async (t) => {
	const h = mount(t);
	await h.selectAll();
	assert.equal(h.target.querySelectorAll('[aria-checked="true"]').length, 3);
	await h.action("C", "Copy");
	await h.selectAll();
	assert.equal(h.target.querySelectorAll('[aria-checked="true"]').length, 0);
	assert.equal(h.target.querySelector(".nya-history-toolbar button.delete"), null);
	await h.selectAll();
	await h.bulkDelete();
	assert.deepEqual(h.texts(), []);
	await h.selectAll();
	assert.equal(h.target.querySelector(".nya-history-toolbar button.delete"), null);
});

test("selection uses exact text, including whitespace and special property names", async (t) => {
	const h = mount(t, "lastUsedAt", ["A", " A ", "__proto__"]);
	await h.select(" A ");
	await h.action("__proto__", "Copy");
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["A", "__proto__"]);
});

test("detail copy preserves the list selection without changing usage", async (t) => {
	const h = mount(t);
	await h.select("A");
	await h.action("B", "Details");
	await h.click(h.target.querySelector(".nya-history-detail .nya-library-actions button"));
	await h.click(h.target.querySelector(".nya-library-header button"));
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["B", "C"]);
});

for (const action of ["Details", "Copy", "Delete"]) {
	test(`Enter on ${action} does not activate the parent search action`, async (t) => {
		const h = mount(t);
		const button = h.row("B").querySelector(`[aria-label="history.${action}"]`);
		const event = await h.key(button);
		assert.equal(h.closes(), 0);
		assert.deepEqual(h.searched, []);
		assert.equal(event.defaultPrevented, false, "native button activation remains available");
		// jsdom does not synthesize the browser's keyboard-generated click.
		// The helper synthesizes native button activation for jsdom.
		assert.equal(h.closes(), 0);
		assert.deepEqual(h.searched, []);
		if (action === "Details") assert.ok(h.target.querySelector(".nya-history-detail"));
		if (action === "Copy") assert.deepEqual(h.copied, ["B"]);
		if (action === "Delete") assert.deepEqual(h.texts(), ["A", "C"]);
	});
}

test("Enter on the row itself still reuses the history exactly once", async (t) => {
	const h = mount(t);
	await h.key(h.row("A").querySelector(".nya-history-content"));
	assert.equal(h.closes(), 1);
	assert.deepEqual(h.searched, ["A"]);
	assert.equal(h.saves(), 1);
});

test("checkbox Enter toggles selection without activating search", async (t) => {
	const h = mount(t);
	await h.key(h.row("B").querySelector('[role="checkbox"]'));
	await h.action("C", "Copy");
	await h.bulkDelete();
	assert.deepEqual(h.texts(), ["A", "C"]);
	assert.deepEqual(h.searched, []);
});

test("clipboard rejection reports failure without changing stats or saving", async (t) => {
	const h = mount(t);
	navigator.clipboard.writeText = async () => {
		throw new Error("denied");
	};
	await h.action("B", "Copy");
	assert.equal(h.plugin.settings.searchHistory.find((i) => i.text === "B").count, 1);
	assert.equal(h.saves(), 0);
	assert.equal(h.errors[0].key, "history.CopyFailed");
});

test("pending clipboard completion cannot recreate deleted history", async (t) => {
	const h = mount(t);
	let resolve;
	navigator.clipboard.writeText = () =>
		new Promise((done) => {
			resolve = done;
		});
	await h.action("B", "Copy");
	assert.equal(h.saves(), 0);
	await h.action("B", "Delete");
	resolve();
	await tick();
	assert.deepEqual(h.texts(), ["A", "C"]);
	assert.equal(h.saves(), 1);
});

test("disabled history copy and reuse work without stats, while deletion still saves", async (t) => {
	const h = mount(t);
	h.plugin.settings.enableHistory = false;
	await h.action("B", "Copy");
	assert.deepEqual(h.copied, ["B"]);
	assert.equal(h.saves(), 0);
	await h.click(h.row("A").querySelector(".nya-history-content"));
	assert.deepEqual(h.searched, ["A"]);
	assert.equal(h.saves(), 0);
	await h.action("B", "Delete");
	assert.equal(h.saves(), 1);
});

test("two mounted modals synchronize deletions, selection and details", async (t) => {
	const first = mount(t);
	const second = mount(t, "lastUsedAt", [], first.plugin);
	await second.select("A");
	await first.action("A", "Delete");
	await tick();
	assert.equal(second.row("A"), undefined);
	assert.equal(second.target.querySelector(".nya-history-toolbar button.delete"), null);
	await second.action("B", "Details");
	await first.action("B", "Delete");
	await tick();
	assert.equal(second.target.querySelector(".nya-history-detail"), null);
	assert.equal(second.rows().length, 1);
});

test("external shrink and sort notifications refresh modal capacity and selected identities", async (t) => {
	const h = mount(t);
	await h.select("C");
	h.plugin.history.resize(1);
	await tick();
	assert.equal(h.rows().length, 1);
	assert.match(h.target.querySelector(".nya-history-toolbar").textContent, /1 \/ 1/);
	assert.equal(h.target.querySelector(".nya-history-toolbar button.delete"), null);
});

test("unsuccessful history reuse leaves modal open and does not increment usage", async (t) => {
	const h = mount(t);
	h.plugin.editorSearch.getFinder = () => ({ setVisibleFromHistory: () => false });
	await h.click(h.row("A").querySelector(".nya-history-content"));
	assert.equal(h.closes(), 0);
	assert.equal(h.saves(), 0);
	assert.equal(h.errors[0].key, "history.ReuseFailed");
});

test("destroyed modal unsubscribes from shared history updates", async (t) => {
	const h = mount(t);
	h.component.destroy();
	h.plugin.history.record("new");
	await tick();
	assert.equal(h.target.childElementCount, 0);
});

test("failed persistence leaves deletion visible and does not create unhandled rejection", async (t) => {
	const h = mount(t);
	vi.spyOn(console, "error").mockImplementation(() => {});
	h.plugin.saveSettings = async () => {
		throw new Error("save failed");
	};
	await h.action("A", "Delete");
	await tick();
	assert.deepEqual(h.texts(), ["B", "C"]);
	assert.equal(h.row("A"), undefined);
	assert.equal(console.error.mock.calls.length, 1);
});

test("usage updates in another modal refresh an open detail view", async (t) => {
	const first = mount(t);
	const second = mount(t, "lastUsedAt", [], first.plugin);
	await second.action("B", "Details");
	first.plugin.history.record("B");
	await tick();
	assert.match(second.target.querySelector(".nya-history-detail").textContent, /2/);
	assert.equal(first.plugin.settings.searchHistory.find((i) => i.text === "B").count, 2);
});

test("checkbox Space toggles once and does not reuse the query", async (t) => {
	const h = mount(t);
	const event = await h.key(h.row("A").querySelector('[role="checkbox"]'), " ");
	assert.equal(event.defaultPrevented, false, "native checkbox button activation is available");
	assert.equal(
		h.row("A").querySelector('[role="checkbox"]').getAttribute("aria-checked"),
		"true",
	);
	assert.equal(h.searched.length, 0);
});

test("late clipboard success after modal destruction does not record usage", async (t) => {
	const h = mount(t);
	let finish;
	navigator.clipboard.writeText = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	await h.action("A", "Copy");
	h.component.destroy();
	finish();
	await Promise.resolve();
	await tick();
	assert.equal(h.plugin.settings.searchHistory.find((item) => item.text === "A").count, 1);
	assert.equal(h.saves(), 0);
});

test("list and detail preserve a valid epoch creation timestamp", async (t) => {
	const h = mount(t, "createdAt", ["A"]);
	globalThis.__historyDates = [];
	h.plugin.settings.searchHistory[0] = { text: "A", count: 1, createdAt: 0, lastUsedAt: 9 };
	h.plugin.history.notify();
	await tick();
	assert.ok(globalThis.__historyDates.includes(0));
	globalThis.__historyDates = [];
	await h.action("A", "Details");
	assert.ok(globalThis.__historyDates.includes(0));
});

for (const sortOrder of ["createdAt", "lastUsedAt", "count"]) {
	test(`history metadata includes usage, exact UTF-16 length and labeled time with ${sortOrder} sorting`, async (t) => {
		const text = " 😀\n\t ";
		const h = mount(t, sortOrder, [text]);
		h.plugin.settings.searchHistory[0] = { text, count: 28, createdAt: 0, lastUsedAt: 9 };
		globalThis.__historyDates = [];
		h.plugin.history.notify();
		await tick();
		const row = h.row(text);
		assert.ok(
			row
				.querySelector('[aria-label="history.Delete"]')
				.classList.contains("nya-library-delete-icon"),
		);
		assert.equal(row.querySelectorAll(".nya-library-delete-icon").length, 1);
		assert.equal(row.querySelector(".nya-history-usage").textContent, "history.UsageCount: 28");
		assert.equal(
			row.querySelector(".nya-history-length").textContent,
			`history.Characters: ${text.length}`,
		);
		assert.equal(
			row.querySelector(".nya-history-time-combined").textContent.replace(/\s+/g, " ").trim(),
			`${sortOrder === "createdAt" ? "history.Created" : "history.LastUsed"}: relative`,
		);
		assert.equal(row.querySelector(".nya-history-time-value").textContent, "relative");
		assert.equal(
			row
				.querySelector(".nya-history-time-combined .nya-library-sr")
				.getAttribute("aria-hidden"),
			null,
		);
		assert.deepEqual(globalThis.__historyDates, [sortOrder === "createdAt" ? 0 : 9]);
		assert.equal(row.querySelector(".nya-history-meta").hasAttribute("aria-label"), false);
		assert.equal(row.querySelector(".nya-history-meta").hasAttribute("title"), false);
		const meta = row.querySelector(".nya-history-meta");
		assert.equal(meta.parentElement, row);
		assert.equal(row.querySelector(".nya-history-content .nya-history-meta"), null);
		assert.equal(
			row.ownerDocument.getElementById(
				row.querySelector(".nya-history-content").getAttribute("aria-describedby"),
			),
			meta,
		);
		assert.equal(row.querySelectorAll(".nya-history-content button").length, 0);
		const before = row.querySelector(".nya-history-meta").textContent;
		await h.action(text, "Copy");
		await h.select(text);
		assert.equal(row.querySelector(".nya-history-meta").textContent, before);
		assert.equal(h.saves(), 0);
		assert.deepEqual(h.searched, []);
		h.plugin.history.record(text);
		await tick();
		assert.equal(row.querySelector(".nya-history-usage").textContent, "history.UsageCount: 29");
	});
}

test("history metadata descriptions stay unique across modals and valid after reorder", async (t) => {
	const first = mount(t);
	const second = mount(t, "lastUsedAt", [], first.plugin);
	const check = () => {
		const ids = [];
		for (const h of [first, second])
			for (const row of h.rows()) {
				const query = row.querySelector(".nya-history-content");
				const id = query.getAttribute("aria-describedby");
				ids.push(id);
				assert.equal(document.getElementById(id), row.querySelector(".nya-history-meta"));
			}
		assert.equal(new Set(ids).size, ids.length);
	};
	check();
	first.plugin.history.record("C");
	await tick();
	check();
	await first.action("B", "Delete");
	await tick();
	check();
});

test("detail keeps complete statistics outside the query scroller and uses named text actions with a destructive delete", async (t) => {
	const text = " 😀\n\t ";
	const h = mount(t, "lastUsedAt", [text]);
	await h.action(text, "Details");
	const detail = h.target.querySelector(".nya-history-detail");
	const meta = detail.querySelector(".nya-history-detail-meta");
	const body = detail.querySelector(".nya-history-detail-body");
	assert.equal(meta.parentElement, detail);
	assert.equal(body.previousElementSibling, meta);
	assert.equal(body.querySelector("dl"), null);
	assert.equal(body.querySelector("pre").textContent, text);
	assert.equal(body.querySelector("pre").tabIndex, 0);
	assert.deepEqual(
		[...meta.querySelectorAll("dt")].map((e) => e.textContent),
		["history.Count", "history.Length", "history.Created", "history.LastUsed"],
	);
	assert.deepEqual(
		[...meta.querySelectorAll("dd")].map((e) => e.textContent),
		["1", `history.Characters: ${text.length}`, "date", "date"],
	);
	const [copy, preset, remove] = detail.querySelectorAll(".nya-library-actions button");
	assert.deepEqual(
		[copy, preset, remove].map((e) => e.textContent),
		["history.Copy", "library.Save", "history.Delete"],
	);
	assert.equal(detail.querySelector(".nya-library-actions svg"), null);
	assert.ok(copy.classList.contains("nya-library-secondary"));
	assert.ok(remove.classList.contains("mod-warning"));
	assert.ok(remove.classList.contains("nya-library-danger"));
	const back = h.target.querySelector(".nya-library-header button");
	assert.ok(back.classList.contains("nya-library-secondary"));
	assert.equal(document.activeElement, back);
	await h.click(copy);
	assert.deepEqual(h.copied, [text]);
	assert.equal(h.saves(), 0);
	assert.deepEqual(h.searched, []);
	await h.click(remove);
	assert.deepEqual(h.texts(), []);
	assert.equal(h.target.querySelector(".nya-history-detail"), null);
	assert.ok(
		[...h.target.querySelectorAll("button")].some((e) => e.textContent === "library.Undo"),
	);
});

test("history offers direct selection and keeps filtered select-all scoped to visible identities", async (t) => {
	const h = mount(t);
	assert.equal(h.target.querySelector(".nya-history-manage"), null);
	assert.equal(h.target.querySelectorAll('[role="checkbox"]').length, 3);
	await h.select("A");
	const filter = h.target.querySelector('input[type="search"]');
	filter.value = "B";
	filter.dispatchEvent(new window.Event("input", { bubbles: true }));
	await tick();
	await h.selectAll();
	assert.equal(
		h.row("B").querySelector('[role="checkbox"]').getAttribute("aria-checked"),
		"true",
	);
	await h.selectAll();
	filter.value = "";
	filter.dispatchEvent(new window.Event("input", { bubbles: true }));
	await tick();
	assert.equal(
		h.row("A").querySelector('[role="checkbox"]').getAttribute("aria-checked"),
		"true",
	);
	assert.equal(
		h.row("B").querySelector('[role="checkbox"]').getAttribute("aria-checked"),
		"false",
	);
	await h.click(h.target.querySelector(".nya-history-clear"));
	assert.equal(h.target.querySelectorAll('[aria-checked="true"]').length, 0);
});
