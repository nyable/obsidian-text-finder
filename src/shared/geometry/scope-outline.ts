/** Geometry only: draw the boundary of a union, never the enclosing rectangle. */
export interface ScopeRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}
const round = (value: number) => Math.round(value * 100) / 100;

export function scopeOutline(rectangles: readonly ScopeRect[]): string {
	const rects = rectangles
		.filter(
			(r) =>
				[r.left, r.top, r.right, r.bottom].every(Number.isFinite) &&
				r.right > r.left &&
				r.bottom > r.top,
		)
		.map((r) => ({
			left: round(r.left),
			right: round(r.right),
			top: round(r.top),
			bottom: round(r.bottom),
		}));
	const edges = new Map<string, { at: number; from: number; to: number; sign: number }[]>();
	const add = (axis: string, at: number, from: number, to: number, sign: number) => {
		const key = `${axis}:${at}`,
			list = edges.get(key) ?? [];
		list.push({ at, from, to, sign });
		edges.set(key, list);
	};
	// Split by horizontal bands. Within each band merge overlapping text
	// fragments, so syntax/match spans never create internal vertical seams.
	const events = new Map<number, { rectangle: ScopeRect; add: boolean }[]>();
	for (const rectangle of rects) {
		for (const [y, add] of [
			[rectangle.top, true],
			[rectangle.bottom, false],
		] as const) {
			const list = events.get(y) ?? [];
			list.push({ rectangle, add });
			events.set(y, list);
		}
	}
	const ys = [...events.keys()].sort((a, b) => a - b),
		active = new Set<ScopeRect>();
	for (let i = 1; i < ys.length; i++) {
		const top = ys[i - 1],
			bottom = ys[i];
		if (top === undefined || bottom === undefined) continue;
		for (const event of events.get(top)!) {
			if (event.add) active.add(event.rectangle);
			else active.delete(event.rectangle);
		}
		const intervals = [...active].sort((a, b) => a.left - b.left);
		const merged: { left: number; right: number }[] = [];
		for (const r of intervals) {
			const last = merged[merged.length - 1];
			if (last && r.left <= last.right) last.right = Math.max(last.right, r.right);
			else merged.push({ left: r.left, right: r.right });
		}
		for (const { left, right } of merged) {
			add("H", top, left, right, 1);
			add("H", bottom, left, right, -1);
			add("V", left, top, bottom, 1);
			add("V", right, top, bottom, -1);
		}
	}
	const result: string[] = [];
	for (const [key, list] of edges) {
		const first = list[0];
		if (!first) continue;
		const points = new Map<number, number>();
		for (const edge of list) {
			points.set(edge.from, (points.get(edge.from) ?? 0) + edge.sign);
			points.set(edge.to, (points.get(edge.to) ?? 0) - edge.sign);
		}
		let count = 0,
			start: number | undefined;
		for (const [point, delta] of [...points].sort(([a], [b]) => a - b)) {
			const next = count + delta;
			if (!count && next) start = point;
			if (count && !next && start !== undefined) {
				const at = first.at;
				result.push(
					key.startsWith("H") ? `M${start} ${at}H${point}` : `M${at} ${start}V${point}`,
				);
			}
			count = next;
		}
	}
	return result.join("");
}

export function createScopeSvg(doc: Document, path: string): SVGSVGElement {
	const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.classList.add("nya-scope-outline");
	svg.setAttribute("aria-hidden", "true");
	const shape = doc.createElementNS(svg.namespaceURI, "path");
	shape.setAttribute("d", path);
	svg.append(shape);
	return svg;
}

/** Shared by editor and preview; split marks retain the same scope identity. */
export function measureScopeRects(root: HTMLElement, origin: { left: number; top: number }) {
	const groups = new Map<string, ScopeRect[]>();
	root.querySelectorAll<HTMLElement>("[data-nya-scope]").forEach((span) => {
		const id = span.dataset.nyaScope!,
			rectangles = groups.get(id) ?? [];
		for (const box of Array.from(span.getClientRects()))
			rectangles.push({
				left: box.left - origin.left,
				top: box.top - origin.top,
				right: box.right - origin.left,
				bottom: box.bottom - origin.top,
			});
		groups.set(id, rectangles);
	});
	return groups;
}

export function measureScopeOutlines(
	root: HTMLElement,
	origin: { left: number; top: number },
	strokeWidth = 0,
): string[] {
	return scopeOutlines(measureScopeRects(root, origin), strokeWidth);
}

export function scopeOutlines(
	groups: ReadonlyMap<string, readonly ScopeRect[]>,
	strokeWidth: number,
): string[] {
	return paddedScopeOutlines([...normalizeScopeRects(groups).values()], strokeWidth);
}

