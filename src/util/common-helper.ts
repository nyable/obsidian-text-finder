/**
 * 生成一个唯一的ID，有UUID就用UUID，不然用时间戳+随机数
 * 对于唯一性其实没那么高要求
 * @returns 唯一ID
 */
export function generateUniqueId() {
	if (crypto && crypto.randomUUID) {
		return crypto.randomUUID();
	} else {
		return generateSimpleId();
	}
}

/**
 * 生成一个简单的ID
 * @returns ID
 */
export function generateSimpleId() {
	const timeStr = Date.now().toString(36);
	const randomStr = Math.random().toString(36).substring(2);
	return `${timeStr}-${randomStr}`;
}
