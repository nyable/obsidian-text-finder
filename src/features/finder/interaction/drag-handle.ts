import type { createFinderPosition } from "./finder-position";

type Placement = ReturnType<typeof createFinderPosition>;

/** Guard only touches starting on this handle; position still comes from Pointer Events. */
export function dragHandle(
	node: HTMLElement,
	enabled: boolean,
	mobile: boolean,
	placement: () => Placement | undefined,
) {
	let doc = node.ownerDocument,
		win = doc.defaultView;
	let touchId: number | undefined;
	const cleanupTouch = () => {
		touchId = undefined;
		doc.removeEventListener("touchmove", touchMove, true);
		doc.removeEventListener("touchend", touchEnd, true);
		doc.removeEventListener("touchcancel", touchEnd, true);
		win?.removeEventListener("blur", cleanupTouch);
		win?.removeEventListener("pagehide", cleanupTouch);
	};
	const ownsTouch = (event: TouchEvent) =>
		Array.from(event.changedTouches).some((touch) => touch.identifier === touchId);
	const touchMove = (event: TouchEvent) => {
		if (!ownsTouch(event)) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
	};
	const touchEnd = (event: TouchEvent) => {
		if (!ownsTouch(event)) return;
		event.stopPropagation();
		cleanupTouch();
	};
	const touchStart = (event: TouchEvent) => {
		if (node.ownerDocument !== doc) {
			cleanupTouch();
			doc = node.ownerDocument;
			win = doc.defaultView;
		}
		const touch = event.changedTouches[0];
		if (!mobile || !enabled || touchId !== undefined || !touch) return;
		touchId = touch.identifier;
		// Preserve the browser's short-tap click: no preventDefault on touchstart.
		event.stopPropagation();
		doc.addEventListener("touchmove", touchMove, { capture: true, passive: false });
		doc.addEventListener("touchend", touchEnd, true);
		doc.addEventListener("touchcancel", touchEnd, true);
		win?.addEventListener("blur", cleanupTouch);
		win?.addEventListener("pagehide", cleanupTouch);
	};
	const start = (event: PointerEvent) => {
		if (!enabled || event.button !== 0 || event.isPrimary === false) return;
		if (!mobile) {
			// Prevent native focus scrolling without transferring the query's
			// focus-visible state to the handle. Keyboard focus remains available.
			event.preventDefault();
		}
		placement()?.start(event, mobile);
	};
	const context = (event: MouseEvent) => {
		if (!enabled) return;
		event.preventDefault();
		if (mobile) {
			event.stopPropagation();
			placement()?.suppressClick(event);
		}
	};
	node.addEventListener("pointerdown", start);
	node.addEventListener("contextmenu", context);
	if (mobile) node.addEventListener("touchstart", touchStart, { passive: true });
	return {
		update(next: boolean) {
			enabled = next;
			if (!enabled || node.ownerDocument !== doc) cleanupTouch();
		},
		destroy() {
			cleanupTouch();
			node.removeEventListener("touchstart", touchStart);
			node.removeEventListener("pointerdown", start);
			node.removeEventListener("contextmenu", context);
		},
	};
}
