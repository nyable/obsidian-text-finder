import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { EditorState } from '@codemirror/state';
import { loadSource } from './source-loader.mjs';
import { readingSelectionSource } from './reading-source.mjs';

class MarkdownView {}
function menu() {
	return { items: [], callbacks: [], hides: 0, addItem(fn) {
		const item = { setTitle(v) { this.title = v; return this; }, setIcon(v) { this.icon = v; return this; },
			setSection(v) { this.section = v; return this; }, onClick(fn) { this.click = fn; return this; } };
		fn(item); this.items.push(item); return this;
	}, onHide(fn) { this.callbacks.push(fn); }, hide() { this.hides++; this.callbacks.forEach((fn) => fn()); } };
}
function environment(t, { bridge = true } = {}) {
	const dom = new JSDOM('<html><body></body></html>'), doc = dom.window.document;
	const events = new Map(), notices = [], calls = [], eventMenus = new WeakMap(), allMenus = [];
	const Menu = bridge ? { forEvent(event) { let value = eventMenus.get(event); if (!value) { value = menu(); eventMenus.set(event, value); allMenus.push(value); } event.preventDefault(); return value; } } : {};
	const views = [];
	function view(mode = 'source') {
		const v = new MarkdownView(); v.file = { path: 'same.md' }; v.mode = mode; v.getMode = () => v.mode;
		v.containerEl = doc.createElement('div'); doc.body.append(v.containerEl);
		const root = doc.createElement('div'); root.innerHTML = '<p>cat cat</p>'; v.containerEl.append(root);
		const renderer = { previewEl: root, lastText: 'cat cat' };
		v.previewMode = { containerEl: root, renderer }; v.getViewData = () => v.source;
		v.source = 'cat cat';
		v.editor = { cm: { state: EditorState.create({ doc: 'cat cat', selection: { anchor: 4, head: 7 } }) },
			getSelection() { const r = this.cm.state.selection.main; return this.cm.state.doc.sliceString(r.from, r.to); } };
		v.showSearch = () => { calls.push([v, 'native']); if (v.nativeInput !== false && !root.querySelector('input')) {
			const wrap = doc.createElement('div'); wrap.className = 'document-search-input'; wrap.append(doc.createElement('input')); root.prepend(wrap);
		} };
		v.finder = { isDocked: () => false, hasSelectionScope: () => false,
			setVisible: (...args) => calls.push([v, 'visible', ...args]), findSelectedText: (text) => calls.push([v, 'text', text]),
			findInCapturedSelection: (ranges) => calls.push([v, 'scope', ranges]), $destroy() {} };
		views.push(v); return v;
	}
	const a = view(), b = view(); let active = b;
	const plugin = { settings: { useSelectionAsSearch: true, useObsidianSearchInRead: false }, app: { workspace: {
		on: (key, fn) => events.set(key, fn), iterateAllLeaves: (fn) => views.forEach((view) => fn({ view })), getActiveViewOfType: () => active,
	} }, registerEvent() {}, addCommand() {} };
	const { EditorSearch } = loadSource('../src/editor-extension.ts', {
		obsidian: { MarkdownView, Menu, Notice: class { constructor(text) { notices.push(text); } } },
		'./reading-selection': readingSelectionSource, './match-engine': {}, './search-highlight': {}, './SearchBox.svelte': {},
		'./reading-search': {}, './i18n': { i18n: { t: (key) => key } }, './util/common-helper': {}, './HistoryModal': {},
	});
	const search = new EditorSearch(plugin);
	let creates = 0;
	search.getFinder = (owner) => { creates++; return owner.finder; };
	search.canSearchReading = () => true;
	t.after(() => { search.destoryAll(); dom.window.close(); });
	const pane = (owner = a, source = 'more-options', file = owner.file, leaf = { view: owner }, result = menu()) => {
		events.get('file-menu')(result, file, source, leaf); return result;
	};
	const editorMenu = (owner = a, result = menu(), editor = owner.editor, info = owner) => { events.get('editor-menu')(result, editor, info); return result; };
	const readingMenu = (owner = a, target = owner.previewMode.renderer.previewEl.querySelector('p')) => {
		const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }); target.dispatchEvent(event);
		return { event, menu: eventMenus.get(event) };
	};
	const selectReading = (owner = a) => { const node = owner.previewMode.renderer.previewEl.querySelector('p').firstChild;
		dom.window.getSelection().setBaseAndExtent(node, 4, node, 7); search.syncReadingSelections(); return node; };
	return { dom, doc, a, b, views, search, plugin, events, notices, calls, creates: () => creates, pane, editorMenu, readingMenu, selectReading, Menu, allMenus,
		activate: (view) => { active = view; } };
}

