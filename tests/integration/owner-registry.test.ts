import { expect, it, vi } from "vitest";
import { OwnerRegistry } from "../../src/app/owner-registry";

it("keeps identical-file owners independent and does not create expensive resources", () => {
	const createWorker = vi.fn();
	const released = vi.fn();
	const registry = new OwnerRegistry(
		() => ({ worker: undefined as unknown, createWorker }),
		released,
	);
	const first = { path: "same.md" },
		second = { path: "same.md" };
	expect(registry.get(first)).toBeUndefined();
	const one = registry.ensure(first),
		two = registry.ensure(second);
	expect(one).not.toBe(two);
	expect(registry.ensure(first)).toBe(one);
	expect(createWorker).not.toHaveBeenCalled();
	registry.remove(first);
	registry.remove(first);
	expect(registry.get(second)).toBe(two);
	expect(released).toHaveBeenCalledExactlyOnceWith(one);
	registry.dispose();
	registry.dispose();
	expect(released).toHaveBeenCalledTimes(2);
});

it("releases every owner when a resource fails cleanup", () => {
	const released: object[] = [];
	const registry = new OwnerRegistry(
		(owner) => owner,
		(owner) => {
			released.push(owner);
			throw new Error("cleanup");
		},
	);
	registry.ensure({});
	registry.ensure({});
	expect(() => registry.dispose()).toThrow(AggregateError);
	expect(released).toHaveLength(2);
	expect([...registry.entries()]).toHaveLength(0);
});
