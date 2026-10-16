import { expect, it, vi } from "vitest";
import { QueryLane, type QueryIntent } from "../../src/features/finder/application/query-lane";
import type { MatchResult } from "../../src/core/search/match-protocol";

function intent(): QueryIntent {
	return {
		context: {
			view: {},
			editor: {},
			editorView: {},
			file: null,
			doc: { length: 0, toString: () => "" },
		},
		key: "query",
		window: null,
		scroll: true,
		direction: 1,
	};
}
it("publishes only the accepted intent, preserving accumulated direction and pause semantics", async () => {
	const lane = new QueryLane(vi.fn()),
		publish = vi.fn();
	let resolve!: (result: MatchResult) => void;
	const pending = new Promise<MatchResult>((done) => {
		resolve = done;
	});
	const first = intent();
	lane.accept(first, pending, publish);
	first.direction += 2;
	expect(lane.pending?.direction).toBe(3);
	lane.pauseNavigation();
	expect(first.scroll).toBe(false);
	expect(first.direction).toBe(0);
	lane.cancel();
	const second = intent();
	lane.accept(
		second,
		Promise.resolve({ status: "completed", synchronous: false, matches: [] }),
		publish,
	);
	resolve({ status: "completed", synchronous: false, matches: [{ from: 0, to: 3, index: 0 }] });
	await pending;
	await Promise.resolve();
	expect(publish).toHaveBeenCalledOnce();
	expect(publish.mock.calls[0]?.[1]).toBe(second);
	expect(lane.pending).toBeNull();
});
it("preserves idle transport but cancels it for pending query or replacement work", () => {
	const lane = new QueryLane(vi.fn()),
		cancel = vi.fn();
	lane.use({ cancel, match: () => ({ status: "cancelled" }), destroy() {} });
	lane.cancel(true);
	expect(cancel).not.toHaveBeenCalled();
	lane.cancel(true, true);
	expect(cancel).toHaveBeenCalledOnce();
	lane.accept(intent(), new Promise(() => {}), vi.fn());
	lane.cancel(true);
	expect(cancel).toHaveBeenCalledTimes(2);
	expect(lane.pending).toBeNull();
});
it("publishes transport rejection as failure and reports publish defects without replay", async () => {
	const report = vi.fn(),
		lane = new QueryLane(report),
		publish = vi.fn();
	const failure = new Error("transport");
	lane.accept(intent(), Promise.reject(failure), publish);
	await Promise.resolve();
	await Promise.resolve();
	expect(publish).toHaveBeenCalledOnce();
	expect(publish.mock.calls[0]?.[0]).toEqual({ status: "failed", error: failure });
	const defect = new Error("publish");
	publish.mockImplementation(() => {
		throw defect;
	});
	lane.accept(intent(), Promise.resolve({ status: "cancelled" }), publish);
	await Promise.resolve();
	await Promise.resolve();
	expect(report).toHaveBeenCalledExactlyOnceWith(defect);
	expect(publish).toHaveBeenCalledTimes(2);
	expect(lane.pending).toBeNull();
});
