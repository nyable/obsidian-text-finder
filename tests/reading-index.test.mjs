import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadSource } from "./source-loader.mjs";

const { indexReadingText, readingMatchEndpoints } = loadSource("../src/reading-text.ts");
function environment(t, html) {
	const dom = new JSDOM("<!doctype html><body></body>");
	const root = dom.window.document.createElement("div"); root.innerHTML = html;
	dom.window.document.body.append(root); t.after(() => dom.window.close());
	return { dom, root, run: () => indexReadingText([root]) };
}

test("explicitly excluded subtrees require no computed style reads and retain boundaries", (t) => {
	const h = environment(t, '<p>A<span hidden>hidden</span><button>control</button><span aria-hidden="true">aria</span><svg><text>svg</text></svg>B</p><div class="internal-embed"><p>embedded</p></div><p>C</p>');
	const visited = []; const original = h.dom.window.getComputedStyle;
	t.mock.method(h.dom.window, "getComputedStyle", function (el) { visited.push(el); return original.call(this, el); });
	const index = h.run();
	assert.equal(index.text, "A\nB\nC\n");
	assert.deepEqual(visited.map((el) => el.tagName), ["DIV", "P", "P"]);
	assert.ok(index.spans.every((span) => !span.node.parentElement.closest('[hidden], button, [aria-hidden="true"], svg, .internal-embed')));
});

test("folding selector is evaluated only for display:none elements", (t) => {
	const h = environment(t, '<p>visible</p><span style="display:none">secret</span><ul><li class="is-collapsed"><ul style="display:none"><li>folded</li></ul></li></ul>');
	const checked = []; const proto = h.dom.window.Element.prototype; const original = proto.matches;
	t.mock.method(proto, "matches", function (selector) {
		if (selector.startsWith("li.is-collapsed > ul")) checked.push(this);
		return original.call(this, selector);
	});
	const index = h.run();
	assert.ok(index.text.includes("visible")); assert.ok(index.text.includes("folded")); assert.ok(!index.text.includes("secret"));
	assert.deepEqual(checked.map((el) => el.tagName), ["SPAN", "UL"]);
});

test("explicit exclusion and visibility still override folded-body display exceptions", (t) => {
	const h = environment(t, `<ul><li class="is-collapsed">
		<ul hidden style="display:none"><li>explicit</li></ul>
		<ol style="display:none;visibility:hidden"><li>invisible</li></ol>
		<ul style="display:none;visibility:collapse"><li>collapsed-visibility</li></ul>
		<ol style="display:none"><li>accepted</li></ol></li></ul>
		<div class="callout is-collapsed"><div class="callout-content" aria-hidden="true" style="display:none">aria</div>
		<div class="callout-content" style="display:none">callout</div></div>`);
	const index = h.run();
	for (const word of ["explicit", "invisible", "collapsed-visibility", "aria"]) assert.ok(!index.text.includes(word));
	assert.ok(index.text.includes("accepted")); assert.ok(index.text.includes("callout"));
});

test("style and fold classification are recomputed on each index, never cached across snapshots", (t) => {
	const h = environment(t, '<ul><li class="is-collapsed"><ul style="display:none"><li>cat</li></ul></li></ul><p><span>dog</span></p>');
	assert.ok(h.run().text.includes("cat"));
	h.root.querySelector("li").classList.remove("is-collapsed"); assert.ok(!h.run().text.includes("cat"));
	const span = h.root.querySelector("span"); span.style.display = "none"; assert.ok(!h.run().text.includes("dog"));
	span.style.display = "inline"; assert.ok(h.run().text.includes("dog"));
});

test("text spans preserve UTF-16, preformatted text, collapsed space and hard/cell boundaries", (t) => {
	const h = environment(t, '<p>A <em> \t😀</em>&nbsp;B<br><br>C </p><table><tr><td>X</td><td></td><td>Y</td></tr></table><pre>  Z\n\tΩ</pre>');
	const index = h.run(); assert.equal(index.text, "A 😀\u00a0B\n\nC\nX\t\tY\n  Z\n\tΩ\n");
	const from = index.text.indexOf("😀"); const endpoints = readingMatchEndpoints(index, from, from + 2);
	assert.equal(endpoints.length, 1); assert.equal(endpoints[0].node.data.slice(endpoints[0].start, endpoints[0].end), "😀");
	assert.equal(endpoints[0].end - endpoints[0].start, 2);
});
