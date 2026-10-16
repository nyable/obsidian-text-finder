import SearchBoxView from "./FinderPanel.vue";
import { mountView } from "../../../shared/ui/mount-view";
import type { FinderHost } from "../application/finder-host";
import type { FinderCommands } from "../application/finder-commands";
import type { EditorPort } from "../application/editor-port";

/** Host-facing commands, separate from the view's private state/DOM handlers. */
export type Finder = FinderCommands & { destroy(): void };
/** Obsidian owns the session lifetime; Vue only owns this mounted view. */
export function mountFinder(
	target: HTMLElement,
	props: { host: FinderHost; owner: HTMLElement; cid: string; editor: EditorPort },
): Finder {
	const view = mountView(SearchBoxView, target, props);
	const commands = view.exposed;
	if (
		!commands ||
		typeof commands.closeFinder !== "function" ||
		typeof commands.setVisible !== "function"
	) {
		view.destroy();
		throw new Error("Finder view did not expose its commands");
	}
	return Object.assign(commands as FinderCommands, { destroy: () => view.destroy() });
}
