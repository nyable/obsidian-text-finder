import {
	computed,
	nextTick,
	onMounted,
	onBeforeUnmount,
	shallowReactive,
	watchEffect,
	watchPostEffect,
	toRefs,
} from "vue";
import type { FinderHost } from "../application/finder-host";
import type { EditorPort } from "../application/editor-port";
import { createFinderSession } from "../application/finder-session";
import { finderCommands } from "../application/finder-commands";
import { createPanelPresentation } from "../interaction/panel-presentation";
import { createInputShortcuts } from "../interaction/input-shortcuts";
import { defaultToolbar } from "../model/toolbar";
import { actionDirective } from "../../../shared/ui/dom-action";

type EdgeMenu = Parameters<typeof createPanelPresentation>[7];

/** Vue owns presentation resources; the application only receives effect ports. */
export function useFinderViewModel(
	props: { host: FinderHost; owner: HTMLElement; editor: EditorPort },
	mobile: boolean,
	menu: EdgeMenu,
) {
	const nodes = shallowReactive({
		finderEl: undefined as HTMLDivElement | undefined,
		searchEl: undefined as HTMLTextAreaElement | undefined,
		replaceEl: undefined as HTMLTextAreaElement | undefined,
		mobileInlineTarget: undefined as HTMLDivElement | undefined,
		replaceOffset: undefined as number | undefined,
		searchActionsWidth: undefined as number | undefined,
	});
	const presentation = createPanelPresentation(
		props.owner,
		mobile,
		nodes,
		() => session.state,
		() => session,
		nextTick,
		() => customToolbar.value,
		menu,
		(error) => props.host.reportError("search.EditorFailed", error),
	);
	let cleanup: (() => void) | void;
	const session = createFinderSession(props.host, {
		presentation: presentation.port,
		editor: props.editor,
		reactive: shallowReactive,
		tick: nextTick,
		onMount(callback) {
			onMounted(() => {
				cleanup = callback();
			});
		},
	});
	onBeforeUnmount(() => cleanup?.());
	const state = session.state;
	const isCollapsed = computed(() => state.readingMode || state.cache.collapse);
	const expanded = computed(() => state.cache.visible && !state.docked);
	const customToolbar = computed(
		() =>
			state.searchToolbar.some(
				(item, index) =>
					item.id !== defaultToolbar("search")[index]?.id ||
					item.placement !== defaultToolbar("search")[index]?.placement,
			) ||
			state.replaceToolbar.some(
				(item, index) =>
					item.id !== defaultToolbar("replace")[index]?.id ||
					item.placement !== defaultToolbar("replace")[index]?.placement,
			),
	);
	watchEffect(() => {
		if (state.readingMode || isCollapsed.value || customToolbar.value) {
			nodes.replaceOffset = undefined;
			nodes.searchActionsWidth = undefined;
		}
	});
	watchPostEffect(() => {
		if (nodes.finderEl) session.syncFinderVisibility();
	});
	const shortcuts = createInputShortcuts({
		isComposing: presentation.isComposingInput,
		inputHotkeysEnabled: () => props.host.preferences().enableInputHotkeys,
		historyEnabled: () => props.host.preferences().enableHistory,
		searchInput: () => {
			if (!nodes.searchEl) throw new Error("Query input not mounted");
			return nodes.searchEl;
		},
		navigateHistory: session.navigateHistory,
		setQuery: session.setFindText,
		next: session.toNextMatch,
		resetHistory: session.resetHistory,
		replace: () => {
			void Promise.resolve(session.replaceOnce()).catch((error) =>
				props.host.reportError("search.EditorFailed", error),
			);
		},
	});
	return {
		session,
		commands: finderCommands(session),
		nodes,
		fields: toRefs(state),
		dimensions: toRefs(nodes),
		presentation,
		isCollapsed,
		expanded,
		customToolbar,
		finderTabIndex: computed(() => (!expanded.value ? -1 : isCollapsed.value ? 0 : 1)),
		commonTabIndex: computed(() => (!expanded.value ? -1 : isCollapsed.value ? 0 : 2)),
		replacerTabIndex: computed(() => (!expanded.value || isCollapsed.value ? -1 : 1)),
		onSearchChanged: (event: Event) =>
			session.changeQuery((event.target as HTMLTextAreaElement).value),
		onFinderKeyDown: shortcuts.onQueryKeyDown,
		enterOnReplacer: shortcuts.onReplacementKeyDown,
		defaultEnterEvent(event: KeyboardEvent) {
			if (["Enter", "NumpadEnter", "Space"].includes(event.code)) {
				event.preventDefault();
				(event.target as HTMLElement).click();
			}
		},
		vGuardHiddenFocus: actionDirective(presentation.guardHiddenFocus),
		vPositionFinder: actionDirective(presentation.positionFinder),
		vAlignRows: actionDirective(presentation.alignRows),
		vDragToMove: actionDirective(presentation.dragToMove),
		vTrackComposition: actionDirective((node) =>
			presentation.trackComposition(node as HTMLTextAreaElement),
		),
	};
}
