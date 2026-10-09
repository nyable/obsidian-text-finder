import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "./source-loader.mjs";

const helper = loadSource("../src/util/text-helper.ts");

function createFinder(initialContent, search = "cat", regexMode = false) {
	let content = initialContent;
	let available = true;
	const writes = [];
	const editor = {
		getValue: () => content,
		getRange: (from, to) => content.slice(from, to),
		offsetToPos: (offset) => offset,
		scrollIntoView: () => {},
		cm: {
			dispatch(spec) {
				if (!spec.changes) return;
				const changes = Array.isArray(spec.changes) ? spec.changes : [spec.changes];
				let previousEnd = 0;
				for (const { from, to } of changes) {
					assert.ok(from >= previousEnd && to >= from && to <= content.length, "valid non-overlapping ranges");
					previousEnd = to;
				}
				writes.push(changes);
				for (const { from, to, insert } of [...changes].reverse()) {
					content = content.slice(0, from) + insert + content.slice(to);
				}
			},
		},
	};
	const view = {
		editor,
		getState: () => ({ mode: "source", source: true }),
		setState: () => {},
	};
	const plugin = {
		settings: { clearAfterHidden: false, useEscapeCharInReplace: true },
		app: { workspace: { getActiveViewOfType: () => available ? view : null } },
	};
	const finder = loadSource("../src/SearchBox.svelte", {
		"./editor-extension": { searchCacheEffect: { of: (cache) => cache } },
		"./util/text-helper": helper,
		"./constants": loadSource("../src/constants.ts"),
		obsidian: { MarkdownView: class {}, Platform: { isMobile: false } },
	});
	finder.editorSearch = { plugin };
	finder.getSearchCache().options.regexMode = regexMode;
	finder.setFindText(search, false);
	return {
		finder,
		plugin,
		writes,
		content: () => content,
		edit: (value) => { content = value; },
		removeEditor: () => { available = false; },
	};
}

for (const action of ["replaceMatchedText", "replaceAllMatchedText"]) {
	test(`${action}: Unicode search changes only the original matching character`, () => {
		const h = createFinder("İxa", "x");
		const result = h.finder[action]("Z");
		assert.equal(h.content(), "İZa");
		assert.equal(result.changeCount, 1);
	});

	test(`${action}: hidden finder recalculates offsets after an insertion`, () => {
		const h = createFinder("a cat z");
		h.finder.setVisible(false);
		h.edit("XXX a cat z");
		h.finder.matchAgain(false);
		const result = h.finder[action]("DOG");
		assert.equal(h.content(), "XXX a DOG z");
		assert.equal(result.beforeCount, 1);
		assert.equal(result.afterCount, 0);
	});

	test(`${action}: deletion before the match uses the new range`, () => {
		const h = createFinder("long prefix cat");
		h.finder.setVisible(false);
		h.edit("cat");
		h.finder[action]("DOG");
		assert.equal(h.content(), "DOG");
	});

	test(`${action}: removed matches never modify unrelated text`, () => {
		const h = createFinder("a cat z");
		h.finder.setVisible(false);
		h.edit("a fox z");
		const result = h.finder[action]("DOG");
		assert.equal(h.content(), "a fox z");
		assert.equal(h.writes.length, 0);
		assert.equal(result.changed, false);
		assert.equal(result.beforeCount, 0);
		assert.deepEqual(h.finder.getSearchCache().matches, []);
	});

	test(`${action}: empty documents and empty queries cannot reuse old matches`, () => {
		for (const emptyQuery of [false, true]) {
			const h = createFinder("cat");
			if (emptyQuery) h.finder.getSearchCache().search = "";
			else h.edit("");
			const before = h.content();
			assert.equal(h.finder[action]("DOG").changed, false);
			assert.equal(h.content(), before);
			assert.equal(h.writes.length, 0);
		}
	});

	test(`${action}: a switched document cannot inherit previous offsets`, () => {
		const h = createFinder("old cat document");
		h.finder.setVisible(false);
		h.edit("cat in a new document");
		h.finder[action]("DOG");
		assert.equal(h.content(), "DOG in a new document");
	});

	test(`${action}: regex searches also refresh before writing`, () => {
		const h = createFinder("a cat z", "c.t", true);
		h.finder.setVisible(false);
		h.edit("prefix cat end");
		h.finder[action]("DOG");
		assert.equal(h.content(), "prefix DOG end");
	});

	test(`${action}: no active editor is a safe no-op`, () => {
		const h = createFinder("cat");
		h.removeEditor();
		assert.equal(h.finder[action]("DOG").changed, false);
		assert.equal(h.content(), "cat");
		assert.equal(h.writes.length, 0);
	});
}

test("single replacement resets an index invalidated by fewer matches", () => {
	const h = createFinder("cat cat");
	h.finder.getSearchCache().index = 1;
	h.edit("cat");
	h.finder.replaceMatchedText("DOG");
	assert.equal(h.content(), "DOG");
});

test("single replacement preserves a valid current match index", () => {
	const h = createFinder("cat cat");
	h.finder.getSearchCache().index = 1;
	h.edit("prefix cat cat");
	h.finder.replaceMatchedText("DOG");
	assert.equal(h.content(), "prefix cat DOG");
});

test("replace all includes newly added matches in one transaction", () => {
	const h = createFinder("cat");
	h.finder.setVisible(false);
	h.edit("cat plus cat plus cat");
	const result = h.finder.replaceAllMatchedText("DOG");
	assert.equal(h.content(), "DOG plus DOG plus DOG");
	assert.equal(result.beforeCount, 3);
	assert.equal(result.changeCount, 3);
	assert.equal(h.writes.length, 1);
});

for (const commandId of ["text-finder-replace", "text-finder-replace-all"]) {
	test(`${commandId}: registered commands use the guarded replacement action`, () => {
		const h = createFinder("a cat z");
		const commands = new Map();
		h.plugin.addCommand = (command) => commands.set(command.id, command);
		h.plugin.registerEvent = () => {};
		h.plugin.app.workspace.on = () => {};
		const { EditorSearch } = loadSource("../src/editor-extension.ts", {
			"@codemirror/state": { StateEffect: { define: () => ({}) } },
			"@codemirror/view": {},
			obsidian: { debounce: (fn) => fn },
			"./SearchBox.svelte": {},
			"./i18n": { i18n: { t: (key) => key } },
			"./util/common-helper": {},
			"./HistoryModal": {},
		});
		const editorSearch = new EditorSearch(h.plugin);
		editorSearch.getFinder = () => h.finder;
		h.finder.setVisible(false);
		h.finder.getSearchCache().replace = "DOG";
		h.edit("XXX a cat z");
		commands.get(commandId).editorCallback();
		assert.equal(h.content(), "XXX a DOG z");
	});
}
