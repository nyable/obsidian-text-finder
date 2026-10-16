import { readFile } from "node:fs/promises";
import { parse, compileStyleAsync } from "vue/compiler-sfc";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** CSS contract tests use the official SFC compiler, never extract component JS. */
export async function componentStyles(url, scopeId = "data-v-contract") {
	const filename = typeof url === "string" ? resolve(url) : fileURLToPath(url);
	const { descriptor, errors } = parse(await readFile(filename, "utf8"), { filename });
	if (errors.length) throw new AggregateError(errors, "SFC parse failed");
	return Promise.all(
		descriptor.styles.map(async (style) => {
			const result = await compileStyleAsync({
				source: style.content,
				filename,
				id: scopeId,
				scoped: style.scoped,
				...(style.lang ? { preprocessLang: style.lang } : {}),
			});
			if (result.errors.length)
				throw new AggregateError(result.errors, "SFC CSS compilation failed");
			return result.code;
		}),
	);
}
