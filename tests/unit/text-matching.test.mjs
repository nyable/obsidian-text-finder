import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
	findTextOffsets,
	prepareReplacements,
	findReplacementChanges,
} from "../../src/core/search/text-matching";

test("invalid regex diagnostics stay verbose-only and do not expose source or query", () => {
	const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	assert.deepEqual(findTextOffsets("private document", "[private query", true, false), []);
	assert.deepEqual(debug.mock.calls, [["Text Finder: matching failed", "SyntaxError"]]);
	assert.equal(log.mock.calls.length, 0);
});

test("whole word uses VS Code separator boundaries, including matched punctuation", () => {
	const cases = [
		["cat", "cat", 1],
		["(cat) cat-dog cat/dog", "cat", 3],
		["concatenate cat2 2cat cat_name name_cat", "cat", 0],
		["cat\tcat\ncat\r\ncat", "cat", 4],
		["中文 中文内容 内容中文 中文，内容", "中文", 1],
		["cat，cat cat\u00a0cat", "cat", 0],
		["C++ C++17 XC++", "C++", 2],
		["x.cat cat.x x.cat.x", ".cat", 2],
		["hello world! xhello world hello worldx", "hello world", 1],
		["!cat cat! x!x", "!", 3],
		["cat\ncat! xcat\ncat", "cat\ncat", 1],
		["x\ncat", "\ncat", 0],
		["cat\nx", "cat\n", 0],
		["x\ny", "\n", 0],
		[" \ncat", "\ncat", 1],
		["cat\n ", "cat\n", 1],
		["café xcafé caféx", "café", 1],
		["e\u0301 e\u0301x", "e\u0301", 1],
		["e\u0301", "e", 0],
		["😀 x😀 😀x", "😀", 1],
		["", "cat", 0],
		["cat", "", 0],
	];
	for (const [source, query, count] of cases)
		for (const caseSensitive of [false, true]) {
			const matches = findTextOffsets(source, query, false, caseSensitive, true);
			assert.equal(matches.length, count, JSON.stringify([source, query]));
			matches.forEach((match, index) => {
				assert.equal(match.index, index);
				assert.equal(source.slice(match.from, match.to), query);
			});
			assert.deepEqual(
				findTextOffsets(source, query, false, caseSensitive, false),
				findTextOffsets(source, query, false, caseSensitive),
			);
		}
	assert.deepEqual(findTextOffsets("İ 😀 cat CAT cat2", "cat", false, false, true), [
		{ from: 5, to: 8, index: 0 },
		{ from: 9, to: 12, index: 1 },
	]);
	assert.equal(findTextOffsets("cat CAT", "cat", false, true, true).length, 1);
});

test("whole word filters actual regex matches without changing captures or full-source templates", () => {
	vi.spyOn(console, "debug").mockImplementation(() => {});
	const source = "xcat cat Cat cat2";
	const query = "(?<first>c)(at)";
	const replacement = "$<first>:$2:$&:$$:$`:$'";
	const prepared = prepareReplacements(source, query, replacement, true, false, true);
	assert.deepEqual(prepared.matches, [
		{ from: 5, to: 8, index: 0 },
		{ from: 9, to: 12, index: 1 },
	]);
	assert.deepEqual(prepared.one(0), { from: 5, to: 8, insert: "c:at:cat:$:xcat : Cat cat2" });
	assert.deepEqual(prepared.one(1), { from: 9, to: 12, insert: "C:at:Cat:$:xcat cat : cat2" });
	assert.deepEqual(
		prepared.all(),
		findReplacementChanges(source, query, replacement, true, false, true),
	);
	assert.deepEqual(prepared.matches, findTextOffsets(source, query, true, false, true));
	assert.equal(
		prepareReplacements(source, "cat", "$1\\n", false, false, true).one(0).insert,
		"$1\\n",
	);
	assert.equal(findTextOffsets("cat xcat", "(?<=x)cat", true, false, true).length, 0);
	assert.equal(findTextOffsets("cat\nCAT", "^cat$", true, false, true).length, 2);
	assert.deepEqual(findTextOffsets("cat", "^|$", true, false, true), []);
	assert.deepEqual(findTextOffsets("cat", "[", true, false, true), []);
});

test("whole word recognizes every default separator and does not broaden Unicode whitespace", () => {
	for (const separator of "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/? \t\r\n") {
		assert.equal(
			findTextOffsets(`x${separator}cat${separator}x`, "cat", false, true, true).length,
			1,
			JSON.stringify(separator),
		);
	}
	for (const regular of [
		"_",
		"2",
		"中",
		"，",
		"。",
		"\u00a0",
		"\u2003",
		"\u0301",
		"😀",
		"\v",
		"\f",
	]) {
		assert.equal(
			findTextOffsets(`${regular}cat`, "cat", false, true, true).length,
			0,
			JSON.stringify(regular),
		);
		assert.equal(
			findTextOffsets(`cat${regular}`, "cat", false, true, true).length,
			0,
			JSON.stringify(regular),
		);
	}
});

test("case-insensitive literal search returns offsets in the original Unicode text", () => {
	assert.deepEqual(findTextOffsets("İxa", "x", false, false), [{ from: 1, to: 2, index: 0 }]);
	assert.deepEqual(findTextOffsets("İx", "x", false, false), [{ from: 1, to: 2, index: 0 }]);
});

test("ordinary search preserves case sensitivity and non-overlapping matches", () => {
	assert.deepEqual(findTextOffsets("AaA", "a", false, true), [{ from: 1, to: 2, index: 0 }]);
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
	for (const target of [
		".",
		"*",
		"+",
		"?",
		"^",
		"$",
		"{",
		"}",
		"(",
		")",
		"|",
		"[",
		"]",
		"\\",
		"a.b",
		"\\n",
	]) {
		const source = `İ ${target} end`;
		assert.deepEqual(
			findTextOffsets(source, target, false, false),
			[{ from: 2, to: 2 + target.length, index: 0 }],
			target,
		);
	}
});

test("Chinese, emoji, combining marks and newlines keep original UTF-16 offsets", () => {
	const source = "İ😀中文e\u0301\nX";
	for (const target of ["😀", "中文", "e\u0301", "\nX", "x"]) {
		const matches = findTextOffsets(source, target, false, false);
		assert.equal(matches.length, 1);
		assert.equal(
			source.slice(matches[0].from, matches[0].to).toLowerCase(),
			target.toLowerCase(),
		);
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
