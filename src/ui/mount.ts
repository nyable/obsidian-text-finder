import { createRenderer, nodeOps, patchProp, h, shallowReactive, type Component, type ComponentPublicInstance } from "vue";

let nextAppId = 0;
export interface MountedView<P> { update(props: Partial<P>): void; destroy(): void }

/** Each host owns a separate app; never proxy Obsidian/CodeMirror objects. */
export function mountView<P extends Record<string, unknown>>(component: Component, target: HTMLElement, initial: P) {
	const props = shallowReactive({ ...initial });
	const container = target.ownerDocument.createElement("div");
	// An unmounted bookkeeping container isolates Vue's root vnode per app.
	// Redirect its insertions into an owner-local range without a layout wrapper.
	const end = target.ownerDocument.createComment("text-finder-view");
	target.append(end);
	let instance: ComponentPublicInstance | null = null;
	// Vue's default DOM renderer captures the initialization Document. Use its
	// public renderer API with owner-bound creation operations for pop-out views.
	const renderer = createRenderer<Node, Element>({ ...nodeOps, patchProp,
		insert(child, parent, anchor) {
			if (parent === container) target.insertBefore(child, anchor ?? end);
			else parent.insertBefore(child, anchor ?? null);
		},
		createElement(tag, namespace, is, props) {
			const doc = target.ownerDocument;
			const element = namespace === "svg" ? doc.createElementNS("http://www.w3.org/2000/svg", tag)
				: namespace === "mathml" ? doc.createElementNS("http://www.w3.org/1998/Math/MathML", tag)
				: doc.createElement(tag, is ? {is} : undefined);
			if (tag === "select" && props?.multiple != null) element.setAttribute("multiple", props.multiple);
			return element;
		},
		createText: (text) => target.ownerDocument.createTextNode(text),
		createComment: (text) => target.ownerDocument.createComment(text),
		insertStaticContent(content, parent, anchor, namespace) {
			const doc = target.ownerDocument;
			const template = doc.createElement("template");
			template.innerHTML = namespace === "svg" ? `<svg>${content}</svg>` : namespace === "mathml" ? `<math>${content}</math>` : content;
			const fragment = template.content;
			if (namespace) { const wrapper = fragment.firstChild!; while (wrapper.firstChild) fragment.append(wrapper.firstChild); fragment.removeChild(wrapper); }
			const first = fragment.firstChild!, last = fragment.lastChild!;
			if (parent === container) target.insertBefore(fragment, anchor ?? end);
			else parent.insertBefore(fragment, anchor);
			return [first, last];
		},
	});
	const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { instance = value as ComponentPublicInstance; } }) });
	app.config.idPrefix = `nya-${++nextAppId}-`;
	try { app.mount(container); }
	catch (error) { app.unmount(); end.remove(); throw error; }
	let disposed = false;
	return {
		get exposed() { return instance as unknown as Record<string, unknown>; },
		update(next: Partial<P>) { if (!disposed) Object.assign(props, next); },
		destroy() { if (disposed) return; disposed = true; app.unmount(); end.remove(); },
	};
}
