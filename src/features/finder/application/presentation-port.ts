export interface PanelPresentation {
	visible: boolean;
	docked: boolean;
	side: "left" | "right";
	autoDock: boolean;
}

/** Effects are synchronous unless explicitly requested after the Vue layout commit. */
export interface PresentationPort {
	sync(panel: PanelPresentation): void;
	refresh(): void;
	blur(): void;
	focusMarker(): void;
	focusHandle(): void;
	focusQuery(): void;
	focusInput(target: "search" | "replace", afterLayout: boolean, current: () => boolean): void;
	identity(): object | null;
	hideMenu(): void;
	resetPosition(): void;
}

export const silentPresentation: PresentationPort = {
	sync() {},
	refresh() {},
	blur() {},
	focusMarker() {},
	focusHandle() {},
	focusQuery() {},
	focusInput() {},
	identity: () => null,
	hideMenu() {},
	resetPosition() {},
};
