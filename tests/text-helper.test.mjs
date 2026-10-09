import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "./source-loader.mjs";

const { findTextOffsets } = loadSource("../src/util/text-helper.ts");

test("case-insensitive literal search returns offsets in the original Unicode text", () => {
	assert.deepEqual(findTextOffsets("İxa", "x", false, false), [
		{ from: 1, to: 2, index: 0 },
	]);
	assert.deepEqual(findTextOffsets("İx", "x", false, false), [
		{ from: 1, to: 2, index: 0 },
	]);
});

test("ordinary search preserves case sensitivity and non-overlapping matches", () => {
	assert.deepEqual(findTextOffsets("AaA", "a", false, true), [
		{ from: 1, to: 2, index: 0 },
	]);
	assert.deepEqual(findTextOffsets("AaA", "a", false, false), [
		{ from: 0, to: 1, index: 0 },
		{ from: 1, to: 2, index: 1 },
		{ from: 2, to: 3, index: 2 },
	]);
	assert.deepEqual(findTextOffsets("aaaa", "aa", false, false), [
		{ from: 0, to: 2, index: 0 },
		{ from: 2, to: 4, index: 1 },
	]);
});

test("all regex metacharacters remain literal in ordinary search", () => {
	for (const target of [".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "a.b", "\\n"]) {
		const source = `İ ${target} end`;
		assert.deepEqual(findTextOffsets(source, target, false, false), [
			{ from: 2, to: 2 + target.length, index: 0 },
		], target);
	}
});

test("Chinese, emoji, combining marks and newlines keep original UTF-16 offsets", () => {
	const source = "İ😀中文e\u0301\nX";
	for (const target of ["😀", "中文", "e\u0301", "\nX", "x"]) {
		const matches = findTextOffsets(source, target, false, false);
		assert.equal(matches.length, 1);
		assert.equal(source.slice(matches[0].from, matches[0].to).toLowerCase(), target.toLowerCase());
		assert.ok(matches[0].to <= source.length);
	}
});

test("empty input and absent literal matches return no ranges", () => {
	assert.deepEqual(findTextOffsets("", "x", false, false), []);
	assert.deepEqual(findTextOffsets("abc", "", false, false), []);
	assert.deepEqual(findTextOffsets("İx", "missing", false, false), []);
});

test("regex mode keeps its existing multiline and case behavior", () => {
	assert.deepEqual(findTextOffsets("A\na", "^a$", true, false), [
		{ from: 0, to: 1, index: 0 },
		{ from: 2, to: 3, index: 1 },
	]);
});
