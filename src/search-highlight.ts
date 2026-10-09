import { RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

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
	provide: (field) => EditorView.decorations.from(field),
});
