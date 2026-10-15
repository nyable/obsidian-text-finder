import { bundleSource } from './bundle-source.mjs';
import { colorPickerModule } from '../tools/color-picker-build.mjs';
import { loadSource } from './source-loader.mjs';
import { appearanceSource } from './history-source.mjs';

// Exercise the same owner-window library factory used by the production build.
const bundle = await bundleSource({ source: await colorPickerModule() });
const module = { exports: {} };
new Function('module', 'exports', bundle)(module, module.exports);
export const librarySource = module.exports;
export const pickerSource = loadSource('../src/color-picker.ts', {
	'virtual:color-picker': librarySource, './appearance': appearanceSource,
	'./i18n': { i18n: { t: (key) => key } },
});
