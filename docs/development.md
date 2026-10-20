# 开发环境与构建

命令均在仓库根目录执行。

## 环境

- Node.js 版本以 [`.node-version`](../.node-version) 为准，支持范围见 [`package.json`](../package.json) 的 `engines`。
- pnpm，版本见 [`package.json`](../package.json) 的 `packageManager`。安装方式见 [pnpm 安装指南](https://pnpm.io/installation)。
- 使用 TypeScript、Vue 3 Composition API／`<script setup>`、CodeMirror 6，正式与测试构建统一使用 Vite 8／Rolldown。生产已不依赖 Svelte 或直接 esbuild。
- esbuild 仍可能由 Vite 的间接依赖／peer 安装进入锁文件；这不表示项目继续维护 esbuild 构建入口，不要为清掉依赖树名称而破坏 Vite 的依赖约束。

`src/main.ts` 是薄入口，`src/app/create-plugin-runtime.ts` 装配宿主服务。Finder application 只接收 owner-bound ports，不导入 DOM／Vue／宿主类；`useFinderViewModel.ts` 连接浅响应式及交互层。`src/shared/ui/mount-view.ts` 使用 owner-bound renderer，保持跨窗口构造器和父节点几何；不能改回默认全局 Document。详见 [架构](architecture.md)。

Vue 编译统一使用 `tools/vue-plugin.mjs:ownerVue()`，正式／Vitest／浏览器入口不能另建默认插件实例：静态提升关闭，禁止生成需要 HTML 解析的静态 VNode。原生 owner DOM、Worker／存储 `globalThis`、IME 229 与诊断日志的发布检查例外见 [compatibility](compatibility.md#发布检查中的设计例外)，不通过批量自动修复改变这些边界。

## 按任务定位

| 修改内容 | 入口 | 最小回归 |
| --- | --- | --- |
| 匹配、全字、范围、替换模板 | `src/core/search/` | `tests/unit/text-matching.test.mjs`、`regex-replacement.test.mjs`、`tests/integration/match-engine.test.mjs` |
| Finder 查询／导航／替换状态 | `src/features/finder/application/` | `finder-session.test.ts`、`replacement-operation.test.ts`、`tests/component/finder-panel.test.mjs` |
| 焦点、IME、拖动、布局 | `src/features/finder/interaction/`、`ui/useFinderViewModel.ts` | 真实 Finder 组件、position／mobile-toolbar 与 Playwright |
| 阅读全文、选区、绘制 | `src/features/reading/dom/`，私有能力在 `platform/obsidian/preview-renderer.ts` | reading-index／reading-search／reading-scope／reading-commands |
| 历史身份／排序／订阅／复制 | `src/features/history/` | history-contracts／history-panel／finder-panel |
| 设置 schema／更新／控件 | `src/features/settings/model/`、`application/settings-controller.ts`、`ui/settings-view.ts` | settings-controller／main-settings／appearance／settings-select |
| 宿主命令／owner／生命周期 | `src/app/workspace-runtime.ts`、`workspace-commands.ts`、`owner-registry.ts` | editor-isolation／finder-menus／reading-commands／floating-entry |
| 写入与重载存储 | `src/platform/codemirror/finder-editor.ts`、`platform/obsidian/settings-storage.ts` | finder-editor／replacement／settings-storage／main-settings |
| 构建、内嵌 Worker／调色器 | `vite.config.mjs`、`tools/vite-build.mjs` | `pnpm test:artifacts`、build、浏览器 Worker |

先读该功能的产品契约和模块 API，增加行为回归后改最小边界；不借 app 反向取服务，不用修改依赖／放宽断言绕过失败。变更后更新对应事实文档，报告实际检查与未覆盖的宿主环境。

## 源码构建与安装

克隆仓库后执行：

```sh
pnpm install --frozen-lockfile
pnpm verify
```

将生成的 `dist/main.js`、`dist/styles.css` 和 `dist/manifest.json` 复制到测试库的 `.obsidian/plugins/text-finder/`，然后启用或重载插件。不要为了测试覆盖日常库中的设置和历史数据。

`pnpm verify` 统一运行 lint（含生产 Promise 类型规则）、格式、依赖边界、Vitest、独立产物契约、类型检查／正式构建、产物校验及 Playwright smoke。浏览器缺失会失败而不是跳过；首次运行先 `pnpm exec playwright install chromium`。严格 Linux 视觉比较另运行 `pnpm test:visual`，不以不同 OS 字体结果更新 Linux 基线。日常小改可先按表运行目标套件，交付前运行完整入口。

`pnpm test:watch` 为 Vitest 开发循环；`pnpm format` 写格式、`pnpm format:check` 只读检查。构建会写 dist，产物契约的内存构建不写安装目录。WSL 和 Windows 原生依赖需分别安装，不跨 OS 复用 node_modules；Windows 构建由使用者手动执行，不改变全局供应链策略。WSL 下频繁运行验证时优先将仓库和 Linux 依赖一起放在 Linux 原生文件系统（如 `~/projects/`），避免 `/mnt/c`、`/mnt/e` 等 Windows 挂载盘的大量小文件访问开销；只移动源码、继续链接挂载盘上的 node_modules 不能隔离依赖 I/O。

`pnpm dev` 使用 `vite build --watch --mode development` 监听构建，不启动网页服务器或承诺 Obsidian 内 HMR。正式产物保持 CommonJS `main.js`、`styles.css`、原样 `manifest.json`；匹配 Worker 和颜色选择器内嵌，不新增运行时下载。自动测试与实际应用验收的区别见 [测试文档](testing.md)。

## 依赖与 CI

- 本仓库使用 pnpm，不使用 npm 或 Yarn 安装依赖。
- 修改依赖时，使用 pnpm 更新并提交 `pnpm-lock.yaml`。
- [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) 固定 CodeMirror 版本并配置构建依赖许可，避免多个不兼容的实例。
- CI 配置 Linux／Windows／macOS 锁定安装、测试、类型、lint／格式／依赖和构建；Linux job 另做严格视觉比较，配置见 [`.github/workflows/`](../.github/workflows/)。配置不代表各平台已经运行成功。`pnpm test` 最多使用两个 worker，保留逐文件隔离；低内存环境可用 `pnpm test --maxWorkers=1` 降为串行。`pnpm test:browser` 单独运行，需要已有 Playwright Chromium，不自动安装系统环境。
- 回归测试含版本、翻译键、产品命令／设置表、CSS 默认值一致性检查；构建后 CI 比较 manifest 源文件和产物。

## 变更同步

- 产品行为以 interactions 的批准契约为预期，源码和测试记录实现；冲突时先判定需求，不自动以代码为准。
- 默认值／类型以 settings 和 toolbar 为来源，命令以注册定义为来源，公开 CSS 默认值以全局 SCSS 为来源。文档表格由一致性测试守护，不引入重复 Schema 系统。
- 功能变化核对 README／features，交互变化核对 interactions，数据变化核对 architecture 与迁移回归，宿主依赖变化核对 compatibility 与实机场景。
- 每次关键功能变更核对异常路径测试、旧数据兼容、命令／CSS 接口、文案及真实宿主验收需求。安全公告按可达调用链判断，不为消除扫描命中盲目升级框架主版本。
- `consistency.test.mjs` 核对单双引号静态翻译调用、双语键及插值变量集合、布尔／数值默认值、CSS 默认值和维护文档的内联本地链接。设置／命令键名覆盖只是存在性检查，不证明整段行为正确；动态翻译、锚点、自然语言语义及源码符号引用仍需人工审查。不另维护第二套 Schema。新增浏览器 TypeScript 入口纳入既有 vue-tsc 工程；配置与类型变化由统一 `pnpm verify`／CI 检查。
- CI 的独立 dependency-audit job 保存完整 `pnpm audit --json` 报告；扫描步骤非阻断，不建立永久豁免。命中须区分宿主 external、开发依赖和实际可达输入；网络／扫描失败也不等同“无漏洞”。PR 模板保留文档、迁移、公开接口、异常测试和宿主验收清单。

## UI 命名与悬浮提示规范

**已确认的宿主行为：** 用户实机反馈并明确确认，Obsidian 会根据 `aria-label` 自动产生悬浮提示。曾在设置分类导航和外观滚动容器上使用该属性，导致鼠标进入大片区域时出现“设置分类／外观”提示。此结论来自用户反馈；自动测试只证明源码标签结构，不证明所有宿主版本或主题中的提示绘制。

新增或修改 UI 时遵守：

1. **先区分读屏命名与视觉提示。** 分类导航、滚动区、预览图、弹出面板和菜单等非操作容器，不用 `aria-label` 仅仅赋予名称。需要名称时，使用 `aria-labelledby` 引用可见标题或所属触发器；没有可见标题时可引用读屏专用文本。
2. **保证引用可靠。** 被引用元素须存在于所属 Document，文本非空；新增实例 ID 应避免重名，并在重绘、弹窗和多个组件实例中维持正确引用。
3. **不要以删除无障碍语义解决提示问题。** 真实操作控件保留可访问名称，图标按钮与状态标记保留必要功能／状态提示。`aria-hidden="true"` 仅用于纯装饰或预览内部图标，不用于可聚焦控件或需要读屏访问的容器。
4. **检查整条提示路径。** 同时审查 `aria-label`、`title` 与 `setTooltip`：提示只覆盖预期目标，避免同一控件出现不同或重复文案。需要读屏名称却不需要名称悬浮提示的输入，可引用标题并保留独立的格式说明；不要另造全局悬浮提示屏蔽机制。
5. **区分自动回归与实机验收。** 自动检查容器没有多余 `aria-label`、`aria-labelledby` 能解析到正确文本、真实控件仍有名称；在 Obsidian 中另查空白区域、标题、控件和菜单边缘的提示，并核对键盘焦点与弹窗表现。未实测不能标记宿主通过。

源码示例：`src/features/settings/ui/settings-view.ts` 的 tablist／外观 region，`color-picker.ts` 的 dialog／输入命名，`ToolbarPreview.vue` 的预览图，以及 `src/features/finder/ui/FinderToolbar.vue` 的 More 菜单标题引用与预览图标。

回归入口：
- `tests/integration/main-settings.test.mjs`：`settings containers and preview retain accessible names without Obsidian hover labels`。
- `tests/component/color-picker.test.mjs`：`picker shell traps Tab, cancels drafts on owner blur/pagehide/scroll and removes listeners` 中的 dialog／输入标题引用检查。
- `tests/component/finder-panel.test.mjs`：`hiding Finder closes More without restoring focus into hidden controls` 中的菜单／触发器命名检查。

历史症状与验证边界见 [pitfalls](pitfalls.md) 和 [compatibility](compatibility.md)。

## 维护入口

- 模块、代码入口和数据格式见 [architecture](architecture.md)。
- 宿主 API 与支持边界见 [compatibility](compatibility.md)。
- 验证命令、性能诊断及实机验收方法见 [testing](testing.md)。
