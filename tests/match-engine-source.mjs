import { loadSource } from "./source-loader.mjs";

// Actual controller, with no Worker script needed on synchronous host stubs.
export const matchEngineSource = loadSource("../src/match-engine.ts", {
	"text-finder:match-worker": { default: "" },
	"./util/text-helper": loadSource("../src/util/text-helper.ts"),
});
