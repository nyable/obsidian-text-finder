# 开发环境与构建

命令均在仓库根目录执行。

## 环境

- Node.js 版本以 [`.node-version`](../.node-version) 为准，支持范围见 [`package.json`](../package.json) 的 `engines`。
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

## 维护入口

- 模块、代码入口和数据格式见 [architecture](architecture.md)。
- 宿主 API 与支持边界见 [compatibility](compatibility.md)。
- 验证命令、性能诊断及实机验收方法见 [testing](testing.md)。
