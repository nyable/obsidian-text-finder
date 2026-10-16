import { embeddedBundle } from "./vite-build.mjs";

// Bundle the unregistered library base inside an owner-window factory. This
// supplies the globals used by the library without eval or changing its code.
export async function colorPickerModule({ watch = () => {} } = {}) {
	const result = await embeddedBundle({
		source: "export { HexAlphaBase } from 'vanilla-colorful/lib/entrypoints/hex-alpha';",
		name: "PickerLibrary",
	});
	for (const path of Object.keys(result.modules)) if (!path.startsWith("\0")) watch(path);
	return `export function createColorPicker(doc) {
		const window = doc.defaultView;
		const HTMLElement = window.HTMLElement;
		const CustomEvent = window.CustomEvent;
		const tag = 'nya-hex-alpha-picker-v1';
		if (!window.customElements.get(tag)) {
			const listeners = new Map();
			const document = {
				createElement: doc.createElement.bind(doc),
				addEventListener(type, handler) {
					if (!listeners.has(handler)) listeners.set(handler, new Set());
					listeners.get(handler).add(type); doc.addEventListener(type, handler, { passive: false });
				},
				removeEventListener(type, handler) {
					doc.removeEventListener(type, handler); const types = listeners.get(handler);
					types?.delete(type); if (!types?.size) listeners.delete(handler);
				}
			};
			${result.code}
			class OwnerPicker extends PickerLibrary.HexAlphaBase {
				disconnectedCallback() { this.release(); }
				release() {
					for (const [handler, types] of listeners) {
						if (handler.el?.getRootNode().host === this) {
						for (const type of types) doc.removeEventListener(type, handler);
						listeners.delete(handler);
						}
					}
				}
			}
			window.customElements.define(tag, OwnerPicker);
		}
		return doc.createElement(tag);
	}`;
}
