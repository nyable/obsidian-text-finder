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
- 回归测试含版本、翻译键、产品命令／设置表、CSS 默认值一致性检查；构建后 CI 比较 manifest 源文件和产物。

## 变更同步

- 产品行为以 interactions 的批准契约为预期，源码和测试记录实现；冲突时先判定需求，不自动以代码为准。
- 默认值／类型以 settings 和 toolbar 为来源，命令以注册定义为来源，公开 CSS 默认值以全局 SCSS 为来源。文档表格由一致性测试守护，不引入重复 Schema 系统。
- 功能变化核对 README／features，交互变化核对 interactions，数据变化核对 architecture 与迁移回归，宿主依赖变化核对 compatibility 与实机场景。
- 每次关键功能变更核对异常路径测试、旧数据兼容、命令／CSS 接口、文案及真实宿主验收需求。安全公告按可达调用链判断，不为消除扫描命中盲目升级框架主版本。

## 维护入口

- 模块、代码入口和数据格式见 [architecture](architecture.md)。
- 宿主 API 与支持边界见 [compatibility](compatibility.md)。
- 验证命令、性能诊断及实机验收方法见 [testing](testing.md)。
