# 开发环境与构建

命令均在仓库根目录执行。

## 环境

- Node.js 版本以 [`.node-version`](../.node-version) 为准，支持范围见 [`package.json`](../package.json) 的 `engines`。
- pnpm，版本见 [`package.json`](../package.json) 的 `packageManager`。安装方式见 [pnpm 安装指南](https://pnpm.io/installation)。
- 使用 TypeScript、Vue 3 Composition API／`<script setup>`、CodeMirror 6，正式与测试构建统一使用 Vite 8／Rolldown。生产已不依赖 Svelte 或直接 esbuild。
- esbuild 仍可能由 Vite 的间接依赖／peer 安装进入锁文件；这不表示项目继续维护 esbuild 构建入口，不要为清掉依赖树名称而破坏 Vite 的依赖约束。

`src/finder-session.ts` 是每个 owner 的会话控制器，通过 `FinderRuntime` 注入浅响应式状态、DOM 提交等待及生命周期；不导入 Vue。`SearchBox.vue` 负责展示与 DOM 绑定。宿主集成只使用 `mountFinder()`／`mountView()` 的操作、update 和 destroy，不依赖组件私有 API。`src/ui/mount.ts` 用 Vue 公开 renderer API 的 owner-bound DOM 操作，保持跨窗口构造器与原有父节点几何；不能改回全局 Document。详见 [架构](architecture.md)。

## 源码构建与安装

克隆仓库后执行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

将生成的 `dist/main.js`、`dist/styles.css` 和 `dist/manifest.json` 复制到测试库的 `.obsidian/plugins/text-finder/`，然后启用或重载插件。不要为了测试覆盖日常库中的设置和历史数据。

`pnpm dev` 使用 `vite build --watch --mode development` 监听构建，不启动网页服务器或承诺 Obsidian 内 HMR。正式产物保持 CommonJS `main.js`、`styles.css`、原样 `manifest.json`；匹配 Worker 和颜色选择器内嵌，不新增运行时下载。自动测试与实际应用验收的区别见 [测试文档](testing.md)。

## 依赖与 CI

- 本仓库使用 pnpm，不使用 npm 或 Yarn 安装依赖。
- 修改依赖时，使用 pnpm 更新并提交 `pnpm-lock.yaml`。
- [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) 固定 CodeMirror 版本并配置构建依赖许可，避免多个不兼容的实例。
- CI 使用 `--frozen-lockfile` 安装，执行测试、TypeScript／Vue 检查和插件构建，配置见 [`.github/workflows/`](../.github/workflows/)。`pnpm test` 单并发避免多个组件构建争用资源。`pnpm test:browser` 单独运行，需要已有 Playwright Chromium，不自动安装系统环境。
- 回归测试含版本、翻译键、产品命令／设置表、CSS 默认值一致性检查；构建后 CI 比较 manifest 源文件和产物。

## 变更同步

- 产品行为以 interactions 的批准契约为预期，源码和测试记录实现；冲突时先判定需求，不自动以代码为准。
- 默认值／类型以 settings 和 toolbar 为来源，命令以注册定义为来源，公开 CSS 默认值以全局 SCSS 为来源。文档表格由一致性测试守护，不引入重复 Schema 系统。
- 功能变化核对 README／features，交互变化核对 interactions，数据变化核对 architecture 与迁移回归，宿主依赖变化核对 compatibility 与实机场景。
- 每次关键功能变更核对异常路径测试、旧数据兼容、命令／CSS 接口、文案及真实宿主验收需求。安全公告按可达调用链判断，不为消除扫描命中盲目升级框架主版本。

## UI 命名与悬浮提示规范

**已确认的宿主行为：** 用户实机反馈并明确确认，Obsidian 会根据 `aria-label` 自动产生悬浮提示。曾在设置分类导航和外观滚动容器上使用该属性，导致鼠标进入大片区域时出现“设置分类／外观”提示。此结论来自用户反馈；自动测试只证明源码标签结构，不证明所有宿主版本或主题中的提示绘制。

新增或修改 UI 时遵守：

1. **先区分读屏命名与视觉提示。** 分类导航、滚动区、预览图、弹出面板和菜单等非操作容器，不用 `aria-label` 仅仅赋予名称。需要名称时，使用 `aria-labelledby` 引用可见标题或所属触发器；没有可见标题时可引用读屏专用文本。
2. **保证引用可靠。** 被引用元素须存在于所属 Document，文本非空；新增实例 ID 应避免重名，并在重绘、弹窗和多个组件实例中维持正确引用。
3. **不要以删除无障碍语义解决提示问题。** 真实操作控件保留可访问名称，图标按钮与状态标记保留必要功能／状态提示。`aria-hidden="true"` 仅用于纯装饰或预览内部图标，不用于可聚焦控件或需要读屏访问的容器。
4. **检查整条提示路径。** 同时审查 `aria-label`、`title` 与 `setTooltip`：提示只覆盖预期目标，避免同一控件出现不同或重复文案。需要读屏名称却不需要名称悬浮提示的输入，可引用标题并保留独立的格式说明；不要另造全局悬浮提示屏蔽机制。
5. **区分自动回归与实机验收。** 自动检查容器没有多余 `aria-label`、`aria-labelledby` 能解析到正确文本、真实控件仍有名称；在 Obsidian 中另查空白区域、标题、控件和菜单边缘的提示，并核对键盘焦点与弹窗表现。未实测不能标记宿主通过。

源码示例：`src/settings-tab.ts` 的 tablist／外观 region，`src/color-picker.ts` 的 dialog／输入命名，`src/ToolbarPreview.vue` 的预览图，以及 `src/Toolbar.vue` 的 More 菜单标题引用与预览图标。

回归入口：
- `tests/main-settings.test.mjs`：`settings containers and preview retain accessible names without Obsidian hover labels`。
- `tests/color-picker.test.mjs`：`picker shell traps Tab, cancels drafts on owner blur/pagehide/scroll and removes listeners` 中的 dialog／输入标题引用检查。
- `tests/search-box-dom.test.mjs`：`hiding Finder closes More without restoring focus into hidden controls` 中的菜单／触发器命名检查。

历史症状与验证边界见 [pitfalls](pitfalls.md) 和 [compatibility](compatibility.md)。

## 维护入口

- 模块、代码入口和数据格式见 [architecture](architecture.md)。
- 宿主 API 与支持边界见 [compatibility](compatibility.md)。
- 验证命令、性能诊断及实机验收方法见 [testing](testing.md)。
