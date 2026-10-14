import { RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, layer, type DecorationSet, type LayerMarker } from "@codemirror/view";
import { editorLayerOrigin, sourceLineCoords, sourcePositionVisible, visibleSourceLines } from "./editor-geometry";
export { finderSelection, searchScopeEffect, searchScopeField, searchScopeDecoration } from "./search-scope";

export const CLS = {
	FINDER: "nya-finder",
	MATCH: "nya-text-finder-match",
	MATCH_CURRENT: "nya-text-finder-match-current",
};

export interface SearchHighlight {
	doc: Text;
	visible: boolean;
	index: number;
	matches: MatchOffset[];
}

// Offsets always belong to this exact CodeMirror document, not a mutable cache.
export const searchCacheEffect = StateEffect.define<SearchHighlight>();

export const textMatchMarker = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(oldState, transaction) {
		// A write always invalidates search semantics (including lookarounds).
		// Results are submitted separately against the committed document.
		if (transaction.docChanged) return Decoration.none;
		let result = oldState;
		for (const effect of transaction.effects) {
			if (!effect.is(searchCacheEffect) || effect.value.doc !== transaction.state.doc) continue;
			const { visible, matches, index } = effect.value;
			const builder = new RangeSetBuilder<Decoration>();
			let previousFrom = -1;
			if (visible) {
				matches.forEach(({ from, to }, matchIndex) => {
					if (!Number.isInteger(from) || !Number.isInteger(to)
						|| from < 0 || from >= to || to > transaction.state.doc.length
						|| from < previousFrom) return;
					builder.add(from, to, Decoration.mark({
						class: `${CLS.MATCH}${index === matchIndex ? ` ${CLS.MATCH_CURRENT}` : ""}`,
					}));
					previousFrom = from;
				});
			}
			// The last valid effect in a transaction wins, including explicit clears.
			result = builder.finish();
		}
		return result;
	},
	provide: (field) => [EditorView.decorations.from(field), typeof layer === "function" ? layer(createNewlineMatchLayer()) : []],
});

class NewlineMatchMarker implements LayerMarker {
	constructor(private doc: Document, private left: number, private top: number, private width: number,
		private height: number, private current: boolean, private rtl: boolean) {}
	eq(other: NewlineMatchMarker) {
		return this.doc === other.doc && this.left === other.left && this.top === other.top && this.width === other.width
			&& this.height === other.height && this.current === other.current && this.rtl === other.rtl;
	}
	draw() {
		const element = this.doc.createElement("div");
		element.className = `nya-newline-match ${CLS.MATCH}${this.current ? ` ${CLS.MATCH_CURRENT}` : ""}`;
		element.setAttribute("aria-hidden", "true");
		element.dataset.direction = this.rtl ? "rtl" : "ltr";
		// CSS draws the glyph: no synthetic text enters the editor DOM's textContent.
		element.style.left = `${this.left}px`; element.style.top = `${this.top}px`;
		element.style.width = `${this.width}px`; element.style.height = `${this.height}px`;
		element.style.fontSize = `${this.width}px`;
		return element;
	}
}

/** One decorative glyph per matched source line break, not per soft wrap or EOF. */
export const newlineMatchLayer = createNewlineMatchLayer();
// StateField.define calls provide immediately, before later const initializers.
function createNewlineMatchLayer() { return {
	above: true, class: "nya-newline-layer",
	update() { return true; },
	markers(view: EditorView) {
		const decorations = view.state.field(textMatchMarker, false);
		if (!decorations?.size) return [];
		const origin = editorLayerOrigin(view), markers: NewlineMatchMarker[] = [];
		for (const line of visibleSourceLines(view)) {
			if (line.to === view.state.doc.length || !sourcePositionVisible(view, line.to)) continue;
			let matched = false, current = false;
			decorations.between(line.to, line.to, (from, to, mark) => {
				if (from <= line.to && line.to < to) {
					matched = true; current ||= mark.spec.class.split(" ").includes(CLS.MATCH_CURRENT);
				}
			});
			if (!matched) continue;
			const box = sourceLineCoords(view, line, line.to, -1);
			if (!box) continue;
			const rtl = view.textDirectionAt(line.to) === 1;
			const height = box.bottom - box.top, width = Math.max(6, Math.min(height, view.defaultCharacterWidth * view.scaleX));
			markers.push(new NewlineMatchMarker(view.dom.ownerDocument, (rtl ? box.left - width : box.right) - origin.left,
				box.top - origin.top, width, height, current, rtl));
		}
		return markers;
	},
}; }
