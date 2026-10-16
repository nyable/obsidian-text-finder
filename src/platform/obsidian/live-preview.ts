import type { Vault } from "obsidian";

/**
 * The `livePreview` preference only exists on the internal `Vault.getConfig`
 * API, which is not part of the public Obsidian typings.
 */
type VaultWithConfig = Vault & {
	getConfig?: (key: "livePreview") => unknown;
};

/**
 * 读取全局 "实时预览" 设置。
 * 当内部 API 不可用或返回非布尔值时返回 undefined，
 * 调用方应据此避免在数据不可靠时切换模式。
 * @param vault Obsidian 的 Vault 实例
 * @returns 是否启用实时预览，无法确定时为 undefined
 */
export function getLivePreviewPreference(vault: Vault): boolean | undefined {
	const configVault = vault as VaultWithConfig;
	if (typeof configVault.getConfig !== "function") return undefined;
	try {
		const value = configVault.getConfig("livePreview");
		return typeof value === "boolean" ? value : undefined;
	} catch {
		return undefined;
	}
}
