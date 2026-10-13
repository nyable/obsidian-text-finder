import { build } from "esbuild";

// Bundle the unregistered library base inside an owner-window factory. This
// supplies the globals used by the library without eval or changing its code.
export async function colorPickerModule() {
	const result = await build({ stdin: { contents: "export { HexAlphaBase } from 'vanilla-colorful/lib/entrypoints/hex-alpha';", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", globalName: "PickerLibrary", target: "es2018" });
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
			${result.outputFiles[0].text}
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

export function colorPickerPlugin() {
	return { name: "owner-color-picker", setup(build) {
		build.onResolve({ filter: /^virtual:color-picker$/ }, () => ({ path: "color-picker", namespace: "owner-picker" }));
		build.onLoad({ filter: /.*/, namespace: "owner-picker" }, async () => ({ contents: await colorPickerModule(), loader: "js" }));
	} };
}
