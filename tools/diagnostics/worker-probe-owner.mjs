// Exact host identities stay on the main thread, never serialized to a Worker.
export function captureOwner(workspace, view, lifecycle, queryVersion) {
	let open = false;
	workspace.iterateAllLeaves((leaf) => {
		if (leaf.view === view) open = true;
	});
	if (!open || view.getMode() !== "source")
		throw new Error(
			"Bind an open Markdown view in editing mode; preview snapshots are not reading-text indexes.",
		);
	const editor = view.editor,
		editorView = editor?.cm,
		doc = editorView?.state?.doc;
	if (!doc || !view.containerEl?.ownerDocument?.defaultView)
		throw new Error("Owner CodeMirror document/window unavailable");
	return {
		view,
		file: view.file,
		path: view.file?.path,
		editor,
		editorView,
		doc,
		window: view.containerEl.ownerDocument.defaultView,
		lifecycle,
		queryVersion,
		source: doc.toString(),
	};
}

export function ownerInvalidation(workspace, captured, lifecycle) {
	if (captured.lifecycle !== lifecycle) return "lifecycle-changed";
	let open = false;
	workspace.iterateAllLeaves((leaf) => {
		if (leaf.view === captured.view) open = true;
	});
	if (!open) return "owner-closed";
	if (
		captured.view.containerEl.ownerDocument.defaultView !== captured.window ||
		captured.window.closed
	)
		return "owner-window-changed";
	if (captured.view.file !== captured.file || captured.view.file?.path !== captured.path)
		return "file-changed";
	if (captured.view.getMode() !== "source") return "mode-changed";
	if (captured.view.editor !== captured.editor || captured.view.editor.cm !== captured.editorView)
		return "editor-rebuilt";
	if (captured.editorView.state.doc !== captured.doc) return "document-changed";
	return null;
}
