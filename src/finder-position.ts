export interface FinderPlacement {
	visible: boolean;
	docked: boolean;
	side: "left" | "right";
	/** Controls above the panel are part of its reachable footprint. */
	toolsHeight: number;
	autoDock?: boolean;
}
interface Point { x: number; y: number; }

/** Per-view, session-only placement. No file/search/editor operations live here. */
export function createFinderPosition(node: HTMLElement, owner: HTMLElement,
	onDock: (side: "left" | "right") => void = () => {}, canDock = () => true) {
	const doc = node.ownerDocument, win = doc.defaultView;
	let state: FinderPlacement = { visible: false, docked: false, side: "right", toolsHeight: 32 };
	let manual: Point | null = null;
	let translation: Point = { x: 0, y: 0 };
	let cleanupDrag: (() => void) | undefined;
	let destroyed = false;
	const suppressed = new WeakSet<EventTarget>();
	let clickTimer: number | undefined;
	let lastSuppressed: EventTarget | null = null;
	function suppressClick(origin: EventTarget) {
		if (lastSuppressed && lastSuppressed !== origin) suppressed.delete(lastSuppressed);
		suppressed.add(origin); lastSuppressed = origin;
		win?.clearTimeout(clickTimer);
		clickTimer = win?.setTimeout(() => { suppressed.delete(origin); lastSuppressed = null; clickTimer = undefined; }, 700);
	}
	let centered = false;
	let marker: Point | null = null;
	let markerEdge: "left" | "right" | null = null;
	let geometry: { bounds: ReturnType<typeof area>; base: Point; width: number; height: number; tools: number } | null = null;
	let refreshDrag: (() => void) | undefined;
	// Read resolved env() values without assuming iOS/Android chrome dimensions.
	const safe = doc.createElement("div");
	safe.setAttribute("aria-hidden", "true");
	safe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
	doc.body.append(safe);
	function area() {
		const box = owner.getBoundingClientRect(), viewport = win?.visualViewport;
		const inset = win?.getComputedStyle(safe);
		const left = Math.max(box.left, (viewport?.offsetLeft ?? 0) + (parseFloat(inset?.paddingLeft ?? "") || 0)) + 8;
		const top = Math.max(box.top, (viewport?.offsetTop ?? 0) + (parseFloat(inset?.paddingTop ?? "") || 0)) + 8;
		const right = Math.min(box.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? win?.innerWidth ?? box.right)
			- (parseFloat(inset?.paddingRight ?? "") || 0)) - 8;
		const bottom = Math.min(box.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? win?.innerHeight ?? box.bottom)
			- (parseFloat(inset?.paddingBottom ?? "") || 0)) - 8;
		return { left, top, right, bottom, owner: box };
	}
	const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
	function paint() {
		if (!geometry) return;
		const { bounds, base, width, height, tools } = geometry;
		const edge = markerEdge ?? (!marker ? state.side : null);
		const x = state.docked ? (edge ? (edge === "left" ? bounds.left : bounds.right - width) : bounds.owner.left + marker!.x)
			: centered ? bounds.left + (bounds.right - bounds.left - width) / 2 : manual ? bounds.owner.left + manual.x : base.x;
		const y = state.docked && marker ? bounds.owner.top + marker.y : manual ? bounds.owner.top + manual.y : base.y;
		const next = { x: clamp(x, bounds.left, bounds.right - width) - base.x,
			y: clamp(y, bounds.top + (state.docked ? 0 : tools), bounds.bottom - height) - base.y };
		translation = next;
		const value = `${next.x}px ${next.y}px`;
		if (node.style.translate !== value) {
			node.style.translate = value;
			if (win) node.dispatchEvent(new win.Event("nya-finder-position"));
		}
	}
	function measure() {
		if (destroyed || !state.visible || !node.isConnected || node.ownerDocument !== owner.ownerDocument) return;
		const bounds = area();
		if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) { geometry = null; return; }
		node.style.setProperty("--nya-available-width", `${bounds.right - bounds.left}px`);
		const box = node.getBoundingClientRect();
		// A background tab can have a reachable owner but no rendered finder yet.
		// Keep edge/manual intent and wait for the existing layout observers.
		if (box.width <= 0 || box.height <= 0) { geometry = null; return; }
		// translate is independent of the existing desktop/mobile transform rules.
		const base = { x: box.left - translation.x, y: box.top - translation.y };
		const toolsHeight = node.querySelector<HTMLElement>(".nya-float-act")?.offsetHeight || state.toolsHeight;
		geometry = { bounds, base, width: box.width, height: box.height, tools: toolsHeight };
		if (refreshDrag) refreshDrag(); else paint();
	}
	function moveBy(x: number, y: number) {
		if (!state.visible || destroyed) return;
		const box = node.getBoundingClientRect(), ownerBox = owner.getBoundingClientRect();
		if (state.docked) { marker = { x: box.left - ownerBox.left + x, y: box.top - ownerBox.top + y }; markerEdge = null; }
		else manual = { x: box.left - ownerBox.left + x, y: box.top - ownerBox.top + y };
		centered = false;
		measure();
	}
	function start(event: PointerEvent, mobileGesture = false) {
		if (!state.visible || destroyed || event.button !== 0 || event.isPrimary === false) return;
		cleanupDrag?.();
		const origin = event.currentTarget ?? event.target;
		if (origin) suppressed.delete(origin);
		const pressedAt = win?.performance.now() ?? 0;
		const original = manual && { ...manual };
		const originalMarker = marker && { ...marker }, originalEdge = markerEdge;
		const wasCentered = centered;
		measure(); if (!geometry) return;
		// Own a mobile drag from its beginning, before the host's bubbling swipe
		// recognizer can see it. Do not cancel down/up defaults: short taps click.
		if (mobileGesture) event.stopPropagation();
		const startBox = node.getBoundingClientRect(), ownerBox = owner.getBoundingClientRect();
		const fullWidth = !state.docked && startBox.width >= (geometry.bounds.right - geometry.bounds.left) * 0.85;
		let ready = false, moved = false, candidate: "left" | "right" | null = null;
		let latest = { x: event.clientX, y: event.clientY }, frame: number | undefined;
		const capture = origin && "setPointerCapture" in origin ? origin as HTMLElement : null;
		let captureRequested = false;
		const capturePointer = () => {
			if (!capture || captureRequested) return;
			try { capture.setPointerCapture(event.pointerId); captureRequested = true; }
			catch { /* Capture may fail; the Document listeners still own movement. */ }
		};
		const apply = () => {
			frame = undefined;
			if (!ready || !geometry) return;
			const x = latest.x - event.clientX, y = latest.y - event.clientY;
			const point = { x: startBox.left - ownerBox.left + (fullWidth ? 0 : x), y: startBox.top - ownerBox.top + y };
			centered = fullWidth;
			if (state.docked) { marker = point; markerEdge = null; } else manual = point;
			paint(); candidate = null;
			if (state.docked || (state.autoDock && canDock())) {
				const { bounds, base, width } = geometry;
				if (fullWidth) {
					if (Math.abs(x) >= 56 && Math.abs(x) > Math.abs(y) * 1.4) candidate = x < 0 ? "left" : "right";
				} else if (state.docked || Math.abs(x) >= 12) {
					if ((state.docked || x < 0) && base.x + translation.x - bounds.left <= 16) candidate = "left";
					else if ((state.docked || x > 0) && bounds.right - (base.x + translation.x + width) <= 16) candidate = "right";
				}
			}
			if (candidate) node.setAttribute("data-dock-preview", candidate); else node.removeAttribute("data-dock-preview");
		};
		refreshDrag = () => { if (frame !== undefined) win?.cancelAnimationFrame(frame); if (ready) apply(); else paint(); };
		const cleanup = () => {
			if (frame !== undefined) win?.cancelAnimationFrame(frame);
			frame = undefined; refreshDrag = undefined;
			node.classList.remove("nya-finder--dragging");
			node.removeAttribute("data-dock-preview");
			// Long presses can produce a release click even when the host never
			// emits contextmenu. This does not delay direct movement or short taps.
			if (origin && (ready || suppressed.has(origin)
				|| (mobileGesture && (win?.performance.now() ?? 0) - pressedAt >= 500))) suppressClick(origin);
			doc.removeEventListener("pointermove", move, mobileGesture); doc.removeEventListener("pointerup", end, mobileGesture);
			doc.removeEventListener("pointercancel", pointerCancel, mobileGesture); doc.removeEventListener("keydown", escape, true);
			capture?.removeEventListener("lostpointercapture", pointerCancel);
			try { if (capture?.hasPointerCapture(event.pointerId)) capture.releasePointerCapture(event.pointerId); } catch { /* Owner may have been detached. */ }
			win?.removeEventListener("blur", cancel); win?.removeEventListener("pagehide", cancel);
			cleanupDrag = undefined;
		};
		const cancel = () => { cleanup(); manual = original; marker = originalMarker; markerEdge = originalEdge; centered = wasCentered; measure(); };
		const move = (e: PointerEvent) => {
			if (e.pointerId !== event.pointerId) return;
			if (mobileGesture) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }
			const x = e.clientX - event.clientX, y = e.clientY - event.clientY;
			if (!ready) {
				if (Math.hypot(x, y) < 3) return;
				ready = moved = true; node.classList.add("nya-finder--dragging");
				if (origin) suppressed.add(origin);
				capturePointer();
			}
			e.preventDefault(); latest = { x: e.clientX, y: e.clientY };
			if (win?.requestAnimationFrame) { if (frame === undefined) frame = win.requestAnimationFrame(apply); } else apply();
		};
		const end = (e: PointerEvent) => {
			if (e.pointerId !== event.pointerId) return;
			if (mobileGesture) e.stopPropagation();
			// Flush the final pointer coordinate even if the next frame hasn't run.
			latest = { x: e.clientX, y: e.clientY }; refreshDrag?.();
			if (state.docked && ready) markerEdge = candidate;
			cleanup();
			if (state.docked) paint(); else if (candidate && moved && state.autoDock && canDock()) onDock(candidate);
		};
		const escape = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); cancel(); }
		};
		const pointerCancel = (e: PointerEvent) => {
			if (e.pointerId !== event.pointerId) return;
			if (mobileGesture) { e.stopPropagation(); if (origin) suppressed.add(origin); }
			cancel();
		};
		doc.addEventListener("pointermove", move, { passive: false, capture: mobileGesture });
		doc.addEventListener("pointerup", end, mobileGesture);
		doc.addEventListener("pointercancel", pointerCancel, mobileGesture);
		capture?.addEventListener("lostpointercapture", pointerCancel);
		doc.addEventListener("keydown", escape, true); win?.addEventListener("blur", cancel); win?.addEventListener("pagehide", cancel);
		cleanupDrag = cancel;
		if (mobileGesture) capturePointer();
	}
	const observer = win && "ResizeObserver" in win ? new win.ResizeObserver(measure) : undefined;
	let observedTools: HTMLElement | null = null;
	observer?.observe(owner); observer?.observe(node);
	win?.addEventListener("resize", measure); win?.addEventListener("scroll", measure, true);
	win?.visualViewport?.addEventListener("resize", measure); win?.visualViewport?.addEventListener("scroll", measure);
	return {
		start, moveBy,
		suppressClick(event: Event) {
			const origin = event.currentTarget ?? event.target;
			if (!destroyed && origin) suppressClick(origin);
		},
		consumeClick(event: MouseEvent) {
			if (event.detail === 0) return false;
			const origin = event.currentTarget ?? event.target;
			if (!origin || !suppressed.has(origin)) return false;
			suppressed.delete(origin); event.preventDefault(); event.stopPropagation(); return true;
		},
		update(next: FinderPlacement) {
			if (!next.visible || next.docked !== state.docked || next.side !== state.side) cleanupDrag?.();
			if (next.docked && (!state.docked || next.side !== state.side)) { marker = null; markerEdge = next.side; }
			if (!next.docked && state.docked && geometry) {
				const { bounds, base, width } = geometry;
				manual = { x: base.x + translation.x - bounds.owner.left + width / 2,
					y: base.y + translation.y - bounds.owner.top };
				// Align the expanded panel around the marker; measure() supplies its new width.
				const expandedWidth = node.getBoundingClientRect().width;
				manual.x -= expandedWidth / 2;
				centered = expandedWidth >= (bounds.right - bounds.left) * 0.85;
			}
			state = next;
			const tools = node.querySelector<HTMLElement>(".nya-float-act");
			if (observedTools !== tools) { if (observedTools) observer?.unobserve(observedTools); if (tools) observer?.observe(tools); observedTools = tools; }
			measure();
		},
		reset() { cleanupDrag?.(); manual = null; marker = null; markerEdge = state.docked ? state.side : null; centered = false; measure(); },
		destroy() {
			cleanupDrag?.(); destroyed = true; observer?.disconnect(); safe.remove();
			win?.clearTimeout(clickTimer);
			win?.removeEventListener("resize", measure); win?.removeEventListener("scroll", measure, true);
			win?.visualViewport?.removeEventListener("resize", measure); win?.visualViewport?.removeEventListener("scroll", measure);
			node.style.removeProperty("translate"); node.style.removeProperty("--nya-available-width");
		},
	};
}
