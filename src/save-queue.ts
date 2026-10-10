export class SaveQueue<T> {
	private tail: Promise<void> = Promise.resolve();
	private last: Promise<void> = this.tail;
	constructor(private write: (snapshot: T) => Promise<void>) {}

	enqueue(value: T): Promise<void> {
		// Settings are JSON data. Capture before waiting for earlier writes.
		const snapshot = JSON.parse(JSON.stringify(value)) as T;
		const result = this.tail.then(() => this.write(snapshot));
		this.tail = result.catch(() => {});
		this.last = result;
		return result;
	}
	async flush(): Promise<void> {
		// Include writes added while waiting; preserve the final write's failure.
		for (;;) {
			const last = this.last;
			await this.tail;
			if (last === this.last) return last;
		}
	}
}
