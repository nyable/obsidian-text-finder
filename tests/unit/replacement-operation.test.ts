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
	expect(commitFailed).toHaveBeenCalledExactlyOnceWith({
		changed: true,
		complete: true,
		changeCount: 1,
	});
});

it.each([undefined, "readOnly"] as const)(
	"passes uncommitted refusal %s to the caller without rematching or navigating",
	(rejection) => {
		const snapshot = {
			view: {},
			editor: {},
			editorView: {},
			file: null,
			doc: { length: 3, toString: () => "cat" },
		};
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
		const refusal = {
			changed: false,
			complete: false,
			changeCount: 0,
			...(rejection ? { rejection } : {}),
		};
		const error = new Error("opaque host error"),
			failed = vi.fn(),
			commitFailed = vi.fn(),
			committed = vi.fn(() => snapshot),
			finish = vi.fn(() => true),
			match = vi.fn();
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
				commit() {
					throw error;
				},
				commitResult: () => refusal,
				committed,
				pending() {},
				finish,
				failed,
				clear() {},
				noChanges() {},
				commitFailed,
				replace: () => {
					throw new Error("sync path must not use Worker");
				},
				match,
			},
		);
		expect(result.changed).toBe(false);
		expect(result.changeCount).toBe(0);
		expect(failed).toHaveBeenCalledExactlyOnceWith(error, false);
		expect(commitFailed).toHaveBeenCalledExactlyOnceWith(refusal);
		expect(committed).not.toHaveBeenCalled();
		expect(finish).not.toHaveBeenCalled();
		expect(match).not.toHaveBeenCalled();
	},
);
