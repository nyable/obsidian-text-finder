/**
 * 从source中查找target的offset坐标数组
 * @param source  source字符串
 * @param target  target字符串
 * @param enableRegexMode 是否使用正则表达式
 * @param enableCaseSensitive  是否大小写敏感
 * @returns offset数组
 */
export function findTextOffsets(
	source: string,
	target: string,
	enableRegexMode: boolean,
	enableCaseSensitive: boolean
): MatchOffset[] {
	const matches: MatchOffset[] = [];
	if (source != "" && target != "") {
		let index = 0;
		if (enableRegexMode) {
			try {
				const flags = "gm" + (enableCaseSensitive ? "" : "i");
				const regex = new RegExp(target, flags);

				// for (const match of source.matchAll(regex)) {
				// 	matches.push({
				// 		from: match.index,
				// 		to: match.index + match[0].length,
				// 	});
				// }
				let match;
				// 可能有一些正则表达式会导致无限循环,考虑弄个黑名单直接返回[]

				while ((match = regex.exec(source)) !== null) {
					if (match[0] == "") {
						regex.lastIndex++;
					} else {
						matches.push({
							from: match.index,
							to: match.index + match[0].length,
							index: index++,
						});
					}
				}
			} catch (error) {
				console.log(`Finder match error!`, error);
				return [];
			}
		} else {
			// Match the original text: Unicode lowercasing can change its length
			// and make offsets point at unrelated characters in the editor.
			const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const regex = new RegExp(
				escapedTarget,
				"g" + (enableCaseSensitive ? "" : "i")
			);
			let match;
			while ((match = regex.exec(source)) !== null) {
				matches.push({
					from: match.index,
					to: match.index + match[0].length,
					index: index++,
				});
			}
		}
	}
	return matches;
}

/**
 * 找出list中,位于target之后的第一个符合结果
 * @param target 目标Offset
 * @param list Offset数组
 * @param extraOffset 偏移量 额外偏移量
 * @returns index
 */
export function findIndexAfterOffset(
	target: MatchOffset,
	list: MatchOffset[],
	extraOffset: number
): number {
	return list.findIndex((item) => item.to >= target.from + extraOffset);
}
