import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { loadSource } from "./source-loader.mjs";
import { matchEngineSource } from "./match-engine-source.mjs";
import { attachHistory, toolbarSource } from "./history-source.mjs";
import { scopeSource } from "./search-scope-source.mjs";

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
			state: EditorState.create({ doc: content }),
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
				this.state = this.state.update({ changes }).state;
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
	attachHistory(plugin);
	const finder = loadSource("../src/SearchBox.svelte", {
		svelte: { onMount() {}, tick: () => Promise.resolve() }, "./finder-position": {}, "./history": loadSource("../src/history.ts", { "./constants": loadSource("../src/constants.ts") }),
		"./toolbar": toolbarSource,
		"./i18n": { i18n: { t: (key) => key } },
		"./search-highlight": { ...scopeSource, searchCacheEffect: { of: (cache) => cache } },
		"./util/text-helper": helper,
		"./util/obsidian-internal": loadSource("../src/util/obsidian-internal.ts"),
		"./constants": loadSource("../src/constants.ts"),
		obsidian: { MarkdownView: class {}, Platform: { isMobile: false } },
	});
	finder.ownerView = view;
	finder.editorSearch = { plugin, getEditorContext: () => available ? {
		view, editor, editorView: editor.cm, file: null, doc: editor.cm.state.doc,
	} : null };
	finder.getSearchCache().options.regexMode = regexMode;
	finder.setFindText(search, false);
	return {
		finder,
		plugin,
		writes,
		content: () => content,
		edit: (value) => { content = value; editor.cm.state = EditorState.create({ doc: value }); },
		removeEditor: () => { available = false; },
	};
}

