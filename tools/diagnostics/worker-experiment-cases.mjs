// Full-source context and replacement templates, including non-recursive tokens.
export const workerCases = [
	["ABC abc", "abc", "X"],
	["foo\nbar", "^foo$\\nbar", "X"],
	["foobar foobar", "(?<=foo)bar", "$`-$&-$'"],
	["foobar", "foo(?=bar)", "X"],
	["xcat cat catx", "\\bcat\\b", "X"],
	["ab ab", "(a)(b)", "$2-$1"],
	["a ab", "(a)(b)?", "$2:$1"],
	["ab a", "(?<first>a)(?<second>b)?", "$<second>:$<first>:$<missing>"],
	["ab", "(a)b", "$<first>"],
	["ab ab", "ab", "$$:$&"],
	["ab ab", "(?<=(a))b", "$1$&"],
	["a", "(a)", "$0|$00|$01|$10|$12|$99|$2"],
	["abcdefghij", "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)", "$10$09$1"],
	["$1", "(\\$1)", "$1|$$1|$&"],
	["İ😀a😀a", "(?<=😀)(a)", "$1-$`-$'"],
	["abc", "^", "X"],
	["abc", "a|$", "X"],
	["😀", "(?=.)", "X"],
	["abc", "[", "X"],
	["abc", "", "X"],
	["", "a", "X"],
	["a a", "a", "\0\\n\\t\\\\$&"],
	["a\r\na\na", "^a$", "X"],
].map(([source, query, replacement]) => ({ source, query, replacement }));

export const snapshot = () => ({
	owner: "view-A",
	file: "note.md",
	documentVersion: 1,
	queryVersion: 1,
	lifecycle: 1,
});
