import assert from "node:assert/strict";
import { test, vi, onTestFinished } from "vitest";
import { JSDOM } from "jsdom";
import { EditorSearch } from "../../src/app/workspace-runtime";
import { MarkdownView, Notice } from "../support/obsidian-host.mjs";
import { mountFinder } from "../../src/features/finder/ui/mount-finder";
vi.mock("../../src/features/finder/ui/mount-finder", () => ({ mountFinder: vi.fn() }));
vi.mock("../../src/platform/browser/match-engine", () => ({
	MatchEngine: class {
		constructor() {
			throw new Error("automatic entry must not create a match engine");
		}
	},
}));
vi.mock("../../src/i18n", () => ({ i18n: { t: (key) => key } }));

function environment(_t, enabled = true) {
	const dom = new JSDOM("<!doctype html><body></body>");
	onTestFinished(() => dom.window.close());
	const events = new Map(),
		commands = new Map(),
		finders = [],
		notices = [];
	const view = (path = "a.md", mode = "source") => {
		const owner = new MarkdownView();
		owner.file = path ? { path } : null;
		owner.containerEl = dom.window.document.createElement("div");
		dom.window.document.body.append(owner.containerEl);
		owner.getMode = () => mode;
		owner.editor = { getSelection: () => "selected", cm: { state: { doc: {} } } };
		owner.showSearch = () => notices.push("native");
		return owner;
	};
	const a = view(),
		b = view("a.md", "preview");
	let leaves = [{ view: a }, { view: b }],
		active = a;
	class Finder {
		constructor({ props }) {
			this.owner = props.owner;
			this.visible = false;
			this.docked = false;
			this.entries = 0;
			this.refreshes = 0;
			finders.push(this);
		}
		isVisible() {
			return this.visible;
		}
		isDocked() {
			return this.docked;
		}
		showFloatingEntry() {
			this.visible = this.docked = true;
			this.entries++;
		}
		matchAgain() {
			this.refreshes++;
		}
		setVisible(flag, query) {
			this.visible = flag;
			this.docked = false;
			this.query = query;
		}
		closeFinder() {
			this.visible = this.docked = false;
		}
		showReplace(query) {
			this.replaceQuery = query;
		}
		toggleReplaceFromCommand() {
			this.replaceToggles = (this.replaceToggles ?? 0) + 1;
		}
		destroy() {
			this.destroyed = true;
		}
	}
	const plugin = {
		settings: { showFloatingFinderOnOpen: enabled, useSelectionAsSearch: true },
		app: {
			workspace: {
				iterateAllLeaves: (fn) => leaves.forEach(fn),
				getActiveViewOfType: () => active,
				on: (name, callback) => {
					events.set(name, callback);
					return {};
				},
			},
		},
		registerEvent() {},
		addCommand: (command) => commands.set(command.id, command),
	};
	vi.mocked(mountFinder).mockImplementation((target, props) => new Finder({ target, props }));
	vi.spyOn(Notice, "notify").mockImplementation((text) => notices.push(text));
	const search = new EditorSearch(plugin);
	onTestFinished(() => search.dispose());
	return {
		search,
		plugin,
		a,
		b,
		view,
		finders,
		events,
		commands,
		notices,
		setLeaves: (value) => {
			leaves = value.map((view) => ({ view }));
		},
		activate: (view) => {
			active = view;
			events.get("active-leaf-change")({ view });
		},
	};
}

test("opening default initializes each already open Markdown owner independently without search engines", (t) => {
	const h = environment(t);
	assert.equal(h.finders.length, 2);
	assert.notEqual(h.finders[0], h.finders[1]);
	assert.deepEqual(
		h.finders.map((finder) => [finder.owner, finder.entries, finder.docked]),
		[
			[h.a.containerEl, 1, true],
			[h.b.containerEl, 1, true],
		],
	);
	assert.ok(
		[...h.search.owners.entries()].every(
			([, resources]) => !resources.matcher && !resources.reading,
		),
	);
	assert.equal(h.notices.length, 0);
});

test("default off stays lazy, enabling initializes existing notes and disabling never hides them", (t) => {
	const h = environment(t, false);
	h.events.get("file-open")();
	h.events.get("layout-change")();
	h.activate(h.b);
	assert.equal(h.finders.length, 0);
	h.plugin.settings.showFloatingFinderOnOpen = true;
	h.search.syncFloatingEntries();
	assert.equal(h.finders.length, 2);
	h.plugin.settings.showFloatingFinderOnOpen = false;
	const c = h.view("c.md");
	h.setLeaves([h.a, h.b, c]);
	h.events.get("file-open")();
	assert.equal(h.finders.length, 2);
	assert.ok(h.finders.every((finder) => finder.visible));
});

test("closed entry stays closed across activation, mode and layout; another file can show it again", (t) => {
	const h = environment(t),
		finder = h.finders[0];
	finder.closeFinder();
	h.activate(h.a);
	h.events.get("file-open")();
	h.events.get("layout-change")();
	h.a.getMode = () => "preview";
	h.activate(h.a);
	assert.equal(finder.visible, false);
	assert.equal(finder.entries, 1);
	h.a.file = { path: "other.md" };
	h.events.get("file-open")();
	assert.equal(finder.visible, true);
	assert.equal(finder.entries, 2);
	finder.setVisible(true);
	h.a.file = { path: "third.md" };
	h.events.get("file-open")();
	assert.equal(
		finder.docked,
		false,
		"opening another note must not collapse an existing expanded session",
	);
	assert.equal(finder.entries, 2);
});

test("new split gets its own entry, non-Markdown and empty views are skipped; close/unload cleans up", (t) => {
	const h = environment(t),
		c = h.view("a.md"),
		empty = h.view(null);
	h.setLeaves([h.a, h.b, c, empty, { file: { path: "canvas.canvas" } }]);
	h.events.get("layout-change")();
	assert.equal(h.finders.length, 3);
	assert.equal(h.finders[2].owner, c.containerEl);
	h.setLeaves([h.b, c]);
	h.events.get("layout-change")();
	assert.equal(h.finders[0].destroyed, true);
	assert.equal(
		[...h.search.owners.entries()].filter(([, resources]) => resources.finder).length,
		2,
	);
	h.search.dispose();
	h.events.get("layout-change")();
	h.events.get("file-open")();
	h.activate(h.b);
	h.search.syncFloatingEntries();
	assert.equal(h.finders.length, 3);
	assert.ok(h.finders.every((finder) => finder.destroyed));
	assert.equal([...h.search.owners.entries()].length, 0);
});

test("replacement UI commands route only to the editable owner and availability checks never act", (t) => {
	const h = environment(t),
		finder = h.finders[0];
	const show = h.commands.get("text-finder-show-find-and-replace"),
		toggle = h.commands.get("text-finder-toggle-replace");
	show.editorCallback(h.a.editor, h.a);
	assert.equal(finder.replaceQuery, "selected");
	toggle.editorCallback(h.a.editor, h.a);
	assert.equal(finder.replaceToggles, 1);
	for (const command of [show, toggle]) {
		command.editorCallback(h.b.editor, h.b);
		command.editorCallback(h.a.editor, h.b);
	}
	assert.equal(finder.replaceToggles, 1);
	assert.equal(h.finders[1].replaceToggles, undefined);
});
