// Actual bundled probe plugin/UI with host stubs and Node-backed browser Worker.
// Exercises DOM/lifecycle, not Obsidian CSP or actual window migration.
import assert from "node:assert/strict";
import test from "node:test";
import { Worker as NodeWorker } from "node:worker_threads";
import { bundleSource } from "./bundle-source.mjs";
import { JSDOM } from "jsdom";
import { workerSource } from "./worker-experiment-source.mjs";

const bundle = await bundleSource({ entry: "tests/worker-probe-plugin.mjs", external: ["obsidian"],
	define: { __workerSource: JSON.stringify(workerSource("browser")), __probeBuild: JSON.stringify({ test: true }) } });

function environment(t) {
	t.mock.method(console, "info", () => {});
	const dom = new JSDOM("<!doctype html><body></body>");
	const win = dom.window; const blobs = new Map(), nodes = [], writes = [];
	let next = 0;
	win.Blob = class { constructor(parts) { this.source = parts.join(""); } };
	win.URL.createObjectURL = (blob) => { const url = `blob:test-${++next}`; blobs.set(url, blob.source); return url; };
	win.URL.revokeObjectURL = (url) => blobs.delete(url);
	win.Worker = class {
		constructor(url) {
			this.events = new Map();
			this.worker = new NodeWorker(`const {parentPort} = require('node:worker_threads');
				const self = {postMessage: (value, transfer) => parentPort.postMessage(value, transfer),
				addEventListener: (_type, fn) => parentPort.on('message', data => fn({data}))};\n${blobs.get(url)}`,
			{ eval: true, stdout: true, stderr: true });
			this.worker.stdout.resume(); this.worker.stderr.resume(); nodes.push(this);
			this.worker.on("message", (data) => this.events.get("message")?.forEach((fn) => fn({ data })));
			this.worker.on("error", (error) => this.events.get("error")?.forEach((fn) => fn({ message: error.message, preventDefault() {} })));
		}
		addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
		removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
		postMessage(request) { this.worker.postMessage({ ...request, delayMs: request.delayMs ? 20 : 0 }); }
		terminate() { this.termination = this.worker.terminate(); }
	};
	class MarkdownView {}
	const owner = new MarkdownView(); owner.file = { path: "test.md" };
	owner.containerEl = win.document.createElement("div");
	const doc = { toString: () => "cat cat" };
	owner.editor = { cm: { state: { doc }, dispatch: (spec) => writes.push(spec) } }; owner.getMode = () => "source";
	const events = new Map(); let leaves = [{ view: owner }]; const commands = new Map();
	const workspace = { getActiveViewOfType: () => owner, iterateAllLeaves: (fn) => leaves.forEach(fn),
		on(name, fn) { events.set(name, fn); return { name }; }, detachLeavesOfType() {} };
	class Plugin { registerView(type, factory) { this.factory = factory; } addCommand(cmd) { commands.set(cmd.id, cmd); } registerEvent() {} }
	class ItemView { constructor(leaf) { this.app = leaf.app; this.contentEl = win.document.createElement("div"); win.document.body.append(this.contentEl); } }
	const module = { exports: {} };
	new Function("require", "module", "exports", bundle)((name) => {
		assert.equal(name, "obsidian"); return { Plugin, ItemView, MarkdownView, Notice: class {}, apiVersion: "test-host" };
	}, module, module.exports);
	const plugin = new module.exports.default(); plugin.app = { workspace }; plugin.onload();
	const view = plugin.factory({ app: plugin.app });
	t.after(async () => { await view.onClose(); plugin.onunload(); await Promise.all(nodes.map((node) => node.termination ?? node.worker.terminate())); dom.window.close(); });
	return { dom, win, owner, view, plugin, events, blobs, nodes, writes, commands,
		closeOwner: () => { leaves = []; } };
}
function assertReleased(h) {
	assert.deepEqual(h.view.resources, { workers: 0, urls: 0, listeners: 0, intervals: 0, timers: 0 });
	assert.equal(h.blobs.size, 0);
	assert.ok(h.nodes.every((node) => [...node.events.values()].every((listeners) => listeners.size === 0)));
	assert.deepEqual(h.writes, []);
}