for (const action of ["replaceMatchedText", "replaceAllMatchedText"]) {
	for (const { source, search, replacement, expected, caseSensitive = false } of [
		{ source: "ABC abc", search: "abc", replacement: "X", expected: "X abc" },
		{ source: "ABC abc", search: "abc", replacement: "X", expected: "ABC X", caseSensitive: true },
		{ source: "foobar", search: "(?<=foo)bar", replacement: "X", expected: "fooX" },
		{ source: "foobar", search: "foo(?=bar)", replacement: "X", expected: "Xbar" },
		{ source: "foo\nbar", search: "^foo$\\nbar", replacement: "X", expected: "X" },
		{ source: "abc", search: "(a)(b)c", replacement: "$2$1", expected: "ba" },
		{ source: "abc", search: "(?<first>a)bc", replacement: "$<first>!", expected: "a!" },
		{ source: "abc", search: "b", replacement: "$`X$'", expected: "aaXcc" },
		{ source: "abc", search: "b", replacement: "$$$&", expected: "a$bc" },
	]) {
		test(`${action}: regex ${search} → ${replacement} (case-sensitive: ${caseSensitive})`, () => {
			const h = createFinder(source, search, true);
			h.finder.getSearchCache().options.caseSensitive = caseSensitive;
			const result = h.finder[action](replacement);
			assert.equal(h.content(), action === "replaceAllMatchedText" && source === "ABC abc" && !caseSensitive
				? "X X" : expected);
			assert.equal(result.changeCount, action === "replaceAllMatchedText" && source === "ABC abc" && !caseSensitive ? 2 : 1);
			assert.equal(h.writes.length, 1);
		});
	}

	test(`${action}: regex replacement escapes remain controlled by the setting`, () => {
		for (const enabled of [true, false]) {
			const h = createFinder("a", "(a)", true);
			h.plugin.settings.useEscapeCharInReplace = enabled;
			h.finder[action]("$1\\n\\t\\\\n");
			assert.equal(h.content(), enabled ? "a\n\t\\n" : "a\\n\\t\\\\n");
		}
	});

	for (const { name, replacement, expected } of [
		{ name: "real NUL", replacement: "\0", expected: "\0" },
		{ name: "NUL mixed with escapes", replacement: "\0\\n\\t\\\\\0", expected: "\0\n\t\\\0" },
		{ name: "escaped newline stays literal", replacement: "\\\\n", expected: "\\n" },
		{ name: "three backslashes before newline", replacement: "\\".repeat(3) + "n", expected: "\\\n" },
		{ name: "four backslashes before newline", replacement: "\\".repeat(4) + "n", expected: "\\\\n" },
		{ name: "unknown escapes", replacement: "\\r\\x00\\0", expected: "\\r\\x00\\0" },
		{ name: "trailing backslash", replacement: "tail\\", expected: "tail\\" },
		{ name: "capture template and NUL", replacement: "$1\0\\n", expected: "a\0\n" },
	]) {
		test(`${action}: replacement preserves ${name}`, () => {
			for (const regexMode of [true, false]) {
				for (const enabled of [true, false]) {
					const h = createFinder("a a", regexMode ? "(a)" : "a", regexMode);
					h.plugin.settings.useEscapeCharInReplace = enabled;
					h.finder[action](replacement);
					// Regex templates expand regardless of the backslash-escape setting.
					const insert = regexMode && enabled ? expected
						: regexMode ? replacement.replace("$1", "a") : replacement;
					assert.equal(h.content(), action === "replaceAllMatchedText" ? `${insert} ${insert}` : `${insert} a`);
					assert.equal(h.writes.length, 1);
				}
			}
		});
	}

	test(`${action}: literal replacement stays literal`, () => {
		const h = createFinder("a", "a");
		h.finder[action]("$&\\n");
		assert.equal(h.content(), "$&\\n");
	});

	test(`${action}: regex replacement revalidates changed context`, () => {
		const h = createFinder("foobar", "(?<=foo)bar", true);
		h.finder.setVisible(false);
		h.edit("xxxbar");
		assert.equal(h.finder[action]("X").changed, false);
		assert.equal(h.content(), "xxxbar");
		assert.equal(h.writes.length, 0);
	});

	test(`${action}: zero-width regex does not insert text`, () => {
		const h = createFinder("a", "^", true);
		assert.equal(h.finder[action]("X").changed, false);
		assert.equal(h.content(), "a");
		assert.equal(h.writes.length, 0);
	});

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

test("single replacement expands templates using the selected original match", () => {
	const h = createFinder("ab ab", "(a)b", true);
	h.finder.getSearchCache().index = 1;
	h.finder.replaceMatchedText("$`-$1-$'");
	assert.equal(h.content(), "ab ab -a-");
});

test("navigation can advance when the replacement still matches the query", async () => {
	const h = createFinder("a a", "a", true);
	h.plugin.settings.enableHistory = false;
	h.finder.replaceMatchedText("$&!");
	assert.equal(h.content(), "a! a");
	await h.finder.toNextMatch();
	assert.equal(h.finder.getSearchCache().index, 1);
	h.finder.replaceMatchedText("$&!");
	assert.equal(h.content(), "a! a!");
});

test("replace all calculates templates from one snapshot and does not reprocess inserts", () => {
	const h = createFinder("a a", "a", true);
	const result = h.finder.replaceAllMatchedText("$&a");
	assert.equal(h.content(), "aa aa");
	assert.equal(result.changeCount, 2);
	assert.equal(result.afterCount, 4);
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
			"./match-engine": matchEngineSource,
			"./search-highlight": {},
			obsidian: { MarkdownView: class {} },
			"./SearchBox.svelte": {},
			"./i18n": { i18n: { t: (key) => key } },
			"./util/common-helper": {},
			"./HistoryModal": {},
			"./reading-search": {},
		});
		const editorSearch = new EditorSearch(h.plugin);
		editorSearch.getCommandFinder = () => h.finder;
		h.finder.setVisible(false);
		h.finder.getSearchCache().replace = "DOG";
		h.edit("XXX a cat z");
		commands.get(commandId).editorCallback();
		assert.equal(h.content(), "XXX a DOG z");
	});
}
