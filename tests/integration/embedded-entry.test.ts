import { expect, it } from "vitest";
import { win32 } from "node:path";
import { embeddedEntry, embeddedBundle } from "../../tools/vite-build.mjs";

it("resolves the same embedded source from native Windows and POSIX separators", () => {
	const entry = "E:/项目/text finder/tools/__embedded-entry__.js";
	const plugin = embeddedEntry(entry, "export const value = 42");
	expect(plugin.resolveId(win32.resolve(entry))).toBe(entry);
	expect(plugin.load(entry)).toBe("export const value = 42");
});

it("builds source in memory without a placeholder file or runtime chunks", async () => {
	const chunk = await embeddedBundle({ source: "export const answer = 42", name: "Embedded" });
	expect(chunk.dynamicImports).toEqual([]);
	expect(chunk.imports).toEqual([]);
	expect(chunk.code).toContain("42");
});
