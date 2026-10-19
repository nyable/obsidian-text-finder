import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";

export default tseslint.config(
	{ ignores: ["dist/**", "node_modules/**", "artifacts/**", "coverage/**"] },
	...tseslint.configs.recommended,
	...vue.configs["flat/essential"],
	{
		files: ["src/**/*.{ts,vue}"],
		languageOptions: {
			parserOptions: { project: "./tsconfig.vue.json", extraFileExtensions: [".vue"] },
		},
		rules: {
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",
			"@typescript-eslint/unbound-method": "error",
			"@typescript-eslint/no-unsafe-enum-comparison": "error",
		},
	},
	{
		files: ["src/core/**/*.ts", "src/features/*/application/**/*.ts"],
		rules: {
			"no-restricted-globals": [
				"error",
				"window",
				"document",
				"HTMLElement",
				"Document",
				"Window",
				"Menu",
			],
		},
	},
	{
		files: ["**/*.vue"],
		languageOptions: {
			parserOptions: { parser: tseslint.parser, extraFileExtensions: [".vue"] },
		},
	},
	{
		files: ["**/*.{ts,vue,mjs}"],
		rules: {
			"vue/multi-word-component-names": "off",
			"vue/html-self-closing": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
		},
	},
);
