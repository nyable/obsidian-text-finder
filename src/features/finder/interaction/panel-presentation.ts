import type { PanelPresentation, PresentationPort } from "../application/presentation-port";
import { createFinderPosition, type FinderPlacement } from "./finder-position";
import { dragHandle } from "./drag-handle";
import { alignFinderRows } from "./row-alignment";
import { createCompositionInput } from "./composition-input";

interface PanelState {
	cache: { visible: boolean; collapse: boolean };
	docked: boolean;
	dockSide: "left" | "right";
	autoDock: boolean;
	readingMode: boolean;
	replacementTask: unknown;
	panelIntent: number;
	disposed: boolean;
}
interface PanelCommands {
	dockFinder(side?: "left" | "right"): boolean;
	expandFinder(): void;
	resetFinderPosition(): void;
	closeFinder(): void;
}
export interface PanelNodes {
	finderEl: HTMLDivElement | undefined;
	searchEl: HTMLTextAreaElement | undefined;
	replaceEl: HTMLTextAreaElement | undefined;
	mobileInlineTarget: HTMLDivElement | undefined;
	replaceOffset: number | undefined;
	searchActionsWidth: number | undefined;
}

export function createPanelPresentation(
	owner: HTMLElement,
	mobile: boolean,
	nodes: PanelNodes,
	state: () => PanelState,
	commands: () => PanelCommands,
	tick: () => Promise<void>,
	customToolbar: () => boolean,
	menu: (
		event: MouseEvent,
		valid: () => boolean,
		close: () => void,
		reset: () => void,
	) => { hide(): void },
	reportError: (error: unknown) => void,
) {
	let placement: ReturnType<typeof createFinderPosition> | undefined;
	let updatePlacement: ((value: FinderPlacement) => void) | undefined;
	let edgeMenu: { hide(): void } | undefined;
	let menuIntent = 0;
	const composition = createCompositionInput();
	const placementState = (): FinderPlacement => ({
		visible: state().cache.visible,
		docked: state().docked,
		side: state().dockSide,
		autoDock: state().autoDock,
		toolsHeight: mobile
			? nodes.finderEl?.querySelector<HTMLElement>(".nya-float-act")?.offsetHeight || 40
			: 0,
	});
	const blur = () => {
		const root = nodes.finderEl,
			focused = root?.ownerDocument.activeElement;
		if (root && focused && root.contains(focused)) (focused as HTMLElement).blur();
	};
	const refresh = () => updatePlacement?.(placementState());
	const port: PresentationPort = {
		sync(panel: PanelPresentation) {
			const root = nodes.finderEl;
			if (!root) return;
			root.style.visibility = panel.visible ? "visible" : "hidden";
			if (!panel.visible) blur();
			root.setAttribute("aria-hidden", String(!panel.visible));
			root.classList.toggle("nya-finder--docked", panel.docked);
			root.querySelectorAll<HTMLElement>(
				".main-part, .nya-toggle, .nya-dragger, .nya-float-act",
			).forEach((child) => {
				child.toggleAttribute("inert", !panel.visible || panel.docked);
				child.setAttribute("aria-hidden", String(!panel.visible || panel.docked));
				if (panel.docked) child.style.setProperty("display", "none", "important");
				else child.style.removeProperty("display");
			});
			refresh();
		},
		refresh,
		blur,
		focusMarker: () =>
			nodes.finderEl
				?.querySelector<HTMLElement>(".nya-dock-expand")
				?.focus({ preventScroll: true }),
		focusHandle: () =>
			nodes.finderEl
				?.querySelector<HTMLElement>(mobile ? ".nya-move-handle" : ".nya-dragger")
				?.focus({ preventScroll: true }),
		focusQuery: () => nodes.searchEl?.focus({ preventScroll: true }),
		identity: () =>
			nodes.finderEl?.ownerDocument === owner.ownerDocument ? owner.ownerDocument : null,
		hideMenu() {
			menuIntent++;
			edgeMenu?.hide();
			edgeMenu = undefined;
		},
		resetPosition: () => placement?.reset(),
		focusInput(target, afterLayout, current) {
			const doc = nodes.finderEl?.ownerDocument;
			const valid = () =>
				current() && nodes.finderEl?.ownerDocument === doc && owner.ownerDocument === doc;
			const focus = () => {
				if (!valid()) return;
				if (afterLayout) refresh();
				if (!valid()) return;
				const input = target === "replace" ? nodes.replaceEl : nodes.searchEl;
				if (!input?.isConnected || input.ownerDocument !== doc) return;
				input.focus({ preventScroll: true });
				const select = () => {
					if (valid() && doc?.activeElement === input) input.select();
				};
				select();
				if (!afterLayout) void tick().then(select).catch(reportError);
			};
			if (afterLayout) void tick().then(focus).catch(reportError);
			else focus();
		},
	};
	return {
		port,
		guardHiddenFocus(node: HTMLElement) {
			const guard = (event: FocusEvent) => {
				if (
					!state().cache.visible ||
					(state().docked && !(event.target as HTMLElement).closest(".nya-dock-tab"))
				)
					(event.target as HTMLElement).blur();
			};
			node.addEventListener("focusin", guard);
			return {
				destroy() {
					node.removeEventListener("focusin", guard);
				},
			};
		},
		positionFinder(node: HTMLElement, initial: FinderPlacement) {
			let doc = node.ownerDocument;
			const create = () =>
				createFinderPosition(
					node,
					owner,
					(side) => commands().dockFinder(side),
					() => !state().replacementTask,
				);
			placement = create();
			const update = (next: FinderPlacement) => {
				if (node.ownerDocument !== doc) {
					placement?.destroy();
					doc = node.ownerDocument;
					placement = create();
				}
				placement?.update(next);
			};
			updatePlacement = update;
			update(initial);
			return {
				update,
				destroy() {
					placement?.destroy();
					placement = undefined;
					updatePlacement = undefined;
					port.hideMenu();
				},
			};
		},
		dragToMove: (node: HTMLElement, enabled: boolean) =>
			dragHandle(node, enabled, mobile, () => placement),
		alignRows: (node: HTMLElement, _layout: unknown) =>
			alignFinderRows(node, mobile, {
				measureEnabled: () =>
					!state().readingMode && !state().cache.collapse && !customToolbar(),
				setDimensions(offset, width) {
					nodes.replaceOffset = offset;
					nodes.searchActionsWidth = width;
				},
			}),
		trackComposition: composition.track,
		isComposingInput: composition.isComposing,
		expandFromClick(event: MouseEvent) {
			if (placement?.consumeClick(event)) return;
			commands().expandFinder();
			const intent = state().panelIntent;
			void tick()
				.then(() => {
					if (
						!state().disposed &&
						state().panelIntent === intent &&
						state().cache.visible &&
						!state().docked
					)
						port.focusHandle();
				})
				.catch(reportError);
		},
		dockMenu(event: MouseEvent) {
			event.preventDefault();
			if (mobile) {
				event.stopPropagation();
				placement?.suppressClick(event);
				return;
			}
			if (
				!state().cache.visible ||
				nodes.finderEl?.classList.contains("nya-finder--dragging")
			)
				return;
			port.hideMenu();
			const intent = menuIntent;
			const panelIntent = state().panelIntent;
			edgeMenu = menu(
				event,
				() =>
					!state().disposed &&
					state().panelIntent === panelIntent &&
					menuIntent === intent &&
					state().cache.visible &&
					state().docked,
				() => commands().closeFinder(),
				() => commands().resetFinderPosition(),
			);
		},
		moveFinderKey(event: KeyboardEvent) {
			if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
			const step = event.shiftKey ? 32 : 8;
			const directions: Record<string, readonly [number, number]> = {
				ArrowLeft: [-step, 0],
				ArrowRight: [step, 0],
				ArrowUp: [0, -step],
				ArrowDown: [0, step],
			};
			const delta = directions[event.key];
			if (delta) {
				event.preventDefault();
				event.stopPropagation();
				placement?.moveBy(...delta);
			} else if (event.key === "Home") {
				event.preventDefault();
				commands().resetFinderPosition();
			}
		},
	};
}
