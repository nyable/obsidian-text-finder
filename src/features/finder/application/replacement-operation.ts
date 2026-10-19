import type { EditingSnapshot } from "./editor-port";
import type { MatchResult } from "../../../core/search/match-protocol";
import type { ReplaceResult, SearchOptions, SearchRange } from "../../../core/search/types";
import { findTextOffsets, prepareReplacements } from "../../../core/search/text-matching";

export interface ReplacementTask {
	context: EditingSnapshot;
	key: string;
	window: object | null;
	path: string | undefined;
	replace: string;
	escape: boolean;
	phase: "prepare" | "committing" | "committed";
	scopeEpoch: number;
	searchKey: string;
}

interface ReplacementEffects {
	current(): boolean;
	ranges(): readonly SearchRange[] | undefined;
	prepared(result: Extract<MatchResult, { status: "completed" }>): void;
	commit(changes: NonNullable<Extract<MatchResult, { status: "completed" }>["changes"]>): void;
	hasCommitted(): boolean;
	committed(): EditingSnapshot | null;
	pending(): void;
	finish(result: MatchResult): boolean | Promise<boolean>;
	failed(error: unknown, committed: boolean): void;
	clear(): void;
	noChanges(): void;
	commitFailed(): void;
	replace(source: string, replacement: string): MatchResult | Promise<MatchResult>;
	match(source: string): MatchResult | Promise<MatchResult>;
}

/** Owns only the prepare → single commit → rematch sequence. The caller owns
 * query/owner validity and navigation; no operation can replay a committed edit. */
export function runReplacement(
	task: ReplacementTask,
	query: string,
	options: SearchOptions,
	replacement: string,
	index: number,
	all: boolean,
	synchronous: boolean,
	result: ReplaceResult,
	effects: ReplacementEffects,
): ReplaceResult | Promise<ReplaceResult> {
	const fail = (error: unknown) => {
		if (effects.current()) effects.failed(error, task.phase === "committed");
		return result;
	};
	const apply = (prepared: MatchResult): ReplaceResult => {
		if (!effects.current()) {
			effects.clear();
			return result;
		}
		if (prepared.status === "failed") {
			effects.failed(prepared.error, false);
			return result;
		}
		if (prepared.status === "cancelled") {
			effects.clear();
			return result;
		}
		effects.prepared(prepared);
		result.beforeCount = result.afterCount = prepared.matches.length;
		const changes = prepared.changes ?? [],
			ranges = effects.ranges();
		if (
			ranges &&
			changes.some(
				({ from, to }) => !ranges.some((range) => from >= range.from && to <= range.to),
			)
		) {
			effects.failed(new Error("Replacement outside search scope"), false);
			return result;
		}
		if (!changes.length) {
			result.status = "completed";
			effects.clear();
			effects.noChanges();
			return result;
		}
		try {
			task.phase = "committing";
			effects.commit(changes);
			// dispatch can return normally after a host transaction filter rejects
			// the edit. Only an accepted document transaction may advance/rematch.
			if (!effects.hasCommitted()) throw new Error("Replacement transaction was not applied");
		} catch (error) {
			task.phase = "prepare";
			const committed = effects.hasCommitted();
			result.changed = committed;
			result.changeCount = committed ? changes.length : 0;
			effects.failed(error, committed);
			effects.commitFailed();
			return result;
		} finally {
			if (task.phase === "committing") task.phase = "prepare";
		}
		result.changed = true;
		result.changeCount = changes.length;
		result.status = "completed";
		task.phase = "committed";
		const current = effects.committed();
		if (!current) {
			result.navigationFailed = true;
			effects.clear();
			return result;
		}
		effects.pending();
		try {
			const source = current.doc.toString();
			const matched = synchronous
				? {
						status: "completed" as const,
						matches: findTextOffsets(
							source,
							query,
							options.regexMode,
							options.caseSensitive,
							options.wholeWord,
							effects.ranges(),
						),
						synchronous: true,
					}
				: effects.match(source);
			const positioned =
				matched instanceof Promise ? matched.then(effects.finish) : effects.finish(matched);
			if (positioned instanceof Promise)
				result.navigationCompletion = positioned
					.then((success) => {
						result.navigationFailed = !success;
						return success;
					})
					.catch((error) => {
						fail(error);
						result.navigationFailed = true;
						return false;
					});
			else result.navigationFailed = !positioned;
		} catch (error) {
			fail(error);
		}
		return result;
	};
	try {
		const source = task.context.doc.toString();
		let prepared: MatchResult | Promise<MatchResult>;
		if (synchronous) {
			const replacements = prepareReplacements(
				source,
				query,
				replacement,
				options.regexMode,
				options.caseSensitive,
				options.wholeWord,
				effects.ranges(),
			);
			const selected = all
				? undefined
				: replacements.one(index >= 0 && index < replacements.matches.length ? index : 0);
			prepared = {
				status: "completed",
				synchronous: true,
				matches: replacements.matches,
				changes: all ? replacements.all() : selected ? [selected] : [],
			};
		} else prepared = effects.replace(source, replacement);
		if (prepared instanceof Promise) {
			effects.pending();
			return prepared.then(apply).catch(fail);
		}
		return apply(prepared);
	} catch (error) {
		return fail(error);
	}
}
