export interface MatchRequest {
	id: number;
	source: string;
	query: string;
	options: SearchOptions;
}

export type MatchReply = { type: "ready" }
	| { type: "result"; id: number; offsets: ArrayBuffer }
	| { type: "failed"; id: number; error: string };

export type MatchResult = { status: "completed"; matches: MatchOffset[]; synchronous: boolean }
	| { status: "cancelled" }
	| { status: "failed"; error: unknown };

export interface MatchExecutor {
	match(source: string, query: string, options: SearchOptions): MatchResult | Promise<MatchResult>;
	cancel(): void;
	destroy(): void;
}
