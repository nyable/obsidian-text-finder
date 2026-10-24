# 视觉基线

`chromium-linux/` 包含 40 张已审查截图：24 张保留工程重构前的查找器／设置预览原图，8 张历史／详情更新图，8 张新增预设列表／编辑器图。2026-10-19 用户确认“按你推荐的来”，授权仅更新／新增后 16 张，不改变其余 24 张。更新不代表新增样式变更授权。

`archive/6823057/chromium-linux/` 完整保留原 32 张截图及原 `provenance.json`；`reviews/library-2026-10-19.json` 保留本次候选的采集报告。当前 `chromium-linux/provenance.json` 按图关联原始／新报告，并记录报告文件与每张图片的 SHA-256。报告中的 `passed` 是采集时 smoke 结果，不是严格像素比较证据；默认模式的 `pnpm test:visual` 才验证当前产物与这 40 张 expected 一致，该命令不在 CI 运行。

- 使用锁定的 Playwright Chromium，在 Linux、en-US、UTC、DPR 1 和固定模拟主题下比较。
- `pnpm test:visual` 零像素容差；失败保留 expected／actual／diff，不自动更新。
- 新增或改变基线须审查产品／UI 授权及截图差异，再明确执行 `pnpm test:visual --update-snapshots=all`。不得用更新基线消除未知失败。
- Windows／macOS 运行 `pnpm test:browser`；不同系统字体结果不作为该 Linux 基线的替代。
- 模拟主题、iframe、移动尺寸不是 Obsidian、Android 或 iOS 实机证明。
- smoke 与严格比较共用 `../visual-contracts.mjs` 场景清单；严格比较先校验全部预期文件、provenance 唯一条目、像素文件 SHA-256，以及各图引用的来源报告和报告哈希。不能以过滤无基线场景或更宽容比较消除失败；新增场景及已改版场景必须分别审查。
- 只有显式 `--update-snapshots=all`／`changed` 会跳过更新前的集合预检，让获批新图可创建；更新后须同步 provenance 的来源和哈希，再以默认禁止更新模式复验。更新命令成功本身不是严格比较通过证据。
