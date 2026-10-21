/** Relocate existing inline controls, never recreate them or change settings.
 * More stays in its original toolbar; only a suffix of inline actions moves. */
export function mobileToolbar(node: HTMLElement, target?: HTMLElement) {
	let destination = target;
	let win = node.ownerDocument.defaultView;
	let disposed = false,
		queued = false;
	const width = (el: HTMLElement) => {
		const style = win?.getComputedStyle(el);
		return (
			el.getBoundingClientRect().width +
			(parseFloat(style?.marginLeft ?? "") || 0) +
			(parseFloat(style?.marginRight ?? "") || 0)
		);
	};
	function measure() {
		if (disposed) return;
		if (win !== node.ownerDocument.defaultView) connect();
		if (!destination || !node.isConnected) return;
		const row = node.closest<HTMLElement>(".finder"),
			input = row?.querySelector<HTMLElement>("textarea");
		if (!row || !input || row.getBoundingClientRect().width <= 0) return;
		const controls = [
			...Array.from(node.querySelectorAll<HTMLElement>(":scope > [data-toolbar-action]")),
			...Array.from(destination.querySelectorAll<HTMLElement>("[data-toolbar-action]")),
		].sort((a, b) => Number(a.dataset.toolbarOrder) - Number(b.dataset.toolbarOrder));
		const more = node.querySelector<HTMLElement>(".nya-toolbar-overflow");
		let used = more ? width(more) : 0;
		// Protect a usable input, including its border/padding, not its current
		// already squeezed width. The row excludes the original collapse arrow.
		const budget = Math.max(0, row.getBoundingClientRect().width - 108);
		let overflow = false;
		const focused = node.ownerDocument.activeElement as HTMLElement | null;
		for (const control of controls) {
			const size = width(control);
			overflow ||= used + size > budget;
			const parent = overflow ? destination : node;
			if (control.parentElement !== parent) {
				if (overflow) {
					const next = Array.from(
						parent.querySelectorAll<HTMLElement>("[data-toolbar-action]"),
					).find(
						(entry) =>
							Number(entry.dataset.toolbarOrder) >
							Number(control.dataset.toolbarOrder),
					);
					parent.insertBefore(control, next ?? null);
				} else parent.insertBefore(control, more);
				if (focused === control || (focused && control.contains(focused)))
					focused.focus({ preventScroll: true });
			}
			if (!overflow) used += size;
		}
		// Attribute-only keyed reorders can keep the same destination parent.
		for (const parent of [node, destination]) {
			const ordered = controls.filter((control) => control.parentElement === parent);
			let cursor: Node | null = parent === node ? more : null;
			for (const control of ordered.reverse()) {
				if (control.nextSibling !== cursor) parent.insertBefore(control, cursor);
				cursor = control;
			}
		}
		if (
			focused &&
			focused.isConnected &&
			node.ownerDocument.activeElement !== focused &&
			controls.some((control) => control === focused || control.contains(focused))
		)
			focused.focus({ preventScroll: true });
	}
	const schedule = () => {
		if (queued || disposed) return;
		queued = true;
		void Promise.resolve().then(() => {
			queued = false;
			measure();
		});
	};
	let observer: ResizeObserver | undefined;
	let mutation: MutationObserver | undefined;
	const disconnect = () => {
		observer?.disconnect();
		mutation?.disconnect();
		win?.removeEventListener("resize", schedule);
		win?.visualViewport?.removeEventListener("resize", schedule);
	};
	const connect = () => {
		disconnect();
		const next = node.ownerDocument.defaultView;
		if (win !== next || !mutation) {
			win = next;
			observer =
				win && "ResizeObserver" in win ? new win.ResizeObserver(schedule) : undefined;
			mutation = win ? new win.MutationObserver(schedule) : undefined;
		}
		if (destination) {
			win?.addEventListener("resize", schedule);
			win?.visualViewport?.addEventListener("resize", schedule);
			observer?.observe(node.closest(".finder") ?? node);
			observer?.observe(node);
			observer?.observe(destination);
			mutation?.observe(node, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["data-toolbar-order"],
			});
			mutation?.observe(destination, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["data-toolbar-order"],
			});
		}
	};
	connect();
	schedule();
	return {
		update(next?: HTMLElement) {
			if (disposed) return;
			destination = next;
			connect();
			schedule();
		},
		destroy() {
			disposed = true;
			disconnect();
			// Return owned nodes before the parent/keyed component is destroyed.
			const more = node.querySelector(".nya-toolbar-overflow");
			destination
				?.querySelectorAll<HTMLElement>("[data-toolbar-action]")
				.forEach((control) => node.insertBefore(control, more));
		},
	};
}
