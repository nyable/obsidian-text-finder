# Text Finder：AI 协作约束

本项目是 Obsidian 插件：编辑模式查找／替换 Markdown 源码，阅读模式查找渲染正文。当前使用 TypeScript、Vue 3、Vite 和 CodeMirror。

## 阅读入口

- 功能与设置：[features](docs/product/features.md)。
- 操作与状态契约：[interactions](docs/product/interactions.md)，尤其是“已批准的关闭契约”。
- 视觉与公开 CSS 接口：[ui-baseline](docs/product/ui-baseline.md)。
- 模块、状态及数据格式：[architecture](docs/architecture.md)。
- 宿主 API、降级与验证边界：[compatibility](docs/compatibility.md)。
- 已验证的回归经验：[pitfalls](docs/pitfalls.md)。
- 环境和验证命令：[development](docs/development.md)、[testing](docs/testing.md)。

## 修改边界

- 先确认授权范围；代码调整不自动授权产品行为、样式或数据格式变化。
- Finder 属于具体 Markdown 视图。同文件双分屏也有独立当前项；不能以全局活动编辑器替代 owner。
- 写入前重新匹配并校验文档／编辑器身份；不能直接使用隐藏面板或旧文档的匹配坐标。
- 阅读查找不替换、不写文件、不切换到编辑模式；不把局部视口结果当作全文结果。
- 历史身份为精确文本，保留空白；保存不能阻塞导航。读取失败时不得覆盖已有数据。
- 保留持久化字段、命令 ID、公开 CSS 类和变量、原生查找降级语义，除非获得明确变更授权。
- 调整组件或插件生命周期时仍须释放订阅、事件、Observer、计时器及高亮所有权。

入口：`src/app/` 装配与 owner 资源，`src/features/finder/application/` 会话／ports／替换，`src/features/finder/interaction/` DOM 效果，`src/features/reading/dom/` 阅读，`src/features/history/` 历史，`src/features/settings/` 设置；`src/shared/ui/mount-view.ts` 保证 owner-bound 渲染。按任务定位表见 development。

依赖由 `.dependency-cruiser.cjs` 强制：core 纯算法，model／application 不依赖宿主／DOM，platform 只实现能力不挂载 UI；功能间经显式公共入口，不能反向取 app 服务。不要为过门禁引入万能 utils／services 或放宽规则。

## UI 命名与悬浮提示

- Obsidian 会将 `aria-label` 用作自动悬浮提示，不能把它仅当作读屏属性。不要在分类导航、滚动区、预览、弹出面板或菜单等非操作容器上添加不必要的 `aria-label`。
- 需要无障碍名称的容器使用 `aria-labelledby` 引用标题或触发器；引用 ID 必须在所属 Document 中有效，新增实例 ID 避免重名。没有可见标题时可使用读屏专用文本，不能用 `aria-hidden` 隐藏需要读屏访问的容器。
- 纯装饰／预览图标可用 `aria-hidden="true"`；真实操作控件与有意义的状态提示保留名称和必要说明，不为消除悬浮提示一刀切删除无障碍标签。
- UI 变更须检查 `aria-label`、`title` 与 `setTooltip` 的提示范围及重复提示，并覆盖容器标签引用与真实控件名称回归；jsdom 标签检查不能代替 Obsidian 实机悬浮提示验收。

依据：用户确认的“外观／设置分类”区域提示；`src/features/settings/ui/settings-view.ts`、`color-picker.ts`、`ToolbarPreview.vue` 与 `src/features/finder/ui/FinderToolbar.vue`；具体规范与回归入口见 [development](docs/development.md#ui-命名与悬浮提示规范)。

## 工具与验证

- Node 和 pnpm 版本以 `.node-version`、`package.json` 为准；依赖安装／更新使用 pnpm，不混用 npm 或 Yarn。
- CodeMirror 由宿主提供；保留 Vite 的宿主 external 和 `pnpm-workspace.yaml` 的单版本约束。
- 按变更范围运行测试、类型检查及构建；构建会写入 `dist/`，只读任务不要运行产物写入命令。
- `pnpm verify` 是完整质量入口（包括浏览器 smoke）；Linux 严格视觉另用 `pnpm test:visual`。日常用 Vitest 目标套件，格式用 `pnpm format:check`，依赖用 `pnpm check:architecture`；不要自动接受截图差异。
- 真实 Vue 组件测试与 TypeScript 控制器测试不同；jsdom 不能证明实机滚动、主题、高亮绘制或移动端兼容。宿主／CodeMirror 对象不得深度响应式代理；DOM 创建使用所属 Document，不借用默认 Vue renderer 的初始化 Document。
- 报告实际执行的验证及阻塞原因；不能把未执行或加载失败写成通过。不要为消除阻塞擅自修改依赖或宿主环境。

依据：`package.json`、`vite.config.mjs`、`tools/vite-build.mjs`、`vitest.config.mjs`、`playwright.config.mjs`、`.github/workflows/ci.yml` 和 `docs/testing.md`。

## 知识维护

- 文档区分源码事实、已批准约束、合理推断和实机待验证项。批准的行为不等于代码已实现。
- 关键结论附源码符号、测试名称或提交证据；引用路径优先于容易漂移的行号。
- 行为变化更新 interactions，功能变化更新 features，样式变化更新 ui-baseline，模块／数据变化更新 architecture，支持边界变化更新 compatibility。
- pitfalls 只收录经验证且有复用价值的经验，不收录泛泛建议或一次性环境故障。
- 临时计划、任务清单、进度和本次运行统计留在 OpenCode 会话及其任务管理中，不创建项目计划文件或写进知识文档。
- 不覆盖不熟悉的用户改动；不要把 TODO、翻译键或注释中的设想当作已实现功能或批准需求。
