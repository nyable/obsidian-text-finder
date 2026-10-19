/** IME ownership is local to one mounted Finder, not a global keyboard flag. */
export function createCompositionInput() {
	const composing = new WeakSet<EventTarget>();
	return {
		isComposing(this: void, event: KeyboardEvent) {
			return (
				event.isComposing ||
				// Legacy IME signal: some WebViews report false for isComposing
				// on the candidate-confirmation key. Keep the 229 fallback.
				event.keyCode === 229 ||
				(event.currentTarget !== null && composing.has(event.currentTarget))
			);
		},
		track(this: void, node: HTMLTextAreaElement) {
			const start = () => composing.add(node);
			const end = () => composing.delete(node);
			node.addEventListener("compositionstart", start);
			node.addEventListener("compositionend", end);
			node.addEventListener("blur", end);
			return {
				destroy() {
					end();
					node.removeEventListener("compositionstart", start);
					node.removeEventListener("compositionend", end);
					node.removeEventListener("blur", end);
				},
			};
		},
	};
}
