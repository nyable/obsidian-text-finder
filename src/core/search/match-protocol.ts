import type { ReplacementChange } from "./text-matching";
import type { MatchOffset, SearchOptions, SearchRange } from "./types";

export interface MatchRequest {
	id: number;
	source: string;
	query: string;
	options: SearchOptions;
	ranges?: readonly SearchRange[] | undefined;
	operation?: "replaceOne" | "replaceAll";
	replacement?: string;
	index?: number;
}

export type MatchReply =
	| { type: "ready" }
	| {
			type: "result";
			id: number;
			offsets: ArrayBuffer;
			changes?: ReplacementChange[] | undefined;
	  }
	| { type: "failed"; id: number; error: string };

export type MatchResult =
	| {
			status: "completed";
			matches: MatchOffset[];
			synchronous: boolean;
			changes?: ReplacementChange[];
	  }
	| { status: "cancelled" }
	| { status: "failed"; error: unknown };

export interface MatchExecutor {
	match(
		source: string,
		query: string,
		options: SearchOptions,
		ranges?: readonly SearchRange[],
	): MatchResult | Promise<MatchResult>;
	replace?(
		source: string,
		query: string,
		replacement: string,
		options: SearchOptions,
		index: number,
		all: boolean,
		ranges?: readonly SearchRange[],
	): MatchResult | Promise<MatchResult>;
	cancel(): void;
	destroy(): void;
}
