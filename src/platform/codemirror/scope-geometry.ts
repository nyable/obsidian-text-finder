import type { Line } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ScopeRect } from "../../shared/geometry/scope-outline";
import { sourceLineCoords, sourcePositionVisible, visibleSourceLines } from "./editor-geometry";

/** Supplement text boxes only for visible whitespace lines inside their exact source scope. */
export function addScopeBlankLines(
	view: EditorView,
	ranges: readonly SearchRange[],
	groups: Map<string, ScopeRect[]>,
	origin: { left: number; top: number },
) {
	const lines = [...visibleSourceLines(view)],
		visible = new Set(lines.map((line) => line.number));
	let scope = 0;
	for (let i = 0; i < lines.length; i++) {
		const first = lines[i];
		if (!first) continue;
		while (scope < ranges.length && (ranges[scope]?.to ?? Infinity) <= first.from) scope++;
		const range = ranges[scope];
		if (
			!range ||
			range.from > first.from ||
			range.to <= first.to ||
			!/^[\t ]*$/.test(first.text) ||
			!sourcePositionVisible(view, first.from)
		)
			continue;
		const blanks: { line: Line; box: ScopeRect }[] = [];
		for (let j = i; j < lines.length; j++) {
			const line = lines[j];
			if (!line) break;
			if (j > i && line.number !== (lines[j - 1]?.number ?? 0) + 1) break;
			if (
				range.to <= line.to ||
				!/^[\t ]*$/.test(line.text) ||
				!sourcePositionVisible(view, line.from)
			)
				break;
			const box = sourceLineCoords(view, line, line.from, 1);
			if (!box) break;
			blanks.push({
				line,
				box: {
					left: box.left - origin.left,
					right: box.right - origin.left,
					top: box.top - origin.top,
					bottom: box.bottom - origin.top,
				},
			});
		}
		const head = blanks[0],
			last = blanks.at(-1);
		if (!head || !last) continue;
		i += blanks.length - 1;
		const rects = groups.get(String(scope)) ?? [];
		const additions: ScopeRect[] = [];
		const neighbor = (number: number, side: -1 | 1) => {
			if (!visible.has(number)) return [];
			const line = view.state.doc.line(number),
				pos = side === -1 ? line.to : line.from;
			if (pos < range.from || pos >= range.to || !sourcePositionVisible(view, pos)) return [];
			const box = sourceLineCoords(view, line, pos, side);
			if (!box) return [];
			return rects.filter(
				(r) => r.top < box.bottom - origin.top && r.bottom > box.top - origin.top,
			);
		};
		const above = neighbor(first.number - 1, -1),
			below = neighbor(last.line.number + 1, 1);
		// Ambiguous bidi fragments must not acquire a corridor across their holes.
		if (above.length > 1 || below.length > 1) continue;
		let overlap: { left: number; right: number } | undefined;
		for (const a of above)
			for (const b of below) {
				const left = Math.max(a.left, b.left),
					right = Math.min(a.right, b.right);
				if (right > left && (!overlap || right - left > overlap.right - overlap.left))
					overlap = { left, right };
			}
		const top = above.length ? Math.max(...above.map((r) => r.bottom)) : head.box.top;
		const bottom = below.length ? Math.min(...below.map((r) => r.top)) : last.box.bottom;
		if (overlap)
			additions.push({
				...overlap,
				top: Math.min(top, head.box.top),
				bottom: Math.max(bottom, last.box.bottom),
			});
		else {
			// No common text width: route a narrow orthogonal corridor through
			// the measured blank-line insertion point, not a full-width box.
			const width = Math.max(2, Math.min(8, head.box.bottom - head.box.top) / 2);
			const x = head.box.left - (view.textDirectionAt(first.from) === 1 ? width : 0);
			const middle = (head.box.top + last.box.bottom) / 2;
			additions.push({
				left: x,
				right: x + width,
				top: Math.min(top, head.box.top),
				bottom: Math.max(bottom, last.box.bottom),
			});
			for (const [neighbors, upper] of [
				[above, true],
				[below, false],
			] as const) {
				const nearest = [...neighbors].sort((a, b) => distance(a, x) - distance(b, x))[0];
				if (!nearest) continue;
				const legWidth = Math.min(width, nearest.right - nearest.left);
				const edge = Math.max(nearest.left, Math.min(x, nearest.right - legWidth));
				additions.push({
					left: edge,
					right: edge + legWidth,
					top: upper ? Math.min(top, head.box.top) : middle - width / 2,
					bottom: upper ? middle + width / 2 : Math.max(bottom, last.box.bottom),
				});
				additions.push({
					left: Math.min(edge, x),
					right: Math.max(edge + legWidth, x + width),
					top: middle - width / 2,
					bottom: middle + width / 2,
				});
			}
		}
		// A visual detour must never join another source selection.
		if (
			[...groups].some(
				([id, other]) =>
					id !== String(scope) &&
					additions.some((a) =>
						other.some(
							(b) =>
								a.left <= b.right &&
								a.right >= b.left &&
								a.top <= b.bottom &&
								a.bottom >= b.top,
						),
					),
			)
		)
			continue;
		groups.set(String(scope), [...rects, ...additions]);
	}
}

const distance = (rect: ScopeRect, x: number) => Math.max(rect.left - x, x - rect.right, 0);
import type { SearchRange } from "../../core/search/types";
