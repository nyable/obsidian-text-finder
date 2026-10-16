import { defineConfig, normalizePath } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { root, hostExternal, embeddedSources, releaseAssets } from "./tools/vite-build.mjs";

export default defineConfig(({ mode }) => ({
	publicDir: false,
	resolve: { alias: { "@": resolve(root, "src") } },
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
		__VUE_OPTIONS_API__: "false",
		__VUE_PROD_DEVTOOLS__: "false",
		__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
	},
	plugins: [
		vue(),
		embeddedSources(),
		releaseAssets(),
		{
			name: "text-finder-global-styles",
			enforce: "pre",
			transform(code, id) {
				if (id === normalizePath(resolve(root, "src/main.ts")))
					return {
						code: `import ${JSON.stringify(normalizePath(resolve(root, "src/styles/index.scss")))};\n${code}`,
						map: null,
					};
			},
		},
	],
	build: {
		target: "es2018",
		outDir: "dist",
		cssCodeSplit: false,
		cssMinify: "lightningcss",
		minify: mode === "development" ? false : "oxc",
		sourcemap: mode === "development" ? "inline" : false,
		lib: {
			entry: resolve(root, "src/main.ts"),
			formats: ["cjs"],
			fileName: () => "main.js",
			cssFileName: "styles",
		},
		rolldownOptions: {
			external: hostExternal,
			output: { exports: "default", codeSplitting: false },
		},
	},
}));
