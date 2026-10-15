import { loadSource } from "./source-loader.mjs";

export const readingTextSource = loadSource("../src/reading-text.ts");
export const readingSelectionSource = loadSource("../src/reading-selection.ts");
export const readingOverlaySource = loadSource("../src/reading-overlay.ts", {
	"./reading-text": readingTextSource, "./scope-outline": loadSource("../src/scope-outline.ts"),
});
export const readingDependencies = { "./reading-text": readingTextSource, "./reading-overlay": readingOverlaySource };
