import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { compileComponents } from "./vue-components.mjs";

const bundle = await compileComponents(`
 export {mountView} from '/src/ui/mount';
 export {h, nextTick, useId, onBeforeUnmount, createStaticVNode} from 'vue';
`);
const module = {exports: {}};
new Function("module", "exports", bundle.code)(module,module.exports);
const {mountView,h,nextTick,useId,onBeforeUnmount,createStaticVNode} = module.exports;

test("owner-bound renderer creates dynamic/static HTML, SVG and unique labels without global document", async (t) => {
	const first = new JSDOM("<!doctype html><body></body>"), second = new JSDOM("<!doctype html><body></body>");
	t.after(() => {first.window.close(); second.window.close();});
	let destroyed = 0;
	const View = {props: ["text"],setup(props) {const id = `label-${useId()}`;onBeforeUnmount(() => destroyed++);
		return () => h("section", {"aria-labelledby": id},[h("span",{id},props.text),h("svg",null,[h("path",{d:"M0 0L1 1"})])]);}};
	const target = first.window.document.createElement("div");first.window.document.body.append(target);
	const one = mountView(View,target,{text:"first"}),two = mountView(View,target,{text:"second"});
	assert.equal(target.children.length,2,"no layout wrapper");
	const labels=[...target.querySelectorAll("section")].map(el=>el.getAttribute("aria-labelledby"));
	assert.equal(new Set(labels).size,2);for(const id of labels)assert.ok(first.window.document.getElementById(id));
	assert.ok(target.querySelector("section") instanceof first.window.HTMLElement);
	assert.ok(target.querySelector("svg") instanceof first.window.SVGElement);
	second.window.document.body.append(target);one.update({text:"moved"});await nextTick();
	assert.equal(target.querySelector("span").textContent,"moved");
	one.destroy();one.destroy();assert.equal(target.children.length,1);assert.equal(destroyed,1);
	two.destroy();assert.equal(target.childNodes.length,0);assert.equal(destroyed,2);
});

test("conditional root replacement stays in its owner range and leaves sibling apps intact", async (t) => {
	const dom = new JSDOM("<!doctype html><body></body>"); t.after(() => dom.window.close());
	const target = dom.window.document.body;
	const View = {props: ["alternate"],setup(props) {return () => props.alternate ? h("button",null,"second") : h("span",null,"first");}};
	const first = mountView(View,target,{alternate:false}),second = mountView(View,target,{alternate:false});
	first.update({alternate:true});await nextTick();
	assert.deepEqual([...target.children].map(el=>el.tagName),["BUTTON","SPAN"]);
	first.destroy();assert.deepEqual([...target.children].map(el=>el.tagName),["SPAN"]);
	second.destroy();assert.equal(target.childNodes.length,0);
});

test("compiled static fragments use the current owner realm and clean every root", (t) => {
	const dom = new JSDOM("<!doctype html><body></body>"); t.after(() => dom.window.close());
	const target = dom.window.document.body;
	const View = {setup() {return () => h("div",null,[createStaticVNode('<span>static</span><span>second</span>',2), h("svg",null,[createStaticVNode('<path d="M0 0L1 1" />',1)])]);}};
	const view = mountView(View,target,{});
	assert.ok(target.querySelector("span") instanceof dom.window.HTMLElement);
	assert.ok(target.querySelector("path") instanceof dom.window.SVGElement);
	assert.equal(target.querySelectorAll("span").length,2);
	view.destroy();assert.equal(target.childNodes.length,0);
});
