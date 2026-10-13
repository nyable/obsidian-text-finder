import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { appearanceSource, settingsSource } from "./history-source.mjs";
import { readFileSync } from "node:fs";
import { compileString } from "sass";

const { normalizeColor, normalizeAppearanceColors, colorOpacity, colorWithOpacity, AppearanceStyles, appearanceColors, resolvedAppearanceColor } = appearanceSource;

test("appearance accepts only safe hex colors, normalizes shorthand/alpha and ignores malformed or foreign fields", () => {
	for (const [raw, expected] of [['#ABC', '#aabbcc'], [' #1234 ', '#11223344'], ['#aabbccFF', '#aabbcc'], ['#00000000', '#00000000']]) {
		assert.equal(normalizeColor(raw), expected);
	}
	for (const raw of [null, 123, {}, '#12', '#abcde', 'red', 'var(--color)', '#123456; } body {color:red', '#123456789']) assert.equal(normalizeColor(raw), null);
	assert.deepEqual(normalizeAppearanceColors({ focusBorder: '#ABC', matchBackground: 'bad', unknown: '#fff' }), { focusBorder: '#aabbcc' });
	assert.deepEqual(normalizeAppearanceColors([]), {});
	assert.equal(colorOpacity('#ffffff'), 100);
	assert.equal(colorOpacity('#12345600'), 0);
	assert.equal(colorWithOpacity('#12345680', 100), '#123456');
	assert.equal(colorWithOpacity('#123456', 0), '#12345600');
	assert.equal(colorWithOpacity('#123456', 50), '#12345680');
});

test("appearance migration defaults to no overrides, persists independent colors and remains idempotent", () => {
	const a = settingsSource.defaultSettings(), b = settingsSource.defaultSettings();
	a.appearanceColors.matchText = '#abcdef'; assert.deepEqual(b.appearanceColors, {});
	const { settings } = settingsSource.normalizeSettings({ appearanceColors: { matchText: '#ABC', currentMatchBackground: '#1234', focusBorder: false } });
	assert.deepEqual(settings.appearanceColors, { matchText: '#aabbcc', currentMatchBackground: '#11223344' });
	assert.equal(settingsSource.normalizeSettings(settings).changed, false);
	assert.deepEqual(settingsSource.normalizeSettings({}).settings.appearanceColors, {});
});

