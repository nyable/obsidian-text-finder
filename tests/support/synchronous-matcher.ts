import type { MatchExecutor } from "../../src/core/search/match-protocol";
import { findTextOffsets } from "../../src/core/search/text-matching";

/** Explicit synchronous query transport. Replacement uses the same application
 * operation as a Worker, with its synchronous algorithm selected by capability. */
export function synchronousMatcher(): MatchExecutor {
	return {
		match: (source, query, options, ranges) => ({
			status: "completed",
			synchronous: true,
			matches: findTextOffsets(
				source,
				query,
				options.regexMode,
				options.caseSensitive,
				options.wholeWord,
				ranges,
			),
		}),
		cancel() {},
		destroy() {},
	};
}
