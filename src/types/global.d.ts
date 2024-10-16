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
	/**
	 * 放入数组时的index
	 */
	index: number;
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
	search: string = "";
	replace: string = "";
	index: number = 0;
	matches: EditorOffset[] = [];
	visible: boolean = false;
}
