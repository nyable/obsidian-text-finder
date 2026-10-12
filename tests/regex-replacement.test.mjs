import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { loadSource } from "./source-loader.mjs";

const { findReplacementChanges, findTextOffsets, prepareReplacements } = loadSource("../src/util/text-helper.ts");

test("single replacement lazily expands only its chosen original match", (t) => {
	let expansions = 0;
	const original = String.prototype.replace;
	t.mock.method(String.prototype, "replace", function (...args) {
		if (String(this) === "$'") expansions++;
		return original.apply(this, args);
	});
	const prepared = prepareReplacements("a".repeat(2000), "a", "$'", true, true);
	assert.equal(prepared.matches.length, 2000);
	assert.equal(expansions, 0);
	assert.equal(prepared.one(1000).insert.length, 999);
	assert.equal(expansions, 1);
	assert.equal(prepared.one(-1), undefined);
	assert.equal(prepared.all().length, 2000);
	assert.equal(expansions, 2001);
});

function applyChanges(source, changes) {
	for (const { from, to, insert } of [...changes].reverse()) {
		source = source.slice(0, from) + insert + source.slice(to);
	}
	return source;
}

const cases = [
	{ name: "ignore case", source: "ABC abc", pattern: "abc", replacement: "X" },
	{ name: "match case", source: "ABC abc", pattern: "abc", replacement: "X", caseSensitive: true },
	{ name: "multiline anchors", source: "foo\nbar", pattern: "^foo$\\nbar", replacement: "X" },
	{ name: "line starts", source: "A\na", pattern: "^a$", replacement: "X" },
	{ name: "lookbehind", source: "foobar foobar", pattern: "(?<=foo)bar", replacement: "X" },
	{ name: "lookahead", source: "foobar foobar", pattern: "foo(?=bar)", replacement: "X" },
	{ name: "word boundary", source: "xcat cat catx", pattern: "\\bcat\\b", replacement: "X" },
	{ name: "numbered groups", source: "ab ab", pattern: "(a)(b)", replacement: "$2-$1" },
	{ name: "unmatched groups", source: "a ab", pattern: "(a)(b)?", replacement: "$2:$1" },
	{ name: "named groups", source: "ab a", pattern: "(?<first>a)(?<second>b)?", replacement: "$<second>:$<first>:$<missing>" },
	{ name: "named token without named groups", source: "ab", pattern: "(a)b", replacement: "$<first>" },
	{ name: "dollar and entire match", source: "ab ab", pattern: "ab", replacement: "$$:$&" },
	{ name: "prefix and suffix", source: "abc abc", pattern: "b", replacement: "$`-X-$'" },
	{ name: "lookaround captures", source: "ab ab", pattern: "(?<=(a))b", replacement: "$1$&" },
	{ name: "unavailable and fallback groups", source: "a", pattern: "(a)", replacement: "$0|$00|$01|$10|$12|$99|$2" },
	{ name: "two-digit group", source: "abcdefghij", pattern: "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)", replacement: "$10$09$1" },
	{ name: "substitutions are not recursively expanded", source: "$1", pattern: "(\\$1)", replacement: "$1|$$1|$&" },
	{ name: "UTF-16 context", source: "İ😀a😀a", pattern: "(?<=😀)(a)", replacement: "$1-$`-$'" },
];

for (const { name, source, pattern, replacement, caseSensitive = false } of cases) {
	test(`regex changes agree with native String.replace: ${name}`, () => {
		const changes = findReplacementChanges(source, pattern, replacement, true, caseSensitive);
		const expected = source.replace(new RegExp(pattern, "gm" + (caseSensitive ? "" : "i")), replacement);
		assert.equal(applyChanges(source, changes), expected);
		assert.deepEqual(changes.map(({ from, to }, index) => ({ from, to, index })),
			findTextOffsets(source, pattern, true, caseSensitive));
	});
}

test("literal replacements do not expand dollar templates or backslash escapes", () => {
	const source = "a a";
	const replacement = "$1$&$$\\n";
	assert.equal(applyChanges(source, findReplacementChanges(source, "a", replacement, false, false)),
		`${replacement} ${replacement}`);
});

test("zero-width regex matches remain excluded from both search and replacement", () => {
	for (const pattern of ["^", "$", "\\b", "(?=a)", "a|$"]) {
		const changes = findReplacementChanges("abc", pattern, "X", true, true);
		assert.ok(changes.every(({ from, to }) => from < to));
		assert.deepEqual(changes.map(({ from, to }, index) => ({ from, to, index })),
			findTextOffsets("abc", pattern, true, true));
	}
	assert.deepEqual(findReplacementChanges("abc", "^", "X", true, true), []);
});

test("invalid regex and empty inputs produce no replacement changes", (t) => {
	t.mock.method(console, "log", () => {});
	assert.deepEqual(findReplacementChanges("abc", "[", "X", true, true), []);
	assert.deepEqual(findReplacementChanges("abc", "", "X", true, true), []);
	assert.deepEqual(findReplacementChanges("", "a", "X", true, true), []);
});

test("replace-all changes form one invertible CodeMirror transaction", () => {
	const source = "foobar foobar";
	const state = EditorState.create({ doc: source });
	const changes = findReplacementChanges(source, "(?<=foo)(bar)", "$1!", true, true);
	const transaction = state.update({ changes });
	assert.equal(transaction.state.doc.toString(), "foobar! foobar!");
	const inverse = transaction.changes.invert(state.doc);
	const restored = transaction.state.update({ changes: inverse }).state;
	assert.equal(restored.doc.toString(), source);
});

test("capture template edge cases agree with native replacement", () => {
	for (const pattern of ["a", "(a)", "(a)(z)?", "(?<value>a)", "(?<value>a)(z)?"]) {
		for (const replacement of ["$", "$$$", "$$$$&", "$<>", "$<value>", "$<missing>", "$<unterminated", "$000", "$001", "$02", "$20", "$99", "$100", "$123", "$$$1", "$`$&$'"]) {
			const source = "ba!";
			assert.equal(applyChanges(source, findReplacementChanges(source, pattern, replacement, true, true)),
				source.replace(new RegExp(pattern, "gm"), replacement), `${pattern}: ${replacement}`);
		}
	}
});
