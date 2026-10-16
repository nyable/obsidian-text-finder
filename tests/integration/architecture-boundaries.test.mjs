import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import config from "../../.dependency-cruiser.cjs";

it(
	"rejects host imports, feature internals, UI mounting and type-only cycles",
	{ timeout: 30000 },
	async () => {
		const directory = await mkdtemp(
			resolve(
				process.platform === "linux" ? "/tmp/opencode" : tmpdir(),
				"text-finder-boundaries-",
			),
		);
		const files = {
			"src/features/finder/application/session.ts":
				'import { Menu } from "obsidian"; import { start } from "../../../app/start"; export { Menu, start };',
			"src/app/start.ts": 'export { history } from "../features/history/model/history";',
			"src/features/history/model/history.ts": "export const history = true;",
			"src/features/settings/model/settings.ts":
				'export { history } from "../../history/model/history";',
			"src/features/finder/ui/view.ts": "export const mount = true;",
			"src/platform/browser/mount.ts":
				'export { mount } from "../../features/finder/ui/view";',
			"src/core/a.ts": 'import type { B } from "./b"; export interface A { b: B }',
			"src/core/b.ts": 'import type { A } from "./a"; export interface B { a: A }',
		};
		try {
			for (const [name, source] of Object.entries(files)) {
				await mkdir(dirname(resolve(directory, name)), { recursive: true });
				await writeFile(resolve(directory, name), source);
			}
			await writeFile(
				resolve(directory, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: { moduleResolution: "bundler", module: "ESNext" },
				}),
			);
			await writeFile(
				resolve(directory, "rules.cjs"),
				`module.exports = ${JSON.stringify(config)}`,
			);
			const cli = resolve("node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");
			let result;
			try {
				result = JSON.parse(
					execFileSync(
						process.execPath,
						[cli, "src", "--config", "rules.cjs", "--output-type", "json"],
						{ cwd: directory, encoding: "utf8" },
					),
				);
			} catch (error) {
				result = JSON.parse(error.stdout);
			}
			expect(result?.summary.violations.map((violation) => violation.rule.name)).toEqual(
				expect.arrayContaining([
					"application-has-no-runtime-framework",
					"no-app-backreference",
					"history-public-api-only",
					"platform-does-not-mount-ui",
					"platform-only-uses-feature-contracts",
					"no-cycles",
				]),
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
);
