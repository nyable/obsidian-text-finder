import assert from "node:assert/strict";
import { test } from "vitest";
import * as stateModule from "@codemirror/state";
import {
	searchCacheEffect,
	textMatchMarker,
	CLS,
} from "../../src/platform/codemirror/search-highlight";
const { EditorState } = stateModule;
const create = (doc = "cat cat") => EditorState.create({ doc, extensions: [textMatchMarker] });
const highlight = (state, overrides = {}) =>
	searchCacheEffect.of({
		doc: state.doc,
		visible: true,
		index: 0,
		matches: [
			{ from: 0, to: 3, index: 0 },
			{ from: 4, to: 7, index: 1 },
		],
		...overrides,
	});
const ranges = (state) => {
	const result = [];
	state
		.field(textMatchMarker)
		.between(0, state.doc.length, (from, to, mark) =>
			result.push({ from, to, class: mark.spec.class }),
		);
	return result;
};

test("highlight selects the current match and survives selection-only transactions", () => {
	let state = create();
	state = state.update({ effects: highlight(state, { index: 1 }) }).state;
	assert.deepEqual(
		ranges(state).map((range) => range.class),
		[CLS.MATCH, `${CLS.MATCH} ${CLS.MATCH_CURRENT}`],
	);
	const previous = state.field(textMatchMarker);
	state = state.update({ selection: { anchor: 2 } }).state;
	assert.equal(state.field(textMatchMarker), previous);
});

for (const changes of [
	{ from: 0, insert: "prefix " },
	{ from: 1, to: 2 },
	{ from: 0, to: 7 },
]) {
	test(`document changes clear highlights immediately: ${JSON.stringify(changes)}`, () => {
		let state = create();
		state = state.update({ effects: highlight(state) }).state;
		state = state.update({ changes }).state;
		assert.equal(ranges(state).length, 0);
	});
}

test("a late effect for an old document cannot restore stale highlights", () => {
	let state = create();
	const old = highlight(state);
	state = state.update({ changes: { from: 0, insert: "x" }, effects: old }).state;
	assert.equal(ranges(state).length, 0);
	state = state.update({
		effects: highlight(state, { matches: [{ from: 1, to: 4, index: 0 }] }),
	}).state;
	const current = ranges(state);
	state = state.update({ effects: old }).state;
	assert.deepEqual(ranges(state), current);
});

test("a document-changing transaction clears effects too; recompute after commit", () => {
	const state = EditorState.create({
		doc: "cat cat",
		extensions: [
			textMatchMarker,
			EditorState.transactionExtender.of((transaction) => ({
				effects: highlight(transaction.startState, {
					doc: transaction.newDoc,
					matches: [{ from: 1, to: 4, index: 0 }],
				}),
			})),
		],
	});
	const next = state.update({ changes: { from: 0, insert: "x" } }).state;
	assert.equal(ranges(next).length, 0);
	const refreshed = next.update({
		effects: highlight(next, { matches: [{ from: 1, to: 4, index: 0 }] }),
	}).state;
	assert.equal(ranges(refreshed).length, 1);
});

test("last valid effect wins, including hiding and clearing matches", () => {
	const state = create();
	for (const last of [{ visible: false }, { matches: [] }]) {
		const next = state.update({ effects: [highlight(state), highlight(state, last)] }).state;
		assert.equal(ranges(next).length, 0);
	}
});

test("invalid or unsorted ranges are ignored without throwing", () => {
	const state = create();
	const matches = [
		{ from: -1, to: 2 },
		{ from: 2, to: 2 },
		{ from: 3, to: 8 },
		{ from: 1.5, to: 3 },
		{ from: 4, to: 7 },
		{ from: 0, to: 3 },
	];
	const next = state.update({ effects: highlight(state, { matches }) }).state;
	assert.deepEqual(
		ranges(next).map(({ from, to }) => [from, to]),
		[[4, 7]],
	);
});

test("inverse and redo document transactions do not resurrect old decorations", () => {
	let state = create();
	state = state.update({ effects: highlight(state) }).state;
	const transaction = state.update({ changes: { from: 0, to: 3, insert: "dog" } });
	const inverse = transaction.changes.invert(state.doc);
	state = transaction.state;
	assert.equal(ranges(state).length, 0);
	state = state.update({ changes: inverse }).state;
	assert.equal(ranges(state).length, 0);
	state = state.update({ effects: highlight(state) }).state;
	assert.equal(ranges(state).length, 2);
	state = state.update({ changes: transaction.changes }).state;
	assert.equal(ranges(state).length, 0);
});