test("actual probe bundle performs 368 safe comparisons, releases resources and never writes the editor", async (t) => {
	t.mock.method(console, "log", () => {});
	const h = environment(t); await h.view.onOpen(); h.view.bind(h.owner);
	await h.view.run("safe", (client) => h.view.safe(client));
	assert.equal(h.view.lastReport.passed, true); assert.equal(h.view.lastReport.comparisons, 368);
	assertReleased(h);
});

test("probe delayed owner snapshot publishes only a count for the exact document", async (t) => {
	const h = environment(t); await h.view.onOpen(); h.view.bind(h.owner);
	const { captureOwner } = await import("./worker-probe-owner.mjs");
	const captured = captureOwner(h.plugin.app.workspace, h.owner, h.plugin.lifecycle, 1);
	await h.view.run("snapshot", async (client) => {
		const result = await client.submit({ operation: "match", source: captured.source, query: "cat", regexMode: false,
			caseSensitive: false, delayMs: 3000, snapshot: { owner: "A", file: "test.md", documentVersion: 1, queryVersion: 1, lifecycle: 1 } });
		return { status: result.status, count: result.result.matches.length };
	}, captured);
	assert.equal(h.view.lastReport.count, 2); assert.ok(!("source" in h.view.lastReport)); assertReleased(h);
});

for (const [reason, change] of [
	["document-changed", (h) => { h.owner.editor.cm.state.doc = { toString: () => "cat cat" }; h.events.get("editor-change")(); }],
	["file-changed", (h) => { h.owner.file = { path: "other.md" }; h.events.get("file-open")(); }],
	["owner-closed", (h) => { h.closeOwner(); h.events.get("layout-change")(); }],
	["query-changed", (h) => { h.view.query.dispatchEvent(new h.win.Event("input")); }],
]) {
	test(`probe UI cancels ${reason} and ignores late work`, async (t) => {
		const h = environment(t); await h.view.onOpen(); h.view.bind(h.owner);
		const { captureOwner } = await import("./worker-probe-owner.mjs");
		const captured = captureOwner(h.plugin.app.workspace, h.owner, h.plugin.lifecycle, 1);
		let result;
		const running = h.view.run("snapshot", async (client) => { result = await client.submit({ operation: "echo", source: "cat", snapshot: { owner: "A", file: "test.md", documentVersion: 1, queryVersion: 1, lifecycle: 1 }, delayMs: 3000 }); return result; }, captured);
		change(h); await running;
		assert.equal(result.status, "cancelled"); assert.equal(h.view.lastReport.reason, reason);
		assert.equal(h.view.lastReport.published, false); assertReleased(h);
	});
}

test("unload cancels pending probe, prevents late UI publication and releases every owned resource", async (t) => {
	t.mock.method(console, "info", () => {});
	const h = environment(t); await h.view.onOpen();
	let result;
	const running = h.view.run("pending", async (client) => { result = await client.submit({ operation: "echo", source: "cat", delayMs: 3000, snapshot: { owner: "A", file: "test.md", documentVersion: 1, queryVersion: 1, lifecycle: 1 } }); return result; });
	const before = h.view.output.value; h.plugin.onunload(); await running;
	assert.equal(result.reason, "plugin-unloaded"); assert.equal(h.view.output.value, before); assertReleased(h);
});

test("closing probe cancels before late completion and never rewrites removed controls", async (t) => {
	const h = environment(t); await h.view.onOpen();
	let result;
	const running = h.view.run("pending", async (client) => { result = await client.submit({ operation: "echo", source: "cat", delayMs: 3000,
		snapshot: { owner: "A", file: "test.md", documentVersion: 1, queryVersion: 1, lifecycle: 1 } }); return result; });
	await h.view.onClose(); await running;
	assert.equal(result.reason, "probe-closed"); assert.equal(h.view.contentEl.childNodes.length, 0); assertReleased(h);
});

test("owner window close terminates probe resources without waiting for a reply", async (t) => {
	const h = environment(t); await h.view.onOpen();
	let result;
	const running = h.view.run("pending", async (client) => { result = await client.submit({ operation: "echo", source: "cat", delayMs: 3000,
		snapshot: { owner: "A", file: "test.md", documentVersion: 1, queryVersion: 1, lifecycle: 1 } }); return result; });
	h.win.dispatchEvent(new h.win.Event("pagehide")); await running;
	assert.equal(result.reason, "window-closed"); assertReleased(h);
});
