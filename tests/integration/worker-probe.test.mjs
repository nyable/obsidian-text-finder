import assert from "node:assert/strict";
import { test } from "vitest";
import { captureOwner, ownerInvalidation } from "../../tools/diagnostics/worker-probe-owner.mjs";
import { browserConnection } from "../../tools/diagnostics/worker-probe-connection.mjs";

function environment() {
	const win = { closed: false };
	const doc = { toString: () => "cat cat" };
	const view = {
		file: { path: "A.md" },
		editor: { cm: { state: { doc } } },
		containerEl: { ownerDocument: { defaultView: win } },
		getMode: () => "source",
	};
	let leaves = [{ view }];
	const workspace = { iterateAllLeaves: (fn) => leaves.forEach(fn) };
	return {
		view,
		win,
		doc,
		workspace,
		setLeaves: (value) => {
			leaves = value;
		},
	};
}

test("probe snapshot is bound to exact owner/document and not the active editor", () => {
	const h = environment(),
		other = environment();
	h.setLeaves([{ view: other.view }, { view: h.view }]);
	const captured = captureOwner(h.workspace, h.view, 1, 1);
	assert.equal(captured.doc, h.doc);
	assert.equal(captured.source, "cat cat");
	assert.equal(ownerInvalidation(h.workspace, captured, 1), null);
});

for (const [reason, change] of [
	["owner-closed", (h) => h.setLeaves([])],
	[
		"owner-window-changed",
		(h) => {
			h.view.containerEl.ownerDocument.defaultView = {};
		},
	],
	[
		"owner-window-changed",
		(h) => {
			h.win.closed = true;
		},
	],
	[
		"file-changed",
		(h) => {
			h.view.file = { path: "A.md" };
		},
	],
	[
		"file-changed",
		(h) => {
			h.view.file.path = "renamed.md";
		},
	],
	[
		"mode-changed",
		(h) => {
			h.view.getMode = () => "preview";
		},
	],
	[
		"editor-rebuilt",
		(h) => {
			h.view.editor = { cm: h.view.editor.cm };
		},
	],
	[
		"editor-rebuilt",
		(h) => {
			h.view.editor.cm = { state: { doc: h.doc } };
		},
	],
	[
		"document-changed",
		(h) => {
			h.view.editor.cm.state.doc = { toString: () => "cat cat" };
		},
	],
]) {
	test(`probe detects ${reason} even if path or text happens to be identical`, () => {
		const h = environment(),
			captured = captureOwner(h.workspace, h.view, 1, 1);
		change(h);
		assert.equal(ownerInvalidation(h.workspace, captured, 1), reason);
	});
}

test("lifecycle mismatch and unavailable contexts fail closed", () => {
	const h = environment(),
		captured = captureOwner(h.workspace, h.view, 1, 1);
	assert.equal(ownerInvalidation(h.workspace, captured, 2), "lifecycle-changed");
	h.view.getMode = () => "preview";
	assert.throws(() => captureOwner(h.workspace, h.view, 1, 1), /editing mode/);
	h.view.getMode = () => "source";
	h.view.editor.cm = null;
	assert.throws(() => captureOwner(h.workspace, h.view, 1, 1), /unavailable/);
});

function browser() {
	const revoked = [],
		workers = [];
	const win = {
		URL: { createObjectURL: () => "blob:test", revokeObjectURL: (url) => revoked.push(url) },
		Blob: class {},
		Worker: class {
			constructor() {
				workers.push(this);
				this.listeners = new Set();
			}
			addEventListener(type, listener) {
				this.listeners.add(listener);
			}
			removeEventListener(type, listener) {
				this.listeners.delete(listener);
			}
			terminate() {
				this.terminated = true;
			}
			postMessage() {}
		},
	};
	return { win, revoked, workers, resources: { workers: 0, urls: 0, listeners: 0 } };
}

test("probe browser transport releases listeners, worker and Blob URL idempotently", () => {
	const h = browser(),
		connection = browserConnection(h.win, "source", h.resources);
	const offMessage = connection.onMessage(() => {}),
		offError = connection.onError(() => {});
	assert.deepEqual(h.resources, { workers: 1, urls: 1, listeners: 3 });
	offMessage();
	offMessage();
	offError();
	offError();
	connection.terminate();
	connection.terminate();
	assert.deepEqual(h.resources, { workers: 0, urls: 0, listeners: 0 });
	assert.equal(h.workers[0].listeners.size, 0);
	assert.equal(h.workers[0].terminated, true);
	assert.deepEqual(h.revoked, ["blob:test"]);
});

test("Worker creation failure revokes the accepted Blob URL", () => {
	const h = browser();
	h.win.Worker = class {
		constructor() {
			throw new Error("CSP denied");
		}
	};
	assert.throws(() => browserConnection(h.win, "source", h.resources), /CSP denied/);
	assert.deepEqual(h.resources, { workers: 0, urls: 0, listeners: 0 });
	assert.equal(h.revoked.length, 1);
});
