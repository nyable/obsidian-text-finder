import type { TFile, Vault } from "obsidian";
import type { EditorContext } from "./editor-context";
import type {
	DocumentSnapshot,
	EditingSnapshot,
	EditorPort,
	FileIdentity,
} from "../../features/finder/contracts";
import {
	finderSelection,
	searchCacheEffect,
	searchScopeEffect,
	searchScopeField,
} from "./search-highlight";
import { getLivePreviewPreference } from "../obsidian/live-preview";

/** Maps host identities to owner-local opaque tokens. No host object enters Vue state. */
export function createFinderEditor(
	context: () => EditorContext | null,
	vault: () => Vault,
	ownerFile: () => TFile | null,
): EditorPort {
	const tokens = new WeakMap<object, object>();
	const documents = new WeakMap<object, DocumentSnapshot>();
	const files = new WeakMap<object, FileIdentity>();
	const contexts = new WeakMap<EditingSnapshot, EditorContext>();
	const token = (value: object) => {
		let identity = tokens.get(value);
		if (!identity) {
			identity = {};
			tokens.set(value, identity);
		}
		return identity;
	};
	const file = (value: TFile | null) => {
		if (!value) return null;
		let identity = files.get(value);
		if (!identity) {
			identity = {
				get path() {
					return value.path;
				},
			};
			files.set(value, identity);
		}
		return identity;
	};
	const raw = (snapshot: EditingSnapshot) => {
		const value = contexts.get(snapshot);
		if (!value) throw new Error("Unknown editing snapshot");
		return value;
	};
	return {
		ownerFile: () => file(ownerFile()),
		current() {
			const value = context();
			if (!value) return null;
			let doc = documents.get(value.doc);
			if (!doc) {
				const text = value.doc;
				doc = { length: text.length, toString: () => text.toString() };
				documents.set(text, doc);
			}
			const snapshot = {
				view: token(value.view),
				editor: token(value.editor),
				editorView: token(value.editorView),
				file: file(value.file),
				doc,
			};
			contexts.set(snapshot, value);
			return snapshot;
		},
		scope(snapshot) {
			return raw(snapshot).editorView.state.field(searchScopeField, false);
		},
		documentLength(snapshot) {
			return raw(snapshot).editorView.state.doc.length;
		},
		setScope(snapshot, ranges) {
			raw(snapshot).editorView.dispatch({
				effects: searchScopeEffect.of(ranges ? [...ranges] : null),
			});
		},
		publish(snapshot, highlight, selection) {
			const value = raw(snapshot);
			value.editorView.dispatch({
				annotations: finderSelection.of(true),
				effects: highlight
					? [
							searchCacheEffect.of({
								...highlight,
								matches: highlight.matches,
								doc: value.doc,
							}),
						]
					: [],
				...(selection ? { selection } : {}),
			});
		},
		commit(snapshot, changes) {
			const captured = raw(snapshot),
				current = context();
			if (
				!current ||
				current.view !== captured.view ||
				current.editor !== captured.editor ||
				current.editorView !== captured.editorView ||
				current.file !== captured.file ||
				current.doc !== captured.doc
			)
				throw new Error("Editing context changed before replacement commit");
			captured.editorView.dispatch({ changes });
		},
		hasCommitted(snapshot) {
			const value = raw(snapshot);
			return value.editorView.state.doc !== value.doc;
		},
		reveal(snapshot, match, sourceMode) {
			const { editor, view } = raw(snapshot);
			editor.scrollIntoView(
				{ from: editor.offsetToPos(match.from), to: editor.offsetToPos(match.to) },
				true,
			);
			const state = view.getState();
			if (sourceMode && state.mode === "source") state.source = true;
			return view.setState(state, { history: false });
		},
		restoreMode(snapshot) {
			const { view } = raw(snapshot),
				state = view.getState();
			if (state.mode !== "source") return;
			const preference = getLivePreviewPreference(vault());
			if (preference === undefined) return;
			state.source = !preference;
			return view.setState(state, { history: false });
		},
	};
}
