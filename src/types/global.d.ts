/// <reference types="svelte" />

interface EditorOffset {
	/**
	 * 起始位置
	 */
	from: number;
	/**
	 * 起始位置
	 */
	to: number;
}

interface SearchOptions {
	/**
	 * 启用正则表达式模式
	 */
	enableRegexMode: boolean;
	/**
	 * 启用大小写敏感
	 */
	enableCaseSensitive: boolean;
}

interface SearchCache {
	text: string = "";
	index: number = 0;
	matches: EditorOffset[] = [];
}
