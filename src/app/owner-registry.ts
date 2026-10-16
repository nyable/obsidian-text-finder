/** A lazy owner record groups resources without creating a Finder or Worker. */
export class OwnerRegistry<Owner extends object, Resources extends object> {
	private records = new Map<Owner, Resources>();
	constructor(
		private create: (owner: Owner) => Resources,
		private release: (resources: Resources) => void,
	) {}
	get(owner: Owner): Resources | undefined {
		return this.records.get(owner);
	}
	ensure(owner: Owner): Resources {
		let resources = this.records.get(owner);
		if (!resources) {
			resources = this.create(owner);
			this.records.set(owner, resources);
		}
		return resources;
	}
	entries() {
		return this.records.entries();
	}
	remove(owner: Owner): void {
		const resources = this.records.get(owner);
		if (!resources) return;
		try {
			this.release(resources);
		} finally {
			this.records.delete(owner);
		}
	}
	dispose(): void {
		const errors: unknown[] = [];
		for (const owner of this.records.keys()) {
			try {
				this.remove(owner);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length) throw new AggregateError(errors, "Owner cleanup failed");
	}
}
