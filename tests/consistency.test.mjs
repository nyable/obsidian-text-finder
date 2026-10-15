import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { settingsSource } from "./history-source.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const keys = (value, prefix = "") => Object.entries(value).flatMap(([key, entry]) =>
	typeof entry === "object" ? keys(entry, `${prefix}${key}.`) : [`${prefix}${key}`]);

test("release version and supported host version have one consistent definition", () => {
	const pkg = json("package.json"), manifest = json("manifest.json"), versions = json("versions.json");
	assert.equal(pkg.version, manifest.version);
	assert.equal(versions[manifest.version], manifest.minAppVersion);
	assert.match(pkg.engines.node, new RegExp(read(".node-version").trim().replaceAll(".", "\\.")));
});

test("translation key sets and static calls stay synchronized", () => {
	const en = keys(json("src/i18n/locale/en.json"));
	assert.deepEqual(en.sort(), keys(json("src/i18n/locale/zh_cn.json")).sort());
	const paths = ["SearchBox.vue", "finder-session.ts", "HistoryList.vue", "HistoryDetail.vue", "SearchStatus.vue", "Toolbar.vue",
		"HistoryModal.vue", "ToolbarPreview.vue", "main.ts", "editor-extension.ts", "toolbar.ts", "settings-tab.ts", "color-picker.ts"];
	for (const path of paths) {
		for (const match of read(`src/${path}`).matchAll(/(?:i18n\.t\(|reportError\()\s*"([^"]+)"/g)) {
			assert.ok(en.includes(match[1]), `${path}: unknown translation ${match[1]}`);
		}
	}
});

test("product settings and command tables cover current public definitions", () => {
	const doc = read("docs/product/features.md");
	for (const key of Object.keys(settingsSource.defaultSettings())) {
		if (key !== "searchHistory") assert.ok(doc.includes(`\`${key}\``), `undocumented setting ${key}`);
	}
	const source = read("src/editor-extension.ts");
	for (const match of source.matchAll(/"(text-finder-[a-z-]+|show-search-history)"/g)) {
		assert.ok(doc.includes(`\`${match[1]}\``), `undocumented command ${match[1]}`);
	}
});

test("Style Settings example and documented CSS defaults agree with the stylesheet", () => {
	const example = read("style-settings.css"), doc = read("docs/product/ui-baseline.md");
	// Only body defaults are the public Style Settings interface. Component-local
	// select sizing tokens are implementation details, not user-facing settings.
	const defaults = read("src/styles/index.scss").match(/^body\s*\{([^}]+)\}/)[1];
	for (const [, name, value] of defaults.matchAll(/--(nya-[\w-]+):\s*([^;]+);/g)) {
		const item = example.match(new RegExp(`id: ${name}\\n([\\s\\S]*?)(?=\\n    -|\\*\\/)`));
		assert.ok(item, `missing example variable ${name}`);
		assert.ok(item[1].includes(`default: '${value}'`) || item[1].includes(`default: ${value}`), `wrong default ${name}`);
		assert.ok(doc.includes(`\`--${name}\` | \`${value}\``), `wrong documented default ${name}`);
	}
});
