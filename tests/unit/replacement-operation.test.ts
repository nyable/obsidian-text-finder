import { expect, it, vi } from "vitest";
import {
	runReplacement,
	type ReplacementTask,
} from "../../src/features/finder/application/replacement-operation";
import type { ReplaceResult } from "../../src/core/search/types";

it("does not offer a second write when a host callback throws after committing", () => {
	const doc = { length: 3, toString: () => "cat" };
	const snapshot = { view: {}, editor: {}, editorView: {}, file: null, doc };
	const task: ReplacementTask = {
		context: snapshot,
		key: "query",
		window: null,
		path: undefined,
		replace: "dog",
		escape: false,
		phase: "prepare",
		scopeEpoch: 0,
		searchKey: "cat",
	};
	const result: ReplaceResult = {
		changed: false,
		changeCount: 0,
		search: "cat",
		replace: "dog",
		beforeCount: 0,
		afterCount: 0,
	};
	const commit = vi.fn(() => {
			throw new Error("host callback after commit");
		}),
		failed = vi.fn(),
		commitFailed = vi.fn();
	runReplacement(
		task,
		"cat",
		{ regexMode: false, caseSensitive: false, wholeWord: false },
		"dog",
		0,
		false,
		true,
		result,
		{
			current: () => true,
			ranges: () => undefined,
			prepared() {},
			commit,
			commitResult: () => ({ changed: true, complete: true, changeCount: 1 }),
			committed: () => snapshot,
			pending() {},
			finish: () => true,
			failed,
			clear() {},
			noChanges() {},
			commitFailed,
			replace: () => {
				throw new Error("sync path must not use Worker");
			},
			match: () => {
				throw new Error("must not rematch after commit exception");
			},
		},
	);
	expect(commit).toHaveBeenCalledOnce();
	expect(result.changed).toBe(true);
	expect(result.changeCount).toBe(1);
	expect(task.phase).toBe("prepare");
	expect(failed).toHaveBeenCalledWith(expect.any(Error), true);
	expect(commitFailed).toHaveBeenCalledOnce();
});
