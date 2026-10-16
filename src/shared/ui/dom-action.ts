import type { ObjectDirective } from "vue";

export interface DomAction<T = unknown> {
	(node: HTMLElement, value: T): { update?(value: T): void; destroy?(): void };
}
/** Adapter for framework-independent DOM resources with explicit ownership. */
export function actionDirective<T>(action: DomAction<T>): ObjectDirective<HTMLElement, T> {
	const resources = new WeakMap<HTMLElement, ReturnType<DomAction<T>>>();
	return {
		mounted(node, binding) {
			resources.set(node, action(node, binding.value));
		},
		updated(node, binding) {
			resources.get(node)?.update?.(binding.value);
		},
		beforeUnmount(node) {
			resources.get(node)?.destroy?.();
			resources.delete(node);
		},
	};
}
