import type { MatchOffset, SearchRange } from "../../../core/search/types";
import type { ReplacementChange } from "../../../core/search/text-matching";

/** Stable tokens carry identity, never a CodeMirror or Obsidian instance. */
export interface FileIdentity {
	readonly path: string;
}
export interface DocumentSnapshot {
	readonly length: number;
	toString(): string;
}
export interface EditingSnapshot {
	readonly view: object;
	readonly editor: object;
	readonly editorView: object;
	readonly file: FileIdentity | null;
	readonly doc: DocumentSnapshot;
}

export interface ReplacementCommitResult {
	changed: boolean;
	complete: boolean;
	/** A known write refusal, distinct from a matching/Worker failure. */
	rejection?: "readOnly";
	/** Unknown when the host changed the document differently from the request. */
	changeCount: number | null;
}

export interface EditorPort {
	ownerFile(): FileIdentity | null;
	current(): EditingSnapshot | null;
	scope(
		snapshot: EditingSnapshot,
	): { ranges: readonly SearchRange[] | null; candidate: readonly SearchRange[] } | undefined;
	documentLength(snapshot: EditingSnapshot): number;
	setScope(snapshot: EditingSnapshot, ranges: readonly SearchRange[] | null): void;
	publish(
		snapshot: EditingSnapshot,
		highlight: { visible: boolean; index: number; matches: readonly MatchOffset[] } | undefined,
		selection?: { anchor: number; head: number },
	): void;
	commit(snapshot: EditingSnapshot, changes: readonly ReplacementChange[]): void;
	commitResult(snapshot: EditingSnapshot): ReplacementCommitResult;
	reveal(
		snapshot: EditingSnapshot,
		match: MatchOffset,
		sourceMode: boolean,
	): void | Promise<void>;
	restoreMode(snapshot: EditingSnapshot): void | Promise<void>;
}
