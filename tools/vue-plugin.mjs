import vue from "@vitejs/plugin-vue";

/** All builds use owner-created VNodes, never compiler-stringified HTML. */
export function ownerVue() {
	return vue({ template: { compilerOptions: { hoistStatic: false } } });
}
