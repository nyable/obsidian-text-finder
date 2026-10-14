import { Annotation, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, layer, type LayerMarker } from "@codemirror/view";
import { measureScopeRects, normalizeScopeRects, paddedScopeOutlines, createScopeSvg } from "./scope-outline";
import { editorLayerOrigin } from "./editor-geometry";
import { addScopeBlankLines } from "./scope-geometry";
import { normalizeSearchRanges } from "./util/text-helper";

/** Finder navigation must never replace the user's scope candidate. */
export const finderSelection = Annotation.define<boolean>();
export const searchScopeEffect = StateEffect.define<readonly SearchRange[] | null>();
export const searchScopeField = StateField.define<{
	ranges: readonly SearchRange[] | null;
	candidate: readonly SearchRange[];
}>({
	create: (state) => ({ ranges: null, candidate: state.selection.ranges.filter((range) => !range.empty)
		.map(({ from, to }) => ({ from, to })) }),
	update(value, transaction) {
		let { ranges, candidate } = value;
		if (transaction.docChanged) {
			// Mapping cannot recover an interior boundary after a deletion crosses
			// it. Fail closed rather than widening to the removed text on undo.
			ranges = ranges?.filter(({ from, to }) => {
				let crossed = false;
				transaction.changes.iterChangedRanges((start, end) => {
					if ((start < from && end > from) || (start < to && end > to)) crossed = true;
				});
				return !crossed;
			}) ?? null;
			// Include insertion/replacement at both edges, including replacing the
			// complete scope. Keep collapsed anchors so undo can restore the range.
			ranges = ranges?.map(({ from, to }) => ({ from: transaction.changes.mapPos(from, -1),
				to: transaction.changes.mapPos(to, 1) })) ?? null;
			candidate = [];
		}
		if (transaction.selection && !transaction.annotation(finderSelection)) {
			candidate = transaction.state.selection.ranges.filter((range) => !range.empty).map(({ from, to }) => ({ from, to }));
		}
		for (const effect of transaction.effects) if (effect.is(searchScopeEffect)) ranges = effect.value === null
			? null : normalizeSearchRanges(effect.value, transaction.state.doc.length);
		return ranges === value.ranges && candidate === value.candidate ? value : { ranges, candidate };
	},
});

const scopeBackground = EditorView.decorations.compute([searchScopeField], (state) =>
	Decoration.set(normalizeSearchRanges(state.field(searchScopeField).ranges ?? [], state.doc.length)
		.map(({ from, to }, index) => Decoration.mark({ class: "nya-text-finder-scope",
			attributes: { "data-nya-scope": String(index) } }).range(from, to))));

class ScopeOutlineMarker implements LayerMarker {
	constructor(private doc: Document, private path: string) {}
	eq(other: ScopeOutlineMarker) { return this.doc === other.doc && this.path === other.path; }
	draw() {
		const element = this.doc.createElement("div"); element.append(createScopeSvg(this.doc, this.path));
		return element;
	}
}

const styleListeners = new WeakMap<HTMLElement, { doc: Document; refresh: () => void }>();
const connectStyleListener = (element: HTMLElement, view: EditorView) => {
	const previous = styleListeners.get(element), doc = view.dom.ownerDocument;
	if (previous?.doc === doc) return;
	if (previous) previous.doc.removeEventListener("nya-scope-style-change", previous.refresh);
	const refresh = () => view.dispatch({});
	styleListeners.set(element, { doc, refresh }); doc.addEventListener("nya-scope-style-change", refresh);
};
export const scopeOutlineLayer = {
	above: true, class: "nya-scope-layer",
	update(update: { view: EditorView }, element: HTMLElement) { connectStyleListener(element, update.view); return true; },
	mount(element: HTMLElement, view: EditorView) {
		connectStyleListener(element, view);
	},
	destroy(element: HTMLElement) {
		const previous = styleListeners.get(element);
		if (previous) previous.doc.removeEventListener("nya-scope-style-change", previous.refresh);
		styleListeners.delete(element);
	},
	markers(view: EditorView) {
		if (!view.state.field(searchScopeField, false)?.ranges?.length) return [];
		const win = view.dom.ownerDocument.defaultView;
		const width = parseFloat(win?.getComputedStyle(view.dom).getPropertyValue("--nya-scope-border-width") ?? "");
		if (!(width > 0)) return [];
		const origin = editorLayerOrigin(view), groups = normalizeScopeRects(measureScopeRects(view.contentDOM, origin));
		addScopeBlankLines(view, normalizeSearchRanges(view.state.field(searchScopeField).ranges ?? [], view.state.doc.length), groups, origin);
		return paddedScopeOutlines([...groups.values()], width)
			.map((path) => new ScopeOutlineMarker(view.dom.ownerDocument, path));
	},
};
// Older host CodeMirror builds can retain background-only presentation.
export const searchScopeDecoration = [scopeBackground, typeof layer === "function" ? layer(scopeOutlineLayer) : []];
