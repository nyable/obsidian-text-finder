import assert from "node:assert/strict";
import { test, onTestFinished } from "vitest";
import { JSDOM } from "jsdom";
import { mobileToolbar } from "../../src/features/finder/interaction/mobile-toolbar";

test("mobile overflow moves an inline suffix, preserves More, nodes and focus, then flows back", async () => {
	const dom = new JSDOM(
		'<!doctype html><body><div class="finder"><textarea></textarea><div class="nya-toolbar"></div></div><div class="results"></div></body>',
	);
	onTestFinished(() => dom.window.close());
	const doc = dom.window.document,
		row = doc.querySelector(".finder"),
		toolbar = doc.querySelector(".nya-toolbar"),
		target = doc.querySelector(".results");
	let available = 256;
	row.getBoundingClientRect = () => ({ width: available });
	const controls = ["regex", "case", "wholeWord", "previous", "next"].map((id, index) => {
		const button = doc.createElement("button");
		button.dataset.toolbarAction = id;
		button.dataset.toolbarOrder = index;
		button.getBoundingClientRect = () => ({ width: 28 });
		toolbar.append(button);
		return button;
	});
	const more = doc.createElement("div");
	more.className = "nya-toolbar-overflow";
	more.getBoundingClientRect = () => ({ width: 28 });
	toolbar.append(more);
	let clicks = 0;
	controls[4].addEventListener("click", () => clicks++);
	controls[4].focus();
	const action = mobileToolbar(toolbar, target);
	onTestFinished(() => action.destroy());
	await Promise.resolve();
	assert.deepEqual(
		[...target.children].map((node) => node.dataset.toolbarAction),
		["next"],
	);
	assert.equal(doc.activeElement, controls[4]);
	assert.equal(more.parentElement, toolbar);
	available = 230;
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	await Promise.resolve();
	assert.deepEqual(
		[...target.children].map((node) => node.dataset.toolbarAction),
		["previous", "next"],
	);
	controls[4].click();
	assert.equal(clicks, 1);
	available = 400;
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	await Promise.resolve();
	assert.equal(target.children.length, 0);
	assert.equal(doc.activeElement, controls[4]);
	assert.deepEqual([...toolbar.children].slice(0, 5), controls);
	assert.equal(toolbar.lastElementChild, more);
	action.destroy();
	available = 100;
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	await Promise.resolve();
	assert.equal(target.children.length, 0);
});
