import { expect, it, vi } from "vitest";
import { Disposables } from "../../src/shared/lifecycle/disposables";

it("releases in reverse order once, including late registrations", () => {
	const scope = new Disposables(),
		events: number[] = [];
	scope.add(() => {
		events.push(1);
	});
	scope.add(() => {
		events.push(2);
	});
	scope.dispose();
	scope.dispose();
	scope.add(() => {
		events.push(3);
	});
	expect(events).toEqual([2, 1, 3]);
});

it("releases remaining resources even if a cleanup throws", () => {
	const scope = new Disposables(),
		cleanup = vi.fn();
	scope.add(cleanup);
	scope.add(() => {
		throw new Error("failure");
	});
	expect(() => scope.dispose()).toThrow(AggregateError);
	expect(cleanup).toHaveBeenCalledOnce();
	expect(() => scope.dispose()).not.toThrow();
});
