import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { scopeSource } from "./search-scope-source.mjs";
import { loadSource } from "./source-loader.mjs";

const { searchScopeField, searchScopeEffect, finderSelection, searchScopeDecoration } = scopeSource;
const helper = loadSource("../src/util/text-helper.ts");
const create = (doc = "cat A cat\ncat B cat", ranges = [{ from: 6, to: 13 }]) => {
	let state = EditorState.create({ doc, extensions: [searchScopeField, searchScopeDecoration, EditorState.allowMultipleSelections.of(true)] });
	return state.update({ effects: searchScopeEffect.of(ranges) }).state;
};
const ranges = (state) => state.field(searchScopeField).ranges;

test("scope retains exact cross-line characters and is independent of match selection", () => {
	let state = create();
	assert.deepEqual(ranges(state), [{ from: 6, to: 13 }]);
	state = state.update({ selection: { anchor: 0, head: 3 }, annotations: finderSelection.of(true) }).state;
	assert.deepEqual(ranges(state), [{ from: 6, to: 13 }]);
	assert.deepEqual(state.field(searchScopeField).candidate, []);
	state = state.update({ selection: { anchor: 9, head: 4 } }).state;
	assert.deepEqual(state.field(searchScopeField).candidate, [{ from: 4, to: 9 }]);
	assert.deepEqual(ranges(state), [{ from: 6, to: 13 }]);
	state = state.update({ selection: { anchor: 9 } }).state;
	assert.deepEqual(state.field(searchScopeField).candidate, [], "explicit cursor clears stale candidate");
});

test("scope maps edits before, inside and on both edges, including complete replacement and undo", () => {
	for (const [changes, expected] of [
		[{ from: 0, insert: "xx" }, [{ from: 8, to: 15 }]],
		[{ from: 7, insert: "xx" }, [{ from: 6, to: 15 }]],
		[{ from: 6, insert: "xx" }, [{ from: 6, to: 15 }]],
		[{ from: 13, insert: "xx" }, [{ from: 6, to: 15 }]],
		[{ from: 15, insert: "xx" }, [{ from: 6, to: 13 }]],
		[{ from: 6, to: 13, insert: "dog" }, [{ from: 6, to: 9 }]],
		[{ from: 6, to: 13 }, [{ from: 6, to: 6 }]],
	]) {
		const original = create(), transaction = original.update({ changes });
		assert.deepEqual(ranges(transaction.state), expected);
		const restored = transaction.state.update({ changes: transaction.changes.invert(original.doc) }).state;
		assert.deepEqual(ranges(restored), ranges(original));
	}
});

test("multiple scope ranges normalize overlaps but never concatenate gaps or adjacent selections", () => {
	assert.deepEqual(helper.normalizeSearchRanges([{ from: 4, to: 7 }, { from: 0, to: 2 }, { from: 1, to: 3 },
		{ from: 3, to: 4 }, { from: -1, to: 4 }, { from: 8, to: 8 }, { from: 8, to: 90 }], 10),
	[{ from: 0, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 7 }]);
	const state = create("cat cat cat", [{ from: 0, to: 3 }, { from: 8, to: 11 }]);
	assert.deepEqual(helper.findTextOffsets(state.doc.toString(), "cat", false, false, false, ranges(state)),
		[{ from: 0, to: 3, index: 0 }, { from: 8, to: 11, index: 1 }]);
	assert.deepEqual(helper.findTextOffsets("catcat", "catcat", false, false, false,
		[{ from: 0, to: 3 }, { from: 3, to: 6 }]), []);
});

test("deletion crossing a scope boundary invalidates it and undo never widens the scope", () => {
	for (const changes of [{ from: 0, to: 17 }, { from: 5, to: 8 }, { from: 12, to: 15, insert: "cat" }]) {
		const original = create(), transaction = original.update({ changes });
		assert.deepEqual(ranges(transaction.state), []);
		const restored = transaction.state.update({ changes: transaction.changes.invert(original.doc) }).state;
		assert.deepEqual(ranges(restored), []);
	}
});

test("range scanning retains full regex and word context and rejects crossing matches", () => {
	const find = (source, query, ranges, wholeWord = false) => helper.findTextOffsets(source, query, true, false, wholeWord, ranges);
	assert.deepEqual(find("aaa", "aa", [{ from: 1, to: 3 }]), [{ from: 1, to: 3, index: 0 }]);
	assert.deepEqual(find("foobar", "(?<=foo)bar", [{ from: 3, to: 6 }]), [{ from: 3, to: 6, index: 0 }]);
	assert.deepEqual(find("foobar", "^bar", [{ from: 3, to: 6 }]), []);
	assert.deepEqual(find("xcat", "cat", [{ from: 1, to: 4 }], true), []);
	assert.deepEqual(find("abcatZ", "abcatZ|cat", [{ from: 0, to: 5 }]), [{ from: 2, to: 5, index: 0 }]);
	assert.deepEqual(find("cat\ncat", "cat\\ncat", [{ from: 1, to: 7 }]), []);
	assert.deepEqual(find("cat", "cat", []), []);
	assert.deepEqual(find("cat", "cat", [{ from: 0, to: 99 }]), []);
});

test("scope replacement preserves original captures and prefix/suffix template context", () => {
	const prepared = helper.prepareReplacements("foo cat cat end", "(?<c>cat)", "$<c>:$`:$'", true, false, false,
		[{ from: 8, to: 11 }]);
	assert.deepEqual(prepared.matches, [{ from: 8, to: 11, index: 0 }]);
	assert.deepEqual(prepared.all(), [{ from: 8, to: 11, insert: "cat:foo cat : end" }]);
});

test("clearing scope removes decorations and fresh editor states never inherit a scope", () => {
	let state = create();
	assert.equal(state.facet(EditorView.decorations)[0].size, 1);
	state = state.update({ effects: searchScopeEffect.of(null) }).state;
	assert.equal(ranges(state), null); assert.equal(state.facet(EditorView.decorations)[0].size, 0);
	assert.equal(EditorState.create({ extensions: [searchScopeField] }).field(searchScopeField).ranges, null);
});
