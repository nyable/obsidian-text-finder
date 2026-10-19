interface InputCommands {
	isComposing(event: KeyboardEvent): boolean;
	inputHotkeysEnabled(): boolean;
	historyEnabled(): boolean;
	searchInput(): HTMLTextAreaElement;
	navigateHistory(direction: -1 | 1): string | undefined;
	setQuery(text: string): void;
	next(): void;
	resetHistory(): void;
	replace(): unknown;
}

const unmodifiedEnter = (event: KeyboardEvent) =>
	["Enter", "NumpadEnter"].includes(event.code) &&
	!event.altKey &&
	!event.ctrlKey &&
	!event.shiftKey &&
	!event.metaKey;

export function createInputShortcuts(commands: InputCommands) {
	return {
		onQueryKeyDown(this: void, event: KeyboardEvent) {
			if (commands.isComposing(event)) return;
			if (commands.historyEnabled() && ["ArrowUp", "ArrowDown"].includes(event.code)) {
				const input = commands.searchInput();
				const up = event.code === "ArrowUp";
				const boundary = up ? input.value.indexOf("\n") : input.value.lastIndexOf("\n");
				if (
					boundary === -1 ||
					(up ? input.selectionStart <= boundary : input.selectionStart > boundary)
				) {
					const text = commands.navigateHistory(up ? 1 : -1);
					if (text !== undefined) {
						event.preventDefault();
						commands.setQuery(text);
					}
				}
				return;
			}
			if (commands.inputHotkeysEnabled() && unmodifiedEnter(event)) {
				event.preventDefault();
				commands.resetHistory();
				commands.next();
			}
		},
		onReplacementKeyDown(this: void, event: KeyboardEvent) {
			if (
				!commands.isComposing(event) &&
				commands.inputHotkeysEnabled() &&
				unmodifiedEnter(event)
			) {
				event.preventDefault();
				commands.replace();
			}
		},
	};
}
