import { Annotation, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
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

export const searchScopeDecoration = EditorView.decorations.compute([searchScopeField], (state) =>
	Decoration.set(normalizeSearchRanges(state.field(searchScopeField).ranges ?? [], state.doc.length)
		.map(({ from, to }) => Decoration.mark({ class: "nya-text-finder-scope" }).range(from, to))));
