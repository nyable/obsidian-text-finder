import { compileComponents, fixtureAdapter } from "./vue-components.mjs";
const bundle = await compileComponents(fixtureAdapter + `
 import View from '/src/ToolbarPreview.vue'; export const ToolbarPreview = fixture(View);
 export {mountView} from '/src/ui/mount'; export {default as PreviewView} from '/src/ToolbarPreview.vue';`, {
	"./i18n": `export const i18n = {t: (key, values) => key + (values?.name ? ': ' + values.name : '')};`,
});
// Evaluate lazily, after the suite has installed its owner Document. Vue's DOM
// renderer captures its creation Document when initialized.
let exports;
function runtime() {
	if (!exports) {
		globalThis.Element = window.Element; globalThis.SVGElement = window.SVGElement;
		const module = {exports: {}};
		new Function("module", "exports", bundle.code)(module, module.exports); exports = module.exports;
	}
	return exports;
}
export const previewStyles = bundle.styles;
export const tick = () => runtime().tick();
export class ToolbarPreview { constructor(options) { return new (runtime().ToolbarPreview)(options); } }
export const mountPreview = (_component, target, props) => runtime().mountView(runtime().PreviewView, target, props);
