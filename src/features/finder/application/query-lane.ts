import type { MatchExecutor, MatchResult } from "../../../core/search/match-protocol";
import type { EditingSnapshot } from "./editor-port";

export interface QueryIntent {
	context: EditingSnapshot;
	key: string;
	window: object | null;
	scroll: boolean;
	direction: number;
}
type QueryExecution = { status: "idle" } | { status: "pending"; intent: QueryIntent };

/** Non-observable execution resources, distinct from a query's displayed result.
 * Same-query navigation accumulates on its intent; cancellation invalidates the
 * accepted promise before terminating the transport. */
export class QueryLane {
	constructor(private reportError: (error: unknown) => void) {}
	private execution: QueryExecution = { status: "idle" };
	private executor: MatchExecutor | null = null;
	get pending(): QueryIntent | null {
		return this.execution.status === "pending" ? this.execution.intent : null;
	}
	get engine(): MatchExecutor | null {
		return this.executor;
	}
	use(engine: MatchExecutor): void {
		this.executor = engine;
	}
	cancel(preserveIdle = false, replacementBusy = false): void {
		const busy = this.execution.status === "pending" || replacementBusy;
		this.execution = { status: "idle" };
		if (!preserveIdle || busy) this.executor?.cancel();
	}
	pauseNavigation(): void {
		const pending = this.pending;
		if (pending) {
			pending.scroll = false;
			pending.direction = 0;
		}
	}
	accept(
		intent: QueryIntent,
		result: Promise<MatchResult>,
		publish: (result: MatchResult, intent: QueryIntent) => void,
	): void {
		this.execution = { status: "pending", intent };
		const settle = (value: MatchResult) => {
			if (this.pending !== intent) return;
			this.execution = { status: "idle" };
			publish(value, intent);
		};
		void result
			.then(settle, (error) => settle({ status: "failed", error }))
			.catch(this.reportError);
	}
}
