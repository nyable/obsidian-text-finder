import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "./source-loader.mjs";

test("UUID fallback works without crypto and does not need a host global", () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
	try {
		Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
		const helper = loadSource("../src/util/common-helper.ts");
		assert.match(helper.generateUniqueId(), /^[a-z0-9]+-[a-z0-9]+$/);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
		else delete globalThis.crypto;
	}
});

test("private preview preference failures and non-boolean values fail closed", () => {
	const { getLivePreviewPreference } = loadSource("../src/util/obsidian-internal.ts");
	for (const vault of [{}, { getConfig: () => "true" }, { getConfig() { throw new Error("host"); } }]) {
		assert.equal(getLivePreviewPreference(vault), undefined);
	}
	assert.equal(getLivePreviewPreference({ getConfig: () => true }), true);
	assert.equal(getLivePreviewPreference({ getConfig: () => false }), false);
});
