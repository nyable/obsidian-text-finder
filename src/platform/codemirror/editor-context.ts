import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Editor, MarkdownView, TFile } from "obsidian";

export interface EditorContext {
	view: MarkdownView;
	editor: Editor;
	editorView: EditorView;
	file: TFile | null;
	doc: Text;
}
