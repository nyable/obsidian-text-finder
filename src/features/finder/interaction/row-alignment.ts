interface RowAlignment {
	measureEnabled(): boolean;
	setDimensions(offset: number, actionsWidth: number): void;
}

/** Measure controls, never the row/input whose width is affected by this spacer. */
export function alignFinderRows(node: HTMLElement, mobile: boolean, layout: RowAlignment) {
	let win = node.ownerDocument.defaultView;
	let observer: ResizeObserver | undefined;
	let disposed = false;
	const count = node.querySelector<HTMLElement>(".nya-tip");
	const searchActions = node.querySelector<HTMLElement>(".finder-act");
	const replaceActions = node.querySelector<HTMLElement>(".replacer-act");
	const replacementControls = replaceActions?.querySelector<HTMLElement>(".nya-toolbar");
	const outerWidth = (element: HTMLElement) => {
		const style = win?.getComputedStyle(element);
		return (
			element.getBoundingClientRect().width +
			(parseFloat(style?.marginLeft ?? "") || 0) +
			(parseFloat(style?.marginRight ?? "") || 0)
		);
	};
	const measure = () => {
		if (disposed) return;
		if (win !== node.ownerDocument.defaultView) connect();
		if (
			mobile ||
			!layout.measureEnabled() ||
			!win ||
			!count ||
			!searchActions ||
			!replaceActions ||
			!replacementControls
		)
			return;
		const width = searchActions.getBoundingClientRect().width;
		if (
			!width ||
			!count.getBoundingClientRect().width ||
			!replacementControls.getBoundingClientRect().width
		)
			return;
		const replaceStyle = win.getComputedStyle(replaceActions);
		const margins =
			(parseFloat(replaceStyle.marginLeft) || 0) +
			(parseFloat(replaceStyle.marginRight) || 0);
		const offset = Math.max(
			0,
			Math.round(
				(outerWidth(count) +
					outerWidth(searchActions) -
					outerWidth(replacementControls) -
					margins) *
					100,
			) / 100,
		);
		layout.setDimensions(offset, width);
	};
	const disconnect = () => {
		observer?.disconnect();
		win?.removeEventListener("resize", measure);
	};
	const connect = () => {
		disconnect();
		win = node.ownerDocument.defaultView;
		observer =
			!mobile && win && "ResizeObserver" in win ? new win.ResizeObserver(measure) : undefined;
		for (const element of [count, searchActions, replacementControls])
			if (element) observer?.observe(element, { box: "border-box" });
		win?.addEventListener("resize", measure);
	};
	connect();
	measure();
	return {
		update: measure,
		destroy() {
			disposed = true;
			disconnect();
		},
	};
}
