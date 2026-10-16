declare module "virtual:color-picker" {
	interface ColorPickerElement extends HTMLElement {
		color: string;
		release(): void;
	}
	export function createColorPicker(doc: Document): ColorPickerElement;
}
