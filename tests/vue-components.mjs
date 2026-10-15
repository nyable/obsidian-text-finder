import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { root, embeddedSources } from "../tools/vite-build.mjs";

/** Real Vue SFC/compiler/styles; host replacements remain explicit per suite. */
export async function compileComponents(source, stubs = {}, externals = []) {
	const entry = resolve(root, "tests/__vue-test-entry__.ts");
	const result = await build({ configFile: false, root, publicDir: false, logLevel: "error",
		define: { "process.env.NODE_ENV": JSON.stringify("production"), __VUE_OPTIONS_API__: "false", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" },
		plugins: [ { name: "test-host", enforce: "pre",
			resolveId(id) { if (id === entry) return id; if (id in stubs) return `\0test:${id}`; },
			load(id) { if (id === entry) return source; if (id.startsWith("\0test:")) return stubs[id.slice(6)]; },
		}, vue(), embeddedSources()],
		build: { write: false, minify: false, cssMinify: false, cssCodeSplit: false, target: "es2018",
			lib: {entry, formats: ["cjs"], fileName: () => "test.js"},
			rolldownOptions: {external: externals, output: {codeSplitting: false}},
		},
	});
	const output = (Array.isArray(result) ? result[0] : result).output;
	return {code: output.find(file => file.type === "chunk").code,
		styles: output.filter(file => file.type === "asset" && file.fileName.endsWith(".css")).map(file => file.source.toString())};
}

// Only tests that historically used constructor-shaped fixtures need this adapter.
// Production uses mountFinder / mountView with update/destroy, not Svelte APIs.
export const fixtureAdapter = `
import {mountView} from '/src/ui/mount';
export {nextTick as tick} from 'vue';
export function fixture(Component) {return class {
 constructor({target, props}) {this.view = mountView(Component, target, props); Object.assign(this, this.view.exposed);}
 $set(props) {this.view.update(props)}
 $destroy() {this.view.destroy()}
};}`;
