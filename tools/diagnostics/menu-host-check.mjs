// Optional read-only host-method check; never boots Obsidian or modifies a Vault.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";

const path = process.argv[2];
if (!path)
	throw new Error("Usage: node tools/diagnostics/menu-host-check.mjs /path/to/obsidian.asar");
const archive = readFileSync(path),
	header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const entry = header.files["app.js"];
assert.ok(entry);
const start = 8 + archive.readUInt32LE(4) + Number(entry.offset),
	source = archive.subarray(start, start + entry.size).toString();
const match = /([\w$]+)\.forEvent=function\([^)]*\)\{[^;]+;var ([\w$]+)=([\w$]+)\.get\(/.exec(
	source,
);
assert.ok(match, "Host event-menu bridge must exist");
const expression = source.indexOf("function", match.index);
const ast = ts.createSourceFile(
	"host.js",
	`(${source.slice(expression, expression + 2000)})`,
	ts.ScriptTarget.Latest,
	true,
);
let fn;
const visit = (node) => {
	if (fn) return;
	if (ts.isFunctionExpression(node)) fn = node;
	else ts.forEachChild(node, visit);
};
visit(ast);
assert.ok(fn && fn.end < 2000);
class Menu {
	shows = [];
	showAtMouseEvent(event) {
		this.shows.push(event);
	}
}
const forEvent = new Function(match[1], match[3], `return (${fn.getText(ast)});`)(
	Menu,
	new WeakMap(),
);
const pending = [],
	event = {
		prevented: 0,
		preventDefault() {
			this.prevented++;
		},
		win: { setTimeout: (fn) => pending.push(fn) },
	};
const a = forEvent(event),
	b = forEvent(event);
assert.equal(a, b, "Link handler and plugin must join the same event menu");
assert.equal(pending.length, 1);
pending.shift()();
assert.deepEqual(a.shows, [event]);
assert.equal(event.prevented, 2);
const other = { ...event };
assert.notEqual(forEvent(other), a);
assert.match(
	source,
	/workspace\.trigger\("file-menu",\w+,\w+,\w+,this\.leaf\)/,
	"Pane file-menu passes the exact leaf",
);
assert.match(
	source,
	/onPaneMenu\(\w+,"more-options"\)/,
	"More-options source is forwarded to pane menu",
);
assert.ok(
	source.includes(".document-search-input") ||
		source.includes("search-input-container document-search-input"),
	"Owner native-search input bridge exists",
);
console.log(
	JSON.stringify(
		{
			hostAppSha256: createHash("sha256").update(source).digest("hex"),
			checks: [
				"event-menu identity reuse",
				"one deferred display",
				"file-menu leaf ownership",
				"more-options source",
				"native query input shape",
			],
			boundary:
				"Real extracted Menu.forEvent; DOM, event propagation and GUI are not exercised",
		},
		null,
		2,
	),
);
