import type { MarkdownView } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { EditorContext } from "../codemirror/editor-context";

/** Obsidian's public Editor omits its CodeMirror instance. Identity and write
 * authority are still revalidated by FinderEditor at the commit boundary. */
export function editorContextFor(view: MarkdownView): EditorContext | null {
	const editor = view.editor;
	const cm = (editor as (typeof editor & { cm?: EditorView }) | undefined)?.cm;
	if (!cm?.state?.doc) return null;
	return { view, editor, editorView: cm, file: view.file, doc: cm.state.doc };
}
