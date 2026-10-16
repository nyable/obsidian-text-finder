import { expect, it } from "vitest";
import { finderCommands } from "../../src/features/finder/application/finder-commands";
import type { FinderSession } from "../../src/features/finder/application/finder-session";

it("exposes only commands, never state, raw editor access or internal event handlers", () => {
	const commands = finderCommands({ closeFinder() {}, state: {} } as FinderSession);
	expect(commands.closeFinder).toBeTypeOf("function");
	for (const name of [
		"state",
		"getEditorContext",
		"emitChange",
		"resetMatches",
		"scrollToMatch",
		"syncFinderVisibility",
	]) {
		expect(commands).not.toHaveProperty(name);
	}
});
