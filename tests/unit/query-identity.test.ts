import { expect, it } from "vitest";
import {
	decodeReplacementEscapes,
	queryIdentity,
} from "../../src/features/finder/model/query-identity";

it("distinguishes full document, invalid scope, scope epoch and every option", () => {
	const options = { regexMode: false, caseSensitive: false, wholeWord: false };
	const identities = [
		queryIdentity("cat", options, 0, undefined),
		queryIdentity("cat", options, 0, []),
		queryIdentity("cat", options, 1, undefined),
		queryIdentity("cat", { ...options, wholeWord: true }, 0, undefined),
		queryIdentity("cat", { ...options, regexMode: true }, 0, undefined),
		queryIdentity("cat", { ...options, caseSensitive: true }, 0, undefined),
	];
	expect(new Set(identities).size).toBe(identities.length);
});

it("decodes once without reserving NUL or consuming unknown escapes", () => {
	expect(decodeReplacementEscapes("\0\\n\\q\\\\n", true)).toBe("\0\n\\q\\n");
	expect(decodeReplacementEscapes("\\n", false)).toBe("\\n");
});
