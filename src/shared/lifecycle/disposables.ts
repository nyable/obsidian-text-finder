/** A scope releases resources in reverse acquisition order, once. */
export class Disposables {
	private cleanups: (() => void)[] = [];
	private disposed = false;
	add(cleanup: () => void): void {
		if (this.disposed) cleanup();
		else this.cleanups.push(cleanup);
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		const errors: unknown[] = [];
		for (const cleanup of this.cleanups.splice(0).reverse()) {
			try {
				cleanup();
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length) throw new AggregateError(errors, "Resource cleanup failed");
	}
}
