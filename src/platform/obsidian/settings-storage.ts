import type { App } from "obsidian";

interface StorageLane {
	tail: Promise<void>;
	pending?: { text: string; promise: Promise<void> } | undefined;
	diskText?: string | null;
	epoch?: number;
}

export class SettingsConflictError extends Error {
	readonly code = "TEXT_FINDER_SETTINGS_CONFLICT";
	constructor() {
		super("Settings changed externally; refusing to overwrite stored data");
	}
}

// A plugin reload evaluates a new module. Keep the lane on the shared realm,
// keyed by App and data path, rather than on the old plugin/module instance.
// Do not use activeWindow: focus changes must never split the persistence queue.
const registryKey = Symbol.for("text-finder.settings-storage.v1");
const realm = globalThis as typeof globalThis & {
	[key: symbol]: WeakMap<App, Map<string, StorageLane>>;
};
const registry = realm[registryKey] ?? (realm[registryKey] = new WeakMap());

export class SettingsStorage {
	private lane: StorageLane;
	private closed = false;
	private lastWrite: Promise<void> = Promise.resolve();
	private epoch: number | undefined;

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

	private async diskText(): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		let stat;
		try {
			stat = await adapter.stat(this.path);
		} catch (error) {
			if ((error as { code?: string } | null)?.code === "ENOENT") return null;
			throw error;
		}
		if (stat === null) return null;
		if (stat.type !== "file") throw new Error("Settings path is not a file");
		return adapter.read(this.path);
	}

	read(): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("Settings storage is closed"));
		// A read seals the preceding batch: later writes must stay behind it.
		this.lane.pending = undefined;
		return this.run(async () => {
			const text = await this.diskText();
			const value: unknown = text === null ? null : JSON.parse(text);
			if (this.lane.diskText !== text) this.lane.epoch = (this.lane.epoch ?? 0) + 1;
			this.lane.diskText = text;
			this.epoch = this.lane.epoch;
			return value;
		});
	}

	/** A queued external refresh cannot discard edits made while disk I/O waits. */
	readExternal(
		accept: (value: unknown) => boolean,
	): Promise<{ changed: boolean; value?: unknown }> {
		this.lane.pending = undefined;
		return this.run(async () => {
			const text = await this.diskText();
			if (text === this.lane.diskText) return { changed: false };
			const value: unknown = text === null ? null : JSON.parse(text);
			// Apply the accepted in-memory value synchronously with baseline adoption.
			// Otherwise a save in the promise continuation gap could use an old DTO
			// with this new disk baseline.
			if (!accept(value)) throw new SettingsConflictError();
			this.lane.epoch = (this.lane.epoch ?? 0) + 1;
			this.lane.diskText = text;
			this.epoch = this.lane.epoch;
			return { changed: true, value };
		});
	}

	write(value: unknown): Promise<void> {
		if (this.closed) return Promise.reject(new Error("Settings storage is closed"));
		if (this.lane.diskText !== undefined && this.epoch !== this.lane.epoch)
			return Promise.reject(new SettingsConflictError());
		// Snapshot now, never retain the mutable DTO. Only unstarted writes merge.
		const text = JSON.stringify(value, null, 2);
		const pending = this.lane.pending;
		if (pending) {
			pending.text = text;
			this.lastWrite = pending.promise;
			return this.lastWrite;
		}
		const batch = { text, promise: Promise.resolve() };
		const epoch = this.epoch;
		batch.promise = this.run(async () => {
			if (this.lane.pending === batch) this.lane.pending = undefined;
			// Production always reads before writing. Preserve unchecked standalone
			// lanes only until their first read; a stale reader may never rebase itself.
			if (this.lane.diskText !== undefined) {
				if (
					(epoch ?? this.epoch) !== this.lane.epoch ||
					(await this.diskText()) !== this.lane.diskText
				)
					throw new SettingsConflictError();
			}
			await this.app.vault.adapter.write(this.path, batch.text);
			if (this.lane.diskText !== undefined) this.lane.diskText = batch.text;
		});
		this.lane.pending = batch;
		this.lastWrite = batch.promise;
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