test("inherited color probe resolves host RGB/alpha values and always removes its temporary element", (t) => {
	const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>');
	const root = dom.window.document.querySelector('#root');
	let computed = 'rgba(234, 92, 0, 0.3294117647)';
	t.mock.method(dom.window, 'getComputedStyle', (probe) => {
		assert.equal(probe.parentElement, root);
		assert.match(probe.style.color, /var\(--nya-match-bgColor/);
		return { color: computed };
	});
	assert.equal(resolvedAppearanceColor(root, 'matchBackground'), '#ea5c0054');
	assert.equal(root.children.length, 0);
	computed = 'rgb(1, 2, 3)'; assert.equal(resolvedAppearanceColor(root, 'matchBackground'), '#010203');
	computed = 'rgba(0, 0, 0, 0)'; assert.equal(resolvedAppearanceColor(root, 'matchBackground'), '#00000000');
	computed = 'unsupported'; assert.equal(resolvedAppearanceColor(root, 'matchBackground'), '#ea5c0054');
	t.mock.method(dom.window, 'getComputedStyle', () => { throw new Error('host failure'); });
	assert.throws(() => resolvedAppearanceColor(root, 'matchBackground'), /host failure/);
	assert.equal(root.children.length, 0);
	dom.window.close();
});

test("appearance styles update all owner documents, remove inherited overrides and clean up window/pagehide/unload resources", () => {
	const main = new JSDOM('<!doctype html><body style="--nya-match-color: #111111"></body>');
	const popup = new JSDOM('<!doctype html><body></body>');
	let colors = {};
	const styles = new AppearanceStyles(() => colors);
	styles.addDocument(main.window.document); styles.addDocument(main.window.document);
	assert.equal(main.window.document.querySelector('style'), null, 'no generated styles for inherited colors');
	colors = { matchText: '#ABC', currentMatchBackground: '#12345680', focusBorder: 'unsafe' }; styles.refresh();
	styles.addDocument(popup.window.document);
	for (const doc of [main.window.document, popup.window.document]) {
		assert.equal(doc.querySelectorAll('style[data-nya-appearance]').length, 1);
		assert.match(doc.querySelector('style').textContent, /--nya-match-color: #aabbcc !important/);
		assert.match(doc.querySelector('style').textContent, /--nya-match-curbgColor: #12345680 !important/);
		assert.doesNotMatch(doc.querySelector('style').textContent, /--nya-focus-border-color/);
	}
	colors = { matchText: '#ff0000' }; styles.refresh();
	assert.doesNotMatch(popup.window.document.querySelector('style').textContent, /--nya-match-curbgColor/);
	popup.window.dispatchEvent(new popup.window.Event('pagehide'));
	assert.equal(popup.window.document.querySelector('style'), null);
	colors = {}; styles.refresh(); assert.equal(main.window.document.querySelector('style'), null);
	assert.equal(main.window.document.body.style.getPropertyValue('--nya-match-color'), '#111111', 'host inline style is never overwritten');
	colors = { accentStrip: '#123456' }; styles.refresh(); assert.ok(main.window.document.querySelector('style'));
	styles.destroy(); styles.destroy(); styles.refresh(); styles.addDocument(popup.window.document);
	assert.equal(main.window.document.querySelector('style'), null); assert.equal(popup.window.document.querySelector('style'), null);
	assert.equal(styles.documents.size, 0);
	main.window.close(); popup.window.close();
});

test("appearance defaults agree with public variables and pinned preview has a separate scrollable control region", () => {
	const source = readFileSync(new URL('../src/styles/index.scss', import.meta.url), 'utf8');
	for (const definition of Object.values(appearanceColors)) assert.ok(source.includes(`${definition.variable}: ${definition.default};`));
	const css = compileString(source).css;
	assert.match(css, /\.nya-settings\.nya-settings--appearance\s*\{[^}]*height: 100%[^}]*overflow: hidden/s);
	assert.match(css, /\.nya-settings-layout\s*\{[^}]*display: flex[^}]*height: 100%/s);
	assert.match(css, /\.nya-appearance-preview\s*\{[^}]*flex-shrink: 0/s);
	assert.match(css, /\.nya-appearance-controls\s*\{[^}]*min-height: 0[^}]*overflow-y: auto/s);
	assert.match(css, /\.nya-settings-section-body\[hidden\]\s*\{[^}]*display: none/s);
	assert.match(css, /\.nya-settings-section-reset\s*\{[^}]*width: 32px[^}]*height: 32px/s);
	assert.match(css, /aria-expanded=(?:"false"|false)[^}]*transform: rotate\(-90deg\)/s);
	for (const [path, name] of [['en', 'Appearance'], ['zh_cn', '外观']]) {
		const locale = JSON.parse(readFileSync(new URL(`../src/i18n/locale/${path}.json`, import.meta.url), 'utf8'));
		assert.equal(locale.settings.Tabs.toolbar, name);
		if (path === 'zh_cn') assert.equal(locale.settings.Toolbar.reset, '恢复默认设置');
		if (path === 'zh_cn') assert.equal(locale.settings.Toolbar.resetDone, '已恢复默认设置');
	}
});

test("settings tabs have scoped hover, selected, pressed and focus styles; folded sections keep compact spacing", () => {
	const css = compileString(readFileSync(new URL('../src/styles/index.scss', import.meta.url), 'utf8')).css;
	assert.match(css, /\.nya-settings \.nya-settings-tabs button:hover\s*\{[^}]*background: var\(--background-modifier-hover\)[^}]*color: var\(--text-normal\)/s);
	assert.match(css, /\.nya-settings \.nya-settings-tabs button\[aria-selected=(?:"true"|true)\]\s*\{[^}]*border-bottom-color: var\(--interactive-accent\)[^}]*color: var\(--text-accent\)/s);
	assert.match(css, /\.nya-settings \.nya-settings-tabs button:active\s*\{[^}]*background: var\(--background-modifier-active-hover,/s);
	assert.match(css, /\.nya-settings \.nya-settings-tabs button:focus-visible\s*\{[^}]*outline: 2px solid var\(--interactive-accent\)/s);
	for (const kind of ['color', 'toolbar']) assert.match(css, new RegExp(`\\.nya-settings \\.nya-${kind}-settings\\s*\\{[^}]*margin-bottom: 8px`, 's'));
	assert.match(css, /\.nya-settings-section-header\s*\{[^}]*margin: 0/s);
	assert.match(css, /\.nya-settings-section-toggle\s*\{[^}]*min-height: 32px/s);
	assert.match(css, /\.nya-settings-section-body\s*\{[^}]*padding-top: 6px/s);
});