export function normalizeScopeRects(
	groups: ReadonlyMap<string, readonly ScopeRect[]>,
): Map<string, ScopeRect[]> {
	return new Map(
		[...groups].map(([id, input]) => {
			const rects = input.map((rect) => ({ ...rect }));
			// Glyph boxes on consecutive visual lines often have a small leading
			// gap. Meet halfway only where their horizontal spans overlap. Do not
			// connect blank blocks, bidi gaps or separate scope identities.
			const rows: { top: number; bottom: number; rects: ScopeRect[] }[] = [];
			for (const rect of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
				const row = rows[rows.length - 1];
				if (row && rect.top < row.bottom && rect.bottom > row.top) {
					row.top = Math.min(row.top, rect.top);
					row.bottom = Math.max(row.bottom, rect.bottom);
					row.rects.push(rect);
				} else rows.push({ top: rect.top, bottom: rect.bottom, rects: [rect] });
			}
			for (const row of rows)
				for (const rect of row.rects) {
					rect.top = row.top;
					rect.bottom = row.bottom;
				}
			for (let i = 1; i < rows.length; i++) {
				const a = rows[i - 1],
					b = rows[i];
				if (!a || !b) continue;
				const gap = b.top - a.bottom;
				if (
					gap > 0 &&
					gap <= Math.min(a.bottom - a.top, b.bottom - b.top) * 0.6 &&
					a.rects.some((r) => b.rects.some((s) => r.left < s.right && r.right > s.left))
				) {
					const middle = (a.bottom + b.top) / 2;
					for (const rect of a.rects) rect.bottom = middle;
					for (const rect of b.rects) rect.top = middle;
				}
			}
			// Coalesce adjacent fragments before padding/gap checks. Highlighting
			// must not turn one visible line into quadratic work per match span.
			return [
				id,
				rows.flatMap((row) => {
					const merged: ScopeRect[] = [];
					for (const rect of row.rects.sort((a, b) => a.left - b.left)) {
						if (
							![rect.left, rect.top, rect.right, rect.bottom].every(
								Number.isFinite,
							) ||
							rect.right <= rect.left ||
							rect.bottom <= rect.top
						)
							continue;
						const last = merged[merged.length - 1];
						if (last && round(rect.left) <= round(last.right))
							last.right = Math.max(last.right, rect.right);
						else merged.push({ ...rect });
					}
					return merged;
				}),
			];
		}),
	);
}

/** Visual clearance only. Never pad DOM marks, source ranges or match offsets. */
export function paddedScopeOutlines(
	groups: readonly (readonly ScopeRect[])[],
	strokeWidth: number,
): string[] {
	const halfStroke = strokeWidth > 0 && Number.isFinite(strokeWidth) ? strokeWidth / 2 : 0;
	const padding = groups.map(() => ({
		horizontal: halfStroke,
		vertical: halfStroke ? 2 + halfStroke : 0,
	}));
	// Only nearby rectangles can reduce the initial clearance. Sweep visual rows
	// instead of comparing every line in a long scope with every other line.
	if (halfStroke) {
		const reach = strokeWidth + 1 + 2 * (2 + halfStroke);
		const sorted = groups
			.flatMap((rects, group) => rects.map((rect) => ({ rect, group })))
			.sort((a, b) => a.rect.top - b.rect.top);
		let active: typeof sorted = [];
		for (const entry of sorted) {
			active = active.filter(({ rect }) => entry.rect.top - rect.bottom < reach);
			for (const other of active) {
				const r = entry.rect,
					s = other.rect;
				if (entry.group === other.group && r === s) continue;
				const dx = Math.max(s.left - r.right, r.left - s.right, 0);
				const dy = Math.max(s.top - r.bottom, r.top - s.bottom, 0);
				if (Math.max(dx, dy) >= reach) continue;
				for (const group of [entry.group, other.group]) {
					const value = padding[group]!;
					if (dx > 0 || dy > 0) {
						const limit = Math.max(0, (Math.max(dx, dy) - strokeWidth - 1) / 2);
						if (dx >= dy) value.horizontal = Math.min(value.horizontal, limit);
						else value.vertical = Math.min(value.vertical, limit);
					} else if (entry.group !== other.group) value.horizontal = value.vertical = 0;
				}
			}
			active.push(entry);
		}
	}
	return groups
		.map((rects, index) => {
			// Keep the inner vertical edges at the measured character boundaries.
			// Only top/bottom retain the extra 2px of breathing room.
			const { horizontal, vertical } = padding[index]!;
			return scopeOutline(
				rects.map((r) => ({
					left: r.left - horizontal,
					top: r.top - vertical,
					right: r.right + horizontal,
					bottom: r.bottom + vertical,
				})),
			);
		})
		.filter(Boolean);
}

/** Static settings sample only; never observes or writes the editor. */
export function previewScopeOutline(root: HTMLElement) {
	let disposed = false,
		queued = false;
	const win = root.ownerDocument.defaultView;
	const draw = () => {
		queued = false;
		if (disposed) return;
		const box = root.getBoundingClientRect();
		const width =
			parseFloat(
				win?.getComputedStyle(root).getPropertyValue("--nya-scope-border-width") ?? "",
			) || 0;
		const paths = measureScopeOutlines(
			root,
			{ left: box.left + root.clientLeft, top: box.top + root.clientTop },
			width,
		);
		root.querySelectorAll(":scope > .nya-scope-outline").forEach((node) => node.remove());
		for (const path of paths) root.append(createScopeSvg(root.ownerDocument, path));
	};
	const schedule = () => {
		if (!queued && !disposed) {
			queued = true;
			void Promise.resolve().then(draw);
		}
	};
	const observer = win && "ResizeObserver" in win ? new win.ResizeObserver(schedule) : undefined;
	observer?.observe(root);
	win?.addEventListener("resize", schedule);
	root.ownerDocument.addEventListener("nya-scope-style-change", schedule);
	schedule();
	return {
		destroy() {
			disposed = true;
			observer?.disconnect();
			win?.removeEventListener("resize", schedule);
			root.ownerDocument.removeEventListener("nya-scope-style-change", schedule);
			root.querySelectorAll(":scope > .nya-scope-outline").forEach((node) => node.remove());
		},
	};
}
