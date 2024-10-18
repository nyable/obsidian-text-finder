/// <reference types="svelte" />

interface MatchOffset {
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
	regexMode: boolean;
	/**
	 * 启用大小写敏感
	 */
	caseSensitive: boolean;
}

interface SearchCache {
	/**
	 * 搜索文本
	 */
	search: string;
	/**
	 * 替换文本
	 */
	replace: string;
	/**
	 * 当前项索引
	 */
	index: number;
	/**
	 * 匹配项
	 */
	matches: MatchOffset[];
	/**
	 * 是否显示
	 */
	visible: boolean;
	/**
	 * 是否折叠
	 */
	collapse: boolean;
	/**
	 * 搜索选项
	 */
	options: SearchOptions;
}

interface ReplaceResult {
	/**
	 * 是否有进行替换
	 */
	changed: boolean;
	/**
	 * 替换时的搜索框文本
	 */
	search: string;
	/**
	 * 替换时的替换框文本
	 */
	replace: string;
	/**
	 * 实际替换文本
	 */
	replaceValues: string[];
	/**
	 * 影响的记录数
	 */
	changeCount: number;
	/**
	 * 替换前的匹配总数量
	 */
	beforeCount: number;
	/**
	 * 替换后的匹配总数量
	 */
	afterCount: number;
}
