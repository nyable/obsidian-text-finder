import { copyRecipe, presetNameTaken, type SearchPreset, type SearchRecipe } from "../model/preset";

export class PresetController {
	private listeners = new Set<() => void>();
	constructor(
		private settings: () => { searchPresets: SearchPreset[] },
		private save: () => Promise<void>,
		private id: () => string,
		private clock = Date.now,
	) {}
	subscribe(listener: () => void) {
		this.listeners.add(listener);
		listener();
		return () => {
			this.listeners.delete(listener);
		};
	}
	notify() {
		this.listeners.forEach((listener) => listener());
	}
	list(): SearchPreset[] {
		return this.settings()
			.searchPresets.map((item) => ({ ...item, ...copyRecipe(item) }))
			.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
	}
	private commit(items: SearchPreset[]) {
		this.settings().searchPresets = items.map((item, order) => ({ ...item, order }));
		this.notify();
		void this.save().catch(() => {});
	}
	put(name: string, recipe: SearchRecipe, id?: string): boolean {
		if (!name.trim() || recipe.search === "" || this.nameTaken(name, id)) return false;
		const items = this.settings().searchPresets;
		const previous = id ? items.find((item) => item.id === id) : undefined;
		// A deleted preset must not be resurrected by a stale editor.
		if (id && !previous) return false;
		const now = this.clock();
		const next: SearchPreset = {
			...copyRecipe(recipe),
			name: name.trim(),
			id: previous?.id ?? this.id(),
			createdAt: previous?.createdAt ?? now,
			updatedAt: now,
		};
		this.commit(
			previous ? items.map((item) => (item.id === id ? next : item)) : [...items, next],
		);
		return true;
	}
	nameTaken(name: string, excludeId?: string): boolean {
		return presetNameTaken(this.settings().searchPresets, name, excludeId);
	}
	remove(id: string) {
		const items = this.settings().searchPresets;
		if (items.some((item) => item.id === id))
			this.commit(items.filter((item) => item.id !== id));
	}
	/** Resolve ID insertion boundaries against current state, never stale UI indices. */
	move(id: string, before: string | null): boolean {
		const original = this.list();
		const items = original.slice();
		const from = items.findIndex((item) => item.id === id);
		if (
			from < 0 ||
			before === id ||
			(before !== null && !items.some((item) => item.id === before))
		)
			return false;
		const [item] = items.splice(from, 1);
		if (!item) return false;
		items.splice(
			before === null ? items.length : items.findIndex((item) => item.id === before),
			0,
			item,
		);
		if (items.every((item, index) => item.id === original[index]?.id)) return false;
		this.commit(items);
		return true;
	}
	/** Explicit undo only. Never replace a newer item with the deleted snapshot. */
	restore(item: SearchPreset): boolean {
		const items = this.settings().searchPresets;
		if (!items.some((current) => current.id === item.id) && !this.nameTaken(item.name)) {
			const next = this.list();
			next.splice(Math.min(item.order ?? next.length, next.length), 0, {
				...item,
				...copyRecipe(item),
			});
			this.commit(next);
			return true;
		}
		return false;
	}
}
