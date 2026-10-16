import { describe, expect, it } from "vitest";
import { findTextOffsets, prepareReplacements } from "../../src/core/search/text-matching";

describe("production matching contracts", () => {
	it("retains UTF-16 offsets without changing Unicode source", () => {
		expect(findTextOffsets("İ 😀 cat CAT cat2", "cat", false, false, true)).toEqual([
			{ from: 5, to: 8, index: 0 },
			{ from: 9, to: 12, index: 1 },
		]);
	});
	it("expands regex replacement in full source context", () => {
		const prepared = prepareReplacements(
			"xcat cat cat2",
			"(cat)",
			"$1:$`:$'",
			true,
			false,
			true,
		);
		expect(prepared.matches).toEqual([{ from: 5, to: 8, index: 0 }]);
		expect(prepared.one(0)).toEqual({ from: 5, to: 8, insert: "cat:xcat : cat2" });
	});
});
