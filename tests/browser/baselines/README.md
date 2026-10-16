# 视觉基线

`chromium-linux/` 来自工程重构开始前保存的 32 张截图，不是测试自动接受的当前输出。`provenance.json` 保留原报告、浏览器版本、环境说明和每张图片的 SHA-256。

- 使用锁定的 Playwright Chromium，在 Linux、en-US、UTC、DPR 1 和固定模拟主题下比较。
- `pnpm test:visual` 零像素容差；失败保留 expected／actual／diff，不自动更新。
- 新增或改变基线须审查产品／UI 授权及截图差异，再明确执行 `pnpm test:visual --update-snapshots=all`。不得用更新基线消除未知失败。
- Windows／macOS 运行 `pnpm test:browser`；不同系统字体结果不作为该 Linux 基线的替代。
- 模拟主题、iframe、移动尺寸不是 Obsidian、Android 或 iOS 实机证明。
