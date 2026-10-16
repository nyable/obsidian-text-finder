interface NavigationEffects {
	currentRequest(): boolean;
	currentContext(): boolean;
	refreshRebuiltContext(): void;
	reveal(): void | Promise<void>;
	publish(): void;
	failed(error: unknown): void;
	canReportAsyncFailure(): boolean;
}

/** Reveal may start an uncancellable host mode change. Selection is a separate
 * effect, accepted only after the original request and editor are still valid.
 * Synchronous hosts retain synchronous publication and return timing. */
export function navigateToMatch(effects: NavigationEffects): boolean | Promise<boolean> {
	const complete = () => {
		if (!effects.currentRequest()) return false;
		if (!effects.currentContext()) {
			effects.refreshRebuiltContext();
			return false;
		}
		effects.publish();
		return true;
	};
	try {
		const changed = effects.reveal();
		if (changed && typeof changed.then === "function") {
			return Promise.resolve(changed)
				.then(complete)
				.catch((error) => {
					if (effects.currentRequest() && effects.canReportAsyncFailure())
						effects.failed(error);
					return false;
				});
		}
		return complete();
	} catch (error) {
		effects.failed(error);
		return false;
	}
}
