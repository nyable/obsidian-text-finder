# 开发环境与构建

命令均在仓库根目录执行。

## 环境

- Node.js 24.21.0，见 [`.node-version`](../.node-version)。
- pnpm，版本见 [`package.json`](../package.json) 的 `packageManager`。安装方式见 [pnpm 安装指南](https://pnpm.io/installation)。
- 使用 TypeScript、Svelte 4、CodeMirror 6 和 esbuild。

## 源码构建与安装

克隆仓库后执行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

将生成的 `dist/main.js`、`dist/styles.css` 和 `dist/manifest.json` 复制到测试库的 `.obsidian/plugins/text-finder/`，然后启用或重载插件。不要为了测试覆盖日常库中的设置和历史数据。

`pnpm dev` 启动开发构建。自动测试与实际应用验收的区别见 [测试文档](testing.md)。

## 依赖与 CI

- 本仓库使用 pnpm，不使用 npm 或 Yarn 安装依赖。
- 修改依赖时，使用 pnpm 更新并提交 `pnpm-lock.yaml`。
- [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) 固定 CodeMirror 版本并配置构建依赖许可，避免多个不兼容的实例。
- CI 使用 `--frozen-lockfile` 安装，执行测试、TypeScript/Svelte 检查和插件构建，配置见 [`.github/workflows/`](../.github/workflows/)。

## 代码入口

- [`src/main.ts`](../src/main.ts)：插件加载、设置和持久化。
- [`src/editor-extension.ts`](../src/editor-extension.ts)：命令、视图归属及资源管理。
- [`src/SearchBox.svelte`](../src/SearchBox.svelte)：共享面板、查询、历史及导航入口。
- [`src/search-highlight.ts`](../src/search-highlight.ts)：编辑模式 CodeMirror 高亮。
- [`src/reading-search.ts`](../src/reading-search.ts)、[`src/reading-text.ts`](../src/reading-text.ts)：阅读模式适配与文本映射。

## API 与发布注意事项

Obsidian 版本变化可能影响接口。阅读查找目前还依赖非公开接口，因此必须进行运行时检查和 [真实应用验收](reading-acceptance.md)，不能仅凭编译成功判断兼容性。`manifest.json` 的最低版本声明不等同于阅读查找已在所有版本验证。
