// Optional host-method verification. Reads an installed ASAR; never evaluates
// the full application or accesses a real Vault. All filesystem I/O is in memory.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { __awaiter, __generator } from "tslib";
import { build } from "vite";
import { resolve } from "node:path";
import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";
import * as cmLanguage from "@codemirror/language";
import { root } from "../vite-build.mjs";
import { bundleSource } from "../build/bundle-source.mjs";
import { JSDOM } from "jsdom";

const asarPath = process.argv[2];
if (!asarPath)
	throw new Error("Usage: node tools/diagnostics/host-contract-check.mjs /path/to/obsidian.asar");
const archive = readFileSync(asarPath);
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const entry = header.files["app.js"];
assert.ok(entry, "Archive must contain app.js");
const start = 8 + archive.readUInt32LE(4) + Number(entry.offset);
const appSource = archive.subarray(start, start + entry.size).toString();

function method(name, anchor, endAnchor) {
	const start = appSource.indexOf(`.prototype.${name}=function`, appSource.indexOf(anchor));
	assert.ok(
		start >= 0 &&
			(endAnchor === undefined ||
				start < appSource.indexOf(endAnchor, appSource.indexOf(anchor))),
		`Missing host method ${name}`,
	);
	const fnStart = appSource.indexOf("function", start);
	// Parse only a small excerpt; the complete function is the first expression.
	const excerpt = ts.createSourceFile(
		"host.js",
		`(${appSource.slice(fnStart, fnStart + 16000)})`,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	let expression;
	const visit = (node) => {
		if (expression) return;
		if (ts.isFunctionExpression(node)) expression = node;
		else ts.forEachChild(node, visit);
	};
	visit(excerpt);
	assert.ok(expression, `${name} must be a function`);
	assert.ok(expression.end < 16000, `${name} exceeds extraction window`);
	const body = expression.getText(excerpt);
	return new Function("y", "b", "g", "Ul", `return (${body});`)(
		__awaiter,
		__generator,
		Object.assign,
		(stat) => ({ size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs }),
	);
}

// Discover the adapter region by its filesystem boundary, not minified class IDs.
const adapterAnchor = appSource.lastIndexOf(
	".prototype.read=function",
	appSource.indexOf('this.fsPromises.readFile(t,"utf8")'),
);
assert.ok(adapterAnchor >= 0, "Missing desktop adapter filesystem boundary");
const adapterRegion = appSource.slice(adapterAnchor, adapterAnchor + 200);
const methods = Object.fromEntries(
	["read", "write", "stat", "queue"].map((name) => [name, method(name, adapterRegion)]),
);
const storageBundle = await bundleSource({ entry: "src/platform/obsidian/settings-storage.ts" });
const storageModule = { exports: {} };
new Function("module", "exports", storageBundle)(storageModule, storageModule.exports);
const { SettingsStorage } = storageModule.exports;
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const missing = () => Object.assign(new Error("File missing"), { code: "ENOENT" });

function environment() {
	const disk = new Map();
	const writes = [];
	const errors = {};
	let beforeWrite = async () => {},
		afterStat = () => {};
	const adapter = {
		...methods,
		promise: Promise.resolve(),
		getFullPath: (path) => path,
		thingsHappening() {},
		applyWriteOptions: async () => {},
		reconcileInternalFile: async () => {},
		fsPromises: {
			stat: async (path) => {
				if (errors.stat) throw errors.stat;
				if (!disk.has(path)) throw missing();
				afterStat();
				return {
					isFile: () => true,
					isDirectory: () => false,
					size: 1,
					mtimeMs: 0,
					ctimeMs: 0,
				};
			},
			readFile: async (path) => {
				if (errors.read) throw errors.read;
				if (!disk.has(path)) throw missing();
				return disk.get(path);
			},
			writeFile: async (path, text) => {
				if (errors.write) throw errors.write;
				await beforeWrite();
				writes.push(JSON.parse(text));
				disk.set(path, text);
			},
		},
	};
	const app = {
		vault: { adapter, configDir: ".test-config" },
		workspace: {
			onLayoutReadyCallbacks: [],
			app: { plugins: { loadingPluginId: "text-finder" } },
			onLayoutReady: method("onLayoutReady", ".prototype.onLayoutReady=function"),
			on() {},
			iterateAllLeaves() {},
		},
	};
	return {
		app,
		disk,
		writes,
		errors,
		gateWrite: (fn) => {
			beforeWrite = fn;
		},
		afterStat: (fn) => {
			afterStat = fn;
		},
	};
}

const path = ".test-config/plugins/text-finder/data.json";
const h = environment();
const storage = new SettingsStorage(h.app, path);
assert.equal(await storage.read(), null);
h.disk.set(path, "{broken");
await assert.rejects(storage.read(), SyntaxError);
h.disk.set(path, "{}");
h.errors.stat = Object.assign(new Error("Permission denied"), { code: "EACCES" });
await assert.rejects(storage.read(), /Permission denied/);
delete h.errors.stat;
h.errors.read = new Error("Read denied");
await assert.rejects(storage.read(), /Read denied/);
delete h.errors.read;
h.errors.write = new Error("Disk full");
await assert.rejects(storage.write({ value: 1 }), /Disk full/);
delete h.errors.write;
await storage.write({ value: 2 });
assert.deepEqual(await storage.read(), { value: 2 });
h.afterStat(() => h.disk.delete(path));
await assert.rejects(storage.read(), /File missing/);
h.afterStat(() => {});

const gate = deferred(),
	started = deferred();
let first = true;
h.gateWrite(async () => {
	if (first) {
		first = false;
		started.resolve();
		await gate.promise;
	}
});
const accepted = [
	storage.write({ value: 3 }),
	storage.write({ value: 4 }),
	storage.write({ value: 5 }),
];
await started.promise;
storage.close();
const freshModule = { exports: {} };
new Function("module", "exports", storageBundle)(freshModule, freshModule.exports);
const FreshStorage = freshModule.exports.SettingsStorage;
const fresh = new FreshStorage(h.app, path);
const read = fresh.read();
gate.resolve();
assert.deepEqual(await read, { value: 5 });
await Promise.all(accepted);
await fresh.write({ value: "NEW" });
await assert.rejects(storage.write({ value: "OLD" }), /closed/);
assert.deepEqual(JSON.parse(h.disk.get(path)), { value: "NEW" });

let commands = 0,
	extensions = 0;
class Plugin {
	addSettingTab() {}
	registerEvent() {}
	addCommand() {
		commands++;
	}
	registerEditorExtension() {
		extensions++;
	}
}
const built = await build({
	configFile: resolve(root, "vite.config.mjs"),
	logLevel: "error",
	build: { write: false },
});
const code = (Array.isArray(built) ? built[0] : built).output.find(
	(file) => file.type === "chunk",
).code;
const modules = {
	obsidian: {
		Plugin,
		PluginSettingTab: class {
			constructor() {
				const dom = new JSDOM("<!doctype html><body></body>");
				hostWindows.push(dom);
				this.containerEl = dom.window.document.createElement("div");
			}
		},
		Modal: class {},
		MarkdownView: class {},
		Editor: class {},
		WorkspaceLeaf: class {},
		Menu: class {},
		moment: Object.assign(() => ({ format: () => "fixed", fromNow: () => "fixed" }), {
			locale: () => "en",
		}),
		normalizePath: (path) => path,
		Notice: class {},
	},
	"@codemirror/state": cmState,
	"@codemirror/view": cmView,
	"@codemirror/language": cmLanguage,
};
const hostWindows = [];
const pluginModule = { exports: {} };
new Function("module", "exports", "require", code)(pluginModule, pluginModule.exports, (name) => {
	assert.ok(name in modules, `Unexpected host external: ${name}`);
	return modules[name];
});
const TextFinderPlugin = pluginModule.exports;
function plugin(h) {
	const plugin = new TextFinderPlugin();
	plugin.app = h.app;
	plugin.manifest = { id: "text-finder" };
	plugin._loaded = true;
	plugin._children = [];
	plugin._events = [];
	plugin.unload = method(
		"unload",
		".prototype.onload=function(){}",
		".prototype.onunload=function(){}",
	);
	return plugin;
}
const lifecycle = environment();
const p = plugin(lifecycle);
await p.onload();
assert.equal(lifecycle.app.workspace.onLayoutReadyCallbacks.length, 2);
p.unload();
lifecycle.app.workspace.onLayoutReadyCallbacks.forEach(({ callback }) => callback());
assert.equal(p.editorSearch, null);
assert.equal(commands, 0);
assert.equal(extensions, 0);
const live = plugin(lifecycle);
await live.onload();
const callback = lifecycle.app.workspace.onLayoutReadyCallbacks.at(-1).callback;
callback();
callback();
assert.equal(commands, 12);
assert.equal(extensions, 1);
live.unload();

for (const failure of ["corrupt", "stat", "read", "race"]) {
	const h = environment();
	h.disk.set(path, failure === "corrupt" ? "{broken" : "{}");
	if (failure === "stat" || failure === "read")
		h.errors[failure] = new Error(`${failure} denied`);
	if (failure === "race") h.afterStat(() => h.disk.delete(path));
	const p = plugin(h);
	const errors = [];
	p.reportError = (key) => errors.push(key);
	await p.loadSettings();
	await assert.rejects(p.saveSettings(), /refusing to overwrite/);
	assert.equal(h.writes.length, 0);
	assert.ok(errors.every((key) => key === "history.LoadFailed"));
	p.unload();
}

const reload = environment();
const oldPlugin = plugin(reload);
await oldPlugin.onload();
const writeGate = deferred(),
	writeStarted = deferred();
let firstWrite = true;
reload.gateWrite(async () => {
	if (firstWrite) {
		firstWrite = false;
		writeStarted.resolve();
		await writeGate.promise;
	}
});
oldPlugin.history.record("A");
oldPlugin.history.record("B");
oldPlugin.history.record("C");
await writeStarted.promise;
oldPlugin.unload();
const newPlugin = plugin(reload);
const loading = newPlugin.onload();
writeGate.resolve();
await loading;
assert.deepEqual(
	newPlugin.history
		.sorted()
		.map((item) => item.text)
		.sort(),
	["A", "B", "C"],
);
newPlugin.history.record("NEW");
await newPlugin.flushSettings();
assert.ok(JSON.parse(reload.disk.get(path)).searchHistory.some((item) => item.text === "NEW"));
assert.equal(reload.writes.length, 4);
newPlugin.unload();
hostWindows.forEach((dom) => dom.window.close());

console.log(
	JSON.stringify(
		{
			hostAppSha256: createHash("sha256").update(appSource).digest("hex"),
			checks: [
				"missing/corrupt/permission/read/write errors",
				"stat-read race",
				"cross-module reload ordering",
				"real synchronous unload and late layout callback",
				"idempotent initialization",
				"plugin blocks writes after failed loads",
				"plugin history survives real host queue reload",
			],
			boundary:
				"Real extracted host methods; filesystem and UI services are in-memory substitutes, not GUI E2E",
		},
		null,
		2,
	),
);
