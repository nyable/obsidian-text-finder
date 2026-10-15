import { build } from "vite";
import { resolve } from "node:path";
import { root, embeddedSources } from "../tools/vite-build.mjs";

/** One in-memory Vite build path for non-component integration/diagnostic code. */
export async function bundleSource({entry, source, format = "cjs", external = [], define = {}, target = "es2018"}) {
	const virtual = resolve(root, "tests/__bundle-entry__.ts");
	const result = await build({configFile: false, root, publicDir: false, logLevel: "error", define,
		plugins: [embeddedSources(), ...(source === undefined ? [] : [{name: "test-entry", resolveId(id) {if(id === virtual)return id;}, load(id) {if(id === virtual)return source;}}])],
		build: {write: false, target, minify: false,
			lib: {entry: source === undefined ? resolve(root,entry) : virtual, formats: [format], name: "TestBundle", fileName: () => "test.js"},
			rolldownOptions: {external, output: {codeSplitting: false, exports: "named"}},
		},
	});
	return (Array.isArray(result)? result[0] : result).output.find(file => file.type === "chunk").code;
}
