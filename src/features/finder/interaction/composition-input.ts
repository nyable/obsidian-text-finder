/** IME ownership is local to a tracked input or owner, not a global keyboard flag. */
export function createCompositionInput() {
	const composing = new WeakSet<EventTarget>();
	return {
		isComposing(this: void, event: KeyboardEvent) {
			return (
				event.isComposing ||
				// Legacy IME signal: some WebViews report false for isComposing
				// on the candidate-confirmation key. Keep the 229 fallback.
				event.keyCode === 229 ||
				(event.target !== null && composing.has(event.target)) ||
				(event.currentTarget !== null && composing.has(event.currentTarget))
			);
		},
		track(this: void, node: HTMLElement) {
			let target: EventTarget = node;
			const start = (event: Event) => {
				composing.delete(target);
				target = event.target ?? node;
				composing.add(target);
			};
			const end = () => composing.delete(target);
			const blur = (event: Event) => {
				if (event.target === target) end();
			};
			node.addEventListener("compositionstart", start);
			node.addEventListener("compositionend", end);
			node.addEventListener("blur", blur, true);
			return {
				destroy() {
					end();
					node.removeEventListener("compositionstart", start);
					node.removeEventListener("compositionend", end);
					node.removeEventListener("blur", blur, true);
				},
			};
		},
	};
}
