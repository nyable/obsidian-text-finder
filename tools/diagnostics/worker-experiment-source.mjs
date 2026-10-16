// Experimental transport only. Production matching is compiled verbatim, not
// reimplemented. This module is never imported by the plugin build.
import { embeddedBundle } from "../vite-build.mjs";

const helper = await embeddedBundle({
	entry: "src/core/search/text-matching.ts",
	name: "ExperimentHelper",
});

function runtime(helper, send, listen, now) {
	listen((request) => {
		if (request.delayMs) {
			// Probe-only delay to exercise owner/lifecycle races with benign input.
			setTimeout(() => execute(request), Math.min(10000, Math.max(0, request.delayMs)));
		} else execute(request);
	});
	function execute(request) {
		const {
			id,
			snapshot,
			operation,
			source,
			query,
			replacement = "",
			regexMode,
			caseSensitive,
			index = 0,
		} = request;
		send({ type: "started", id });
		const start = now();
		try {
			let result;
			if (operation === "echo") result = { source };
			else if (operation === "match")
				result = {
					matches: helper.findTextOffsets(source, query, regexMode, caseSensitive),
				};
			else if (operation === "replaceOne" || operation === "replaceAll") {
				const prepared = helper.prepareReplacements(
					source,
					query,
					replacement,
					regexMode,
					caseSensitive,
				);
				const one = operation === "replaceOne" ? prepared.one(index) : undefined;
				result = {
					matches: prepared.matches,
					changes: operation === "replaceAll" ? prepared.all() : one ? [one] : [],
				};
			} else throw new Error(`Unknown experiment operation: ${operation}`);
			if (operation === "match" && request.transport === "packed") {
				// Float64 avoids imposing a new signed/unsigned 32-bit offset limit.
				const offsets = new Float64Array(result.matches.length * 2);
				result.matches.forEach((match, index) => {
					offsets[index * 2] = match.from;
					offsets[index * 2 + 1] = match.to;
				});
				send(
					{
						type: "result",
						id,
						snapshot,
						result: { packedOffsets: offsets.buffer },
						computeMs: now() - start,
					},
					[offsets.buffer],
				);
			} else send({ type: "result", id, snapshot, result, computeMs: now() - start });
		} catch (error) {
			send({ type: "failed", id, snapshot, error: String(error) });
		}
	}
	send({ type: "ready" });
}

export function workerSource(platform = "node") {
	const prefix = `${helper.code}\nconst helper = ExperimentHelper;`;
	if (platform === "node")
		return `${prefix}
		const { parentPort } = require('node:worker_threads');
		(${runtime.toString()})(helper, (message, transfer) => parentPort.postMessage(message, transfer),
			callback => parentPort.on('message', callback), () => performance.now());`;
	if (platform === "browser")
		return `${prefix}
		(${runtime.toString()})(helper, (message, transfer) => self.postMessage(message, transfer ?? []),
			callback => self.addEventListener('message', event => callback(event.data)), () => performance.now());`;
	throw new Error(`Unknown worker platform: ${platform}`);
}