test('more-options adds exactly one find action to its owner, not the active split or other file menus', (t) => {
	const h = environment(t), m = h.pane(); assert.equal(m.items.length, 1); assert.equal(h.creates(), 0);
	assert.equal(m.items[0].section, 'find'); assert.equal(m.items[0].title, 'search.menu.OpenFind');
	h.pane(h.a, 'more-options', h.a.file, { view: h.a }, m); assert.equal(m.items.length, 1);
	for (const source of ['tab-header', 'file-explorer-context-menu', 'link-context-menu']) assert.equal(h.pane(h.a, source).items.length, 0);
	assert.equal(h.pane(h.a, 'more-options', h.b.file).items.length, 0);
	assert.equal(h.pane(h.a, 'more-options', h.a.file, null).items.length, 0);
	m.items[0].click(); assert.deepEqual(h.calls, [[h.a, 'visible', true, 'cat']]);
});

test('more-options follows ordinary opening settings and retains scoped or docked queries', (t) => {
	const h = environment(t); h.plugin.settings.useSelectionAsSearch = false;
	h.pane().items[0].click(); assert.equal(h.calls.at(-1)[3], undefined);
	h.plugin.settings.useSelectionAsSearch = true; h.a.finder.hasSelectionScope = () => true;
	h.pane().items[0].click(); assert.equal(h.calls.at(-1)[3], undefined);
	h.a.finder.hasSelectionScope = () => false; h.a.finder.isDocked = () => true;
	h.pane().items[0].click(); assert.equal(h.calls.at(-1)[3], undefined);
});

for (const change of ['file', 'mode', 'closed', 'document']) test(`pane menu rejects stale ${change} owner`, (t) => {
	const h = environment(t), m = h.pane();
	if (change === 'file') h.a.file = { path: 'new.md' };
	if (change === 'mode') h.a.mode = 'preview';
	if (change === 'closed') h.views.splice(0, 1);
	if (change === 'document') h.a.containerEl = new JSDOM().window.document.createElement('div');
	m.items[0].click(); assert.equal(h.calls.length, 0);
});

test('editor menu snapshots exact ranges before focus changes, deduplicates and ignores automatic seed setting', (t) => {
	const h = environment(t); h.plugin.settings.useSelectionAsSearch = false;
	const m = h.editorMenu(); h.editorMenu(h.a, m); assert.equal(m.items.length, 2); assert.equal(h.creates(), 0);
	assert.deepEqual(m.items.map((i) => i.title), ['search.menu.FindSelectedText', 'search.menu.FindInSelection']);
	h.a.editor.cm.state = h.a.editor.cm.state.update({ selection: { anchor: 0 } }).state;
	m.items[0].click(); assert.deepEqual(h.calls.at(-1), [h.a, 'text', 'cat']);
	m.items[1].click(); assert.deepEqual(h.calls.at(-1), [h.a, 'scope', [{ from: 4, to: 7 }]]);
});

test('editor menu refuses no selection, foreign editor, file info mismatch and reading mode', (t) => {
	const h = environment(t);
	assert.equal(h.editorMenu(h.a, menu(), h.b.editor).items.length, 0);
	assert.equal(h.editorMenu(h.a, menu(), h.a.editor, { file: h.b.file }).items.length, 0);
	h.a.mode = 'preview'; assert.equal(h.editorMenu().items.length, 0);
	h.a.mode = 'source'; h.a.editor.cm.state = EditorState.create({ doc: 'cat cat' });
	assert.equal(h.editorMenu().items.length, 0);
});

test('editor menu resolves MarkdownFileInfo by exact editor and rejects document edits and reconstruction', (t) => {
	const h = environment(t), m = h.editorMenu(h.a, menu(), h.a.editor, { file: h.a.file });
	assert.equal(m.items.length, 2);
	h.a.editor.cm.state = h.a.editor.cm.state.update({ changes: { from: 0, to: 3, insert: 'dog' } }).state;
	m.items[0].click(); m.items[1].click(); assert.equal(h.calls.length, 0); assert.equal(h.notices.length, 2);
});

test('reading right click joins event menu and preserves link/copy actions and event propagation', (t) => {
	const h = environment(t); h.a.mode = 'preview'; const node = h.selectReading();
	const p = node.parentElement; let propagated = 0;
	p.className = 'external-link';
	const link = h.doc.createElement('a'); link.className = 'external-link'; p.replaceWith(link); link.append(p);
	h.selectReading();
	p.addEventListener('contextmenu', (e) => h.Menu.forEvent(e).addItem((i) => i.setTitle('host-copy')));
	h.doc.addEventListener('contextmenu', () => propagated++);
	const { menu: m, event } = h.readingMenu(); assert.equal(event.defaultPrevented, true); assert.equal(propagated, 1);
	assert.equal(m.items.length, 3); assert.equal(m.items[0].title, 'host-copy');
	h.dom.window.getSelection().removeAllRanges();
	m.items[1].click(); assert.deepEqual(h.calls.at(-1), [h.a, 'text', 'cat']);
	m.items[2].click(); assert.equal(h.calls.at(-1)[1], 'scope'); assert.equal(h.calls.at(-1)[2][0].start.node, node);
});

