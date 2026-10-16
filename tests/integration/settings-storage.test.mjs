import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { SettingsStorage } from "../../src/platform/obsidian/settings-storage";
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

test("new module instances read behind every accepted old write, even with a serial host adapter", async () => {
	let disk = '{"value":0}';
	const first = deferred();
	const started = deferred();
	const writes = [];
	let hostTail = Promise.resolve();
	const serial = (action) => {
		const result = hostTail.then(action);
		hostTail = result.catch(() => {});
		return result;
	};
	const app = {
		vault: {
			adapter: {
				stat: () => serial(async () => ({ type: "file" })),
				read: () => serial(async () => disk),
				write: (_path, text) =>
					serial(async () => {
						writes.push(JSON.parse(text).value);
						if (writes.length === 1) {
							started.resolve();
							await first.promise;
						}
						disk = text;
					}),
			},
		},
	};
	const old = new SettingsStorage(app, "data.json");
	const accepted = [old.write({ value: 1 }), old.write({ value: 2 }), old.write({ value: 3 })];
	await started.promise;
	old.close();
	vi.resetModules();
	const { SettingsStorage: FreshStorage } =
		await import("../../src/platform/obsidian/settings-storage");
	const fresh = new FreshStorage(app, "data.json");
	let loaded = false;
	const read = fresh.read().then((data) => {
		loaded = true;
		return data;
	});
	await Promise.resolve();
	assert.equal(loaded, false);
	first.resolve();
	assert.deepEqual(await read, { value: 3 });
	await fresh.write({ value: 4 });
	await Promise.all(accepted);
	await assert.rejects(old.write({ value: 5 }), /closed/);
	await fresh.flush();
	assert.deepEqual(writes, [1, 2, 3, 4]);
	assert.deepEqual(JSON.parse(disk), { value: 4 });
});

test("storage distinguishes absence, malformed JSON and I/O failures, and propagates writes", async () => {
	let exists = false;
	let failExists = false;
	let failRead = false;
	let failWrite = false;
	let text = "{broken";
	const app = {
		vault: {
			adapter: {
				stat: async () => {
					if (failExists) throw new Error("stat denied");
					return exists ? { type: "file" } : null;
				},
				read: async () => {
					if (failRead) throw new Error("read denied");
					return text;
				},
				write: async (_path, data) => {
					if (failWrite) throw new Error("disk full");
					text = data;
				},
			},
		},
	};
	const storage = new SettingsStorage(app, "data.json");
	assert.equal(await storage.read(), null);
	exists = true;
	await assert.rejects(storage.read(), SyntaxError);
	failExists = true;
	await assert.rejects(storage.read(), /stat denied/);
	failExists = false;
	const stat = app.vault.adapter.stat;
	app.vault.adapter.stat = async () => {
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	};
	assert.equal(await storage.read(), null);
	app.vault.adapter.stat = async () => ({ type: "folder" });
	await assert.rejects(storage.read(), /not a file/);
	app.vault.adapter.stat = stat;
	failRead = true;
	await assert.rejects(storage.read(), /read denied/);
	failRead = false;
	failWrite = true;
	await assert.rejects(storage.write({ value: 1 }), /disk full/);
	await assert.rejects(storage.flush(), /disk full/);
	failWrite = false;
	await storage.write({ value: 2 });
	assert.deepEqual(await storage.read(), { value: 2 });
});

test("snapshots are isolated and lanes are scoped by App and data path", async () => {
	const gate = deferred();
	let text;
	const app = {
		vault: {
			adapter: {
				write: async (_path, data) => {
					await gate.promise;
					text = data;
				},
			},
		},
	};
	const storage = new SettingsStorage(app, "one");
	const value = { nested: [1] };
	const write = storage.write(value);
	value.nested.push(2);
	let otherWritten = false;
	const other = new SettingsStorage(
		{
			vault: {
				adapter: {
					write: async () => {
						otherWritten = true;
					},
				},
			},
		},
		"one",
	);
	await other.write({});
	assert.equal(otherWritten, true);
	gate.resolve();
	await write;
	assert.deepEqual(JSON.parse(text), { nested: [1] });
});

test("different paths in the same App do not share a blocked plugin lane", async () => {
	const gate = deferred();
	const writes = [];
	const app = {
		vault: {
			adapter: {
				write: async (path) => {
					if (path === "one") await gate.promise;
					writes.push(path);
				},
			},
		},
	};
	const first = new SettingsStorage(app, "one"),
		second = new SettingsStorage(app, "two");
	const blocked = first.write({});
	await second.write({});
	assert.deepEqual(writes, ["two"]);
	gate.resolve();
	await blocked;
	assert.deepEqual(writes, ["two", "one"]);
});

test("a failed old write does not poison a fresh read or silently replay the failed snapshot", async () => {
	let disk = '{"value":"persisted"}';
	let fail = true;
	const writes = [];
	const app = {
		vault: {
			adapter: {
				stat: async () => ({ type: "file" }),
				read: async () => disk,
				write: async (_path, text) => {
					if (fail) throw new Error("disk failed");
					writes.push(JSON.parse(text));
					disk = text;
				},
			},
		},
	};
	const old = new SettingsStorage(app, "data.json");
	await assert.rejects(old.write({ value: "unsaved" }), /disk failed/);
	old.close();
	vi.resetModules();
	const { SettingsStorage: FreshStorage } =
		await import("../../src/platform/obsidian/settings-storage");
	const fresh = new FreshStorage(app, "data.json");
	assert.deepEqual(await fresh.read(), { value: "persisted" });
	fail = false;
	await fresh.write({ value: "NEW" });
	await fresh.flush();
	assert.deepEqual(writes, [{ value: "NEW" }]);
});

test("flush includes writes accepted while waiting and reports the last write failure", async () => {
	const gate = deferred();
	const started = deferred();
	const writes = [];
	const storage = new SettingsStorage(
		{
			vault: {
				adapter: {
					write: async (_path, text) => {
						const { value } = JSON.parse(text);
						writes.push(value);
						if (value === 1) {
							started.resolve();
							await gate.promise;
						}
						if (value === 2) throw new Error("last write failed");
					},
				},
			},
		},
		"flush-during-write",
	);
	const first = storage.write({ value: 1 });
	await started.promise;
	const flushing = assert.rejects(storage.flush(), /last write failed/);
	const second = assert.rejects(storage.write({ value: 2 }), /last write failed/);
	gate.resolve();
	await Promise.all([first, second, flushing]);
	assert.deepEqual(writes, [1, 2]);
	await storage.write({ value: 3 });
	await storage.flush();
	assert.deepEqual(writes, [1, 2, 3]);
});
