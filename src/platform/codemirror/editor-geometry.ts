import type { Line } from "@codemirror/state";
import { BlockType, Direction, type EditorView } from "@codemirror/view";

/** CodeMirror layers compensate for editor scale; measurements stay in client pixels. */
export function editorLayerOrigin(view: EditorView) {
	const bounds = view.scrollDOM.getBoundingClientRect();
	const left =
		view.textDirection === Direction.LTR
			? bounds.left
			: bounds.right - view.scrollDOM.clientWidth * view.scaleX;
	return {
		left: left - view.scrollDOM.scrollLeft * view.scaleX,
		top: bounds.top - view.scrollDOM.scrollTop * view.scaleY,
	};
}

/** Visit only rendered source intervals, never scan an offscreen/ folded document. */
export function* visibleSourceLines(view: EditorView): Generator<Line> {
	let previous = 0;
	for (const range of view.visibleRanges ?? []) {
		let line = view.state.doc.lineAt(range.from);
		while (line.from <= range.to) {
			if (line.number > previous) {
				previous = line.number;
				yield line;
			}
			if (line.to >= range.to || line.number === view.state.doc.lines) break;
			line = view.state.doc.line(line.number + 1);
		}
	}
}

export function sourcePositionVisible(view: EditorView, pos: number) {
	return view.visibleRanges.some(({ from, to }) => from <= pos && pos < to);
}

/** Reject replaced/folded blocks and invalid/unavailable host measurements. */
export function sourceLineCoords(view: EditorView, line: Line, pos: number, side: -1 | 1) {
	if (typeof view.lineBlockAt !== "function" || typeof view.coordsAtPos !== "function")
		return null;
	const block = view.lineBlockAt(pos);
	if (block.type !== BlockType.Text || block.from !== line.from || block.to !== line.to)
		return null;
	const box = view.coordsAtPos(pos, side);
	return box &&
		[box.left, box.right, box.top, box.bottom].every(Number.isFinite) &&
		box.bottom > box.top
		? box
		: null;
}
