import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "vitest";
import * as settingsSource from "../../src/features/settings";

const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));
const keys = (value, prefix = "") =>
	Object.entries(value).flatMap(([key, entry]) =>
		typeof entry === "object" ? keys(entry, `${prefix}${key}.`) : [`${prefix}${key}`],
	);

test("release version and supported host version have one consistent definition", () => {
	const pkg = json("package.json"),
		manifest = json("manifest.json"),
		versions = json("versions.json");
	assert.equal(pkg.version, manifest.version);
	assert.equal(versions[manifest.version], manifest.minAppVersion);
	assert.match(pkg.engines.node, new RegExp(read(".node-version").trim().replaceAll(".", "\\.")));
});

test("translation key sets and static calls stay synchronized", () => {
	const en = keys(json("src/i18n/locale/en.json"));
	assert.deepEqual(en.sort(), keys(json("src/i18n/locale/zh_cn.json")).sort());
	const paths = readdirSync("src", { recursive: true }).filter((path) =>
		/\.(ts|vue)$/.test(path),
	);
	for (const path of paths) {
		for (const match of read(`src/${path}`).matchAll(
			/(?:i18n\.t\(|reportError\()\s*["']([^"']+)["']/g,
		)) {
			assert.ok(en.includes(match[1]), `${path}: unknown translation ${match[1]}`);
		}
	}
});

test("bilingual interpolation variables stay synchronized", () => {
	const flatten = (value, prefix = "") =>
		Object.entries(value).flatMap(([key, entry]) =>
			typeof entry === "object"
				? flatten(entry, `${prefix}${key}.`)
				: [[`${prefix}${key}`, entry]],
		);
	const en = new Map(flatten(json("src/i18n/locale/en.json")));
	const zh = new Map(flatten(json("src/i18n/locale/zh_cn.json")));
	const variables = (value) =>
		[
			...new Set([...value.matchAll(/{{-?\s*([^},\s]+)[^}]*}}/g)].map((match) => match[1])),
		].sort();
	for (const [key, text] of en) assert.deepEqual(variables(text), variables(zh.get(key)), key);
});

test("reading recovery text points to the native action, not the retired settings toggle", () => {
	assert.doesNotMatch(json("src/i18n/locale/en.json").search.ReadingFailed, /settings/i);
	assert.doesNotMatch(json("src/i18n/locale/zh_cn.json").search.ReadingFailed, /设置/);
});

test("CI and release share every verification gate and release only the same-run verified artifact", () => {
	const ci = read(".github/workflows/ci.yml");
	const release = read(".github/workflows/release.yml");
	const verify = read(".github/workflows/verify.yml");
	for (const caller of [ci, release])
		assert.match(caller, /uses: \.\/\.github\/workflows\/verify\.yml/);
	assert.match(verify, /workflow_call:/);
	assert.match(verify, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
	for (const command of [
		"test",
		"test:artifacts",
		"typecheck",
		"check:architecture",
		"lint",
		"format:check",
		"build",
		"test:browser",
	])
		assert.ok(verify.includes(`run: pnpm ${command}\n`), `missing gate: ${command}`);
	assert.match(verify, /run: node tools\/build\/verify-artifacts\.mjs/);
	assert.match(
		verify,
		/if: runner\.os == 'Linux'\s+uses: actions\/upload-artifact@v4\s+with:\s+name: plugin-dist\s+path: dist\//,
	);
	assert.match(release, /checks:\s+needs: validate\s+uses:/);
	assert.match(release, /release:\s+needs: checks/);
	assert.match(
		release,
		/uses: actions\/download-artifact@v4\s+with:\s+name: plugin-dist\s+path: dist\//,
	);
	assert.doesNotMatch(release, /pnpm (?:build|install)|run-id:|workflow_run:/);
	for (const file of ["main.js", "manifest.json", "styles.css"])
		assert.ok(release.includes(`dist/${file}`), `missing release asset: ${file}`);
});

test("documented boolean and numeric defaults agree with settings", () => {
	const doc = read("docs/product/features.md");
	for (const [key, value] of Object.entries(settingsSource.defaultSettings())) {
		if (typeof value !== "boolean" && typeof value !== "number") continue;
		const row = doc
			.split("\n")
			.find((line) => line.startsWith("|") && line.includes(`\`${key}\``));
		assert.ok(row, `missing default row: ${key}`);
		assert.ok(
			row.includes(
				typeof value === "boolean" ? `默认${value ? "开启" : "关闭"}` : `默认 ${value}`,
			),
			`wrong default: ${key}`,
		);
	}
});

test("maintained Markdown local links resolve to existing files", () => {
	const paths = [
		"README.md",
		"README-zh_CN.md",
		"AGENTS.md",
		...readdirSync("docs", { recursive: true })
			.filter((path) => path.endsWith(".md"))
			.map((path) => `docs/${path}`),
	];
	for (const path of paths) {
		// Inline Markdown links only; anchors and prose/symbol references are not a schema.
		for (const match of read(path).matchAll(/\]\(([^\s)]+)\)/g)) {
			const target = match[1].split("#")[0];
			if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
			assert.ok(
				existsSync(resolve(dirname(path), decodeURIComponent(target))),
				`${path}: missing ${target}`,
			);
		}
	}
});

test("product settings and command tables cover current public definitions", () => {
	const doc = read("docs/product/features.md");
	for (const key of Object.keys(settingsSource.defaultSettings())) {
		if (key !== "searchHistory")
			assert.ok(doc.includes(`\`${key}\``), `undocumented setting ${key}`);
	}
	const source = read("src/app/workspace-commands.ts");
	for (const match of source.matchAll(/"(text-finder-[a-z-]+|show-search-history)"/g)) {
		assert.ok(doc.includes(`\`${match[1]}\``), `undocumented command ${match[1]}`);
	}
});

test("Style Settings example and documented CSS defaults agree with the stylesheet", () => {
	const example = read("style-settings.css"),
		doc = read("docs/product/ui-baseline.md");
	// Only body defaults are the public Style Settings interface. Component-local
	// select sizing tokens are implementation details, not user-facing settings.
	const defaults = read("src/styles/index.scss").match(/^body\s*\{([^}]+)\}/m)[1];
	for (const [, name, value] of defaults.matchAll(/--(nya-[\w-]+):\s*([^;]+);/g)) {
		const item = example.match(
			new RegExp(`id: ${name}\\r?\\n([\\s\\S]*?)(?=\\r?\\n    -|\\*\\/)`),
		);
		assert.ok(item, `missing example variable ${name}`);
		assert.ok(
			item[1].includes(`default: '${value}'`) || item[1].includes(`default: ${value}`),
			`wrong default ${name}`,
		);
		assert.ok(doc.includes(`\`--${name}\` | \`${value}\``), `wrong documented default ${name}`);
	}
});
