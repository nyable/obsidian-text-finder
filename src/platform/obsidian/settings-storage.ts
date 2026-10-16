import type { App } from "obsidian";

interface StorageLane {
	tail: Promise<void>;
}

// A plugin reload evaluates a new module. Keep the lane on the shared realm,
// keyed by App and data path, rather than on the old plugin/module instance.
const registryKey = Symbol.for("text-finder.settings-storage.v1");
const realm = globalThis as typeof globalThis & {
	[key: symbol]: WeakMap<App, Map<string, StorageLane>>;
};
const registry = realm[registryKey] ?? (realm[registryKey] = new WeakMap());

export class SettingsStorage {
	private lane: StorageLane;
	private closed = false;
	private lastWrite: Promise<void> = Promise.resolve();

	constructor(
		private app: App,
		private path: string,
	) {
		let paths = registry.get(app);
		if (!paths) {
			paths = new Map();
			registry.set(app, paths);
		}
		let lane = paths.get(path);
		if (!lane) {
			lane = { tail: Promise.resolve() };
			paths.set(path, lane);
		}
		this.lane = lane;
	}

	private run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.closed) return Promise.reject(new Error("Settings storage is closed"));
		const result = this.lane.tail.then(operation);
		this.lane.tail = result.then(
			() => {},
			() => {},
		);
		return result;
	}

	read(): Promise<unknown> {
		return this.run(async () => {
			const adapter = this.app.vault.adapter;
			// exists() in some host adapters turns permission errors into false.
			// stat() distinguishes a missing file from an inaccessible one.
			let stat;
			try {
				stat = await adapter.stat(this.path);
			} catch (error) {
				if ((error as { code?: string } | null)?.code === "ENOENT") return null;
				throw error;
			}
			if (stat === null) return null;
			if (stat.type !== "file") throw new Error("Settings path is not a file");
			// Host loadData/readJson may swallow I/O and JSON errors. Parse here so
			// a failed read can never be mistaken for a new installation.
			return JSON.parse(await adapter.read(this.path));
		});
	}

	write(value: unknown): Promise<void> {
		// Serialize before waiting, preserving the exact state accepted by the UI.
		const text = JSON.stringify(value, null, 2);
		this.lastWrite = this.run(() => this.app.vault.adapter.write(this.path, text));
		return this.lastWrite;
	}

	async flush(): Promise<void> {
		for (;;) {
			const last = this.lastWrite;
			await this.lane.tail;
			if (last === this.lastWrite) return last;
		}
	}

	// Accepted writes finish; new instances read behind them in the same lane.
	close() {
		this.closed = true;
	}
}
