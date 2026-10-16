import { expect, it, vi } from "vitest";
import { navigateToMatch } from "../../src/features/finder/application/match-navigation";

function environment() {
	return {
		currentRequest: vi.fn(() => true),
		currentContext: vi.fn(() => true),
		refreshRebuiltContext: vi.fn(),
		reveal: vi.fn<() => void | Promise<void>>(),
		publish: vi.fn(),
		failed: vi.fn(),
		canReportAsyncFailure: vi.fn(() => true),
	};
}
it("publishes synchronous navigation without introducing a microtask", () => {
	const h = environment();
	expect(navigateToMatch(h)).toBe(true);
	expect(h.publish).toHaveBeenCalledOnce();
});
for (const stale of ["currentRequest", "currentContext"] as const) {
	it(`rejects late host completion after ${stale} changes`, async () => {
		const h = environment();
		let resolve!: () => void;
		h.reveal.mockReturnValue(
			new Promise<void>((done) => {
				resolve = done;
			}),
		);
		const result = navigateToMatch(h);
		expect(h.publish).not.toHaveBeenCalled();
		h[stale].mockReturnValue(false);
		resolve();
		expect(await result).toBe(false);
		expect(h.publish).not.toHaveBeenCalled();
		expect(h.refreshRebuiltContext).toHaveBeenCalledTimes(stale === "currentContext" ? 1 : 0);
	});
}
it("waits for mode completion before publishing a selection", async () => {
	const h = environment();
	h.reveal.mockResolvedValue();
	const result = navigateToMatch(h);
	expect(h.publish).not.toHaveBeenCalled();
	expect(await result).toBe(true);
	expect(h.publish).toHaveBeenCalledOnce();
});
for (const stale of [false, true]) {
	it(`handles host rejection without retry, stale=${stale}`, async () => {
		const h = environment(),
			error = new Error("host mode change");
		h.reveal.mockRejectedValue(error);
		h.currentRequest.mockReturnValue(!stale);
		expect(await navigateToMatch(h)).toBe(false);
		expect(h.failed).toHaveBeenCalledTimes(stale ? 0 : 1);
		expect(h.reveal).toHaveBeenCalledOnce();
		expect(h.publish).not.toHaveBeenCalled();
	});
}
it("contains synchronous effect defects with the same failure result", () => {
	const h = environment(),
		error = new Error("publish defect");
	h.publish.mockImplementation(() => {
		throw error;
	});
	expect(navigateToMatch(h)).toBe(false);
	expect(h.failed).toHaveBeenCalledExactlyOnceWith(error);
});
