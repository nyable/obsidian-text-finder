module.exports = {
	forbidden: [
		{
			name: "application-has-no-runtime-framework",
			severity: "error",
			from: { path: "^src/features/[^/]+/(model|application)/" },
			to: {
				path: "^(src/(app|platform)/|(?:node_modules/)?(?:vue|obsidian|@codemirror)(?:/|$))",
			},
		},
		...["finder", "reading", "history", "settings"].map((feature) => ({
			name: `${feature}-public-api-only`,
			severity: "error",
			from: { path: "^src/(?:app|features|platform)/", pathNot: `^src/features/${feature}/` },
			to: {
				path: `^src/features/${feature}/`,
				pathNot: `^src/features/${feature}/(?:index|ui|contracts)\\.ts$`,
			},
		})),
		{
			name: "platform-does-not-mount-ui",
			severity: "error",
			from: { path: "^src/platform/" },
			to: {
				path: "^src/features/.+/(ui|interaction)/|^src/features/[^/]+/ui\\.ts$|^src/shared/ui/",
			},
		},
		{
			name: "platform-only-uses-feature-contracts",
			severity: "error",
			from: { path: "^src/platform/" },
			to: { path: "^src/features/", dependencyTypesNot: ["type-only"] },
		},
		{ name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
		{
			name: "core-is-pure",
			severity: "error",
			from: { path: "^src/core/" },
			to: {
				path: "^(src/(app|features|platform|shared|i18n)/|(?:node_modules/)?(?:vue|obsidian|@codemirror)(?:/|$))",
			},
		},
		{
			name: "shared-is-independent",
			severity: "error",
			from: { path: "^src/shared/" },
			to: { path: "^(src/(app|features|platform)/|obsidian$)" },
		},
		{
			name: "no-app-backreference",
			severity: "error",
			from: { path: "^src/(core|features|platform|shared)/" },
			to: { path: "^src/(app/|main\\.ts$)" },
		},
	],
	options: {
		tsPreCompilationDeps: true,
		tsConfig: { fileName: "tsconfig.json" },
		doNotFollow: { path: "node_modules" },
		exclude: { path: "node_modules" },
	},
};