test('reading right click ignores outside selection, inputs, embeds, header and missing private bridge', (t) => {
	const h = environment(t); h.a.mode = 'preview'; h.selectReading();
	for (const html of ['<input>', '<div class="internal-embed">text</div>', '<div class="mod-header">text</div>']) {
		const el = h.doc.createElement('div'); el.innerHTML = html; h.a.previewMode.renderer.previewEl.append(el);
		assert.equal(h.readingMenu(h.a, el.firstChild).menu, undefined);
	}
	h.dom.window.getSelection().removeAllRanges(); assert.equal(h.readingMenu().menu, undefined);
	const other = environment(t, { bridge: false }); other.a.mode = 'preview'; other.selectReading();
	assert.equal(other.readingMenu().menu, undefined);
});

test('plain reading selection retains copy through owner clipboard and reports unavailable clipboard', async (t) => {
	const h = environment(t); h.a.mode = 'preview'; h.selectReading(); const m = h.readingMenu().menu;
	const copy = m.items.find((item) => item.title === 'search.menu.CopySelection'); assert.ok(copy);
	const copied = []; Object.defineProperty(h.dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => copied.push(text) } });
	await copy.click(); assert.deepEqual(copied, ['cat']);
	Object.defineProperty(h.dom.window.navigator, 'clipboard', { value: undefined }); await copy.click();
	assert.equal(h.notices.at(-1), 'search.menu.CopyFailed');
});

test('reading leaves unrelated consumed context menus alone and rejects excluded selection endpoints', (t) => {
	const h = environment(t); h.a.mode = 'preview'; h.selectReading();
	const p = h.a.previewMode.renderer.previewEl.querySelector('p');
	p.addEventListener('contextmenu', (event) => event.preventDefault(), { once: true });
	assert.equal(h.readingMenu().menu, undefined);
	const excluded = h.doc.createElement('span'); excluded.className = 'math'; excluded.textContent = 'cat'; p.append(excluded);
	h.dom.window.getSelection().setBaseAndExtent(excluded.firstChild, 0, excluded.firstChild, 3);
	assert.equal(h.readingMenu().menu, undefined);
});

for (const change of ['text', 'renderer', 'source', 'file']) test(`reading menu rejects stale ${change} snapshot`, (t) => {
	const h = environment(t); h.a.mode = 'preview'; const node = h.selectReading(), m = h.readingMenu().menu;
	if (change === 'text') node.data = 'dog cat';
	if (change === 'renderer') h.a.previewMode.renderer = { ...h.a.previewMode.renderer };
	if (change === 'source') h.a.source = 'changed';
	if (change === 'file') h.a.file = { path: 'new.md' };
	m.items[0].click(); m.items[1].click(); assert.equal(h.calls.length, 0); assert.equal(h.notices.length, 2);
});

test('reading menu follows native preference, fills only the owner input, while range action stays plugin-only', (t) => {
	const h = environment(t); h.a.mode = 'preview'; h.selectReading(); const m = h.readingMenu().menu;
	h.plugin.settings.useObsidianSearchInRead = true;
	m.items[0].click(); assert.deepEqual(h.calls, [[h.a, 'native']]);
	assert.equal(h.a.previewMode.containerEl.querySelector('input').value, 'cat');
	assert.equal(h.b.previewMode.containerEl.querySelector('input'), null);
	// Native input creation mutates the body; a fresh menu is needed for the next intent.
	h.selectReading(); h.readingMenu().menu.items[1].click(); assert.equal(h.calls.at(-1)[1], 'scope');
});

test('reading pane fallback and selected-text fallback notify on unsupported API without opening another plugin Finder', (t) => {
	const h = environment(t); h.a.mode = 'preview'; h.search.canSearchReading = () => false;
	h.pane().items[0].click(); assert.deepEqual(h.calls, [[h.a, 'native']]); assert.equal(h.notices[0], 'search.ReadingUnsupported');
	h.selectReading(); const m = h.readingMenu().menu; h.a.previewMode.containerEl.querySelector('input')?.parentElement.remove();
	h.a.nativeInput = false;
	// Removing an input after menu capture invalidates the body; recapture before execution.
	h.selectReading(); h.readingMenu().menu.items[0].click();
	assert.ok(h.notices.includes('search.menu.NativeQueryUnavailable')); assert.equal(h.creates(), 0);
});

test('layout and unload release reading listeners, hide owned menus, and stale callbacks have no effect', (t) => {
	const h = environment(t); h.a.mode = 'preview'; h.selectReading(); const m = h.readingMenu().menu;
	h.a.mode = 'source'; h.search.syncReadingSelections(); h.a.mode = 'preview';
	assert.equal(h.readingMenu().menu, undefined, 'mode exit disconnected old listener');
	h.search.syncReadingSelections(); const fresh = h.readingMenu().menu;
	h.search.destoryAll(); assert.ok(fresh.hides > 0); assert.ok(m.hides > 0);
	fresh.items[0].click(); assert.equal(h.calls.length, 0); assert.equal(h.readingMenu().menu, undefined);
});
