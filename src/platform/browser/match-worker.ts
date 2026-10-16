import { findTextOffsets, prepareReplacements } from "../../core/search/text-matching";
import type { MatchRequest, MatchReply } from "../../core/search/match-protocol";

// This entry is bundled separately as a self-contained string, not loaded from
// a Vault URL. The worker has no Obsidian, DOM or CodeMirror dependencies.
const scope = globalThis as unknown as {
	postMessage(reply: MatchReply, transfer?: ArrayBuffer[]): void;
	onmessage: (event: MessageEvent<MatchRequest>) => void;
};
scope.onmessage = ({ data }) => {
	try {
		const prepared = data.operation
			? prepareReplacements(
					data.source,
					data.query,
					data.replacement ?? "",
					data.options.regexMode,
					data.options.caseSensitive,
					data.options.wholeWord,
					data.ranges,
				)
			: null;
		const matches =
			prepared?.matches ??
			findTextOffsets(
				data.source,
				data.query,
				data.options.regexMode,
				data.options.caseSensitive,
				data.options.wholeWord,
				data.ranges,
			);
		const index =
			typeof data.index === "number" &&
			Number.isInteger(data.index) &&
			data.index >= 0 &&
			data.index < matches.length
				? data.index
				: 0;
		const selected =
			prepared && data.operation === "replaceOne" ? prepared.one(index) : undefined;
		const changes = prepared
			? data.operation === "replaceAll"
				? prepared.all()
				: selected
					? [selected]
					: []
			: undefined;
		const offsets = new Float64Array(matches.length * 2);
		matches.forEach((match, index) => {
			offsets[index * 2] = match.from;
			offsets[index * 2 + 1] = match.to;
		});
		scope.postMessage({ type: "result", id: data.id, offsets: offsets.buffer, changes }, [
			offsets.buffer,
		]);
	} catch (error) {
		scope.postMessage({ type: "failed", id: data.id, error: String(error) });
	}
};
scope.postMessage({ type: "ready" });
