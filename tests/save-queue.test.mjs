import assert from "node:assert/strict";
import test from "node:test";
import { queueSource } from "./history-source.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("writes are serialized and capture isolated snapshots before waiting", async () => {
	const writes = [];
	const pending = [];
	const queue = new queueSource.SaveQueue((snapshot) => {
		writes.push(snapshot); const job = deferred(); pending.push(job); return job.promise;
	});
	const value = { searchHistory: [{ text: "A" }], enabled: true };
	const a = queue.enqueue(value);
	value.searchHistory[0].text = "B";
	const b = queue.enqueue(value);
	value.enabled = false;
	const c = queue.enqueue(value);
	value.searchHistory[0].text = "C";
	await settle();
	assert.deepEqual(writes, [{ searchHistory: [{ text: "A" }], enabled: true }]);
	pending[0].resolve(); await a; await settle();
	assert.deepEqual(writes[1], { searchHistory: [{ text: "B" }], enabled: true });
	pending[1].resolve(); await b; await settle();
	assert.deepEqual(writes[2], { searchHistory: [{ text: "B" }], enabled: false });
	pending[2].resolve(); await c; await queue.flush();
});

test("one failure rejects its caller but does not poison later saves", async () => {
	const failure = new Error("disk failed");
	const writes = [];
	const queue = new queueSource.SaveQueue(async (snapshot) => { writes.push(snapshot); if (snapshot === "A") throw failure; });
	const a = queue.enqueue("A");
	const b = queue.enqueue("B");
	await assert.rejects(a, failure);
	await b; await queue.flush();
	assert.deepEqual(writes, ["A", "B"]);
});

test("flush includes jobs added while waiting and reports final failure", async () => {
	const first = deferred();
	const queue = new queueSource.SaveQueue((value) => value === "A" ? first.promise : Promise.reject(new Error("last failed")));
	queue.enqueue("A");
	const flushing = queue.flush();
	const failed = queue.enqueue("B");
	const check = assert.rejects(failed, /last failed/);
	first.resolve();
	await check;
	await assert.rejects(flushing, /last failed/);
});
