import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { embeddedSources } from "./tools/vite-build.mjs";
import { colorPickerModule } from "./tools/color-picker-build.mjs";

// Compile the production owner-realm factory before jsdom's browser transform
// pipeline starts. Nested library builds must not inherit that pipeline.
const pickerSource = await colorPickerModule();

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			obsidian: fileURLToPath(new URL("./tests/support/obsidian-host.mjs", import.meta.url)),
		},
	},
	plugins: [
		vue(),
		{
			name: "test-color-picker-source",
			enforce: "pre",
			resolveId(id) {
				if (id === "virtual:color-picker") return "\0test:color-picker";
			},
			load(id) {
				if (id === "\0test:color-picker") return pickerSource;
			},
		},
		embeddedSources(),
	],
	test: {
		include: ["tests/{unit,component,integration}/**/*.test.{ts,mjs}"],
		environment: "node",
		maxWorkers: 1,
		restoreMocks: true,
		clearMocks: true,
		css: true,
	},
});
