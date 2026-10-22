# 兼容性与验证边界

源码能力检测、类型检查和模拟测试不等于真实宿主验收。这里记录依赖与保护策略，不虚构支持矩阵或发布通过结论。

当前模块及适配器职责见 [architecture](architecture.md)，任务入口和检查方法见 [development](development.md)。

## 版本与依赖口径

- 插件 ID、最低 Obsidian 版本和移动端声明以 `manifest.json` 为准；`isDesktopOnly: false` 是声明，不是 Android／iOS 实测证明。
- 开发 Node／pnpm、SDK 和依赖版本以 `.node-version`、`package.json`、`pnpm-lock.yaml` 为准，不在此复制版本清单。
- 最低宿主版本为 1.6.0，与生产使用的公开 `Menu.forEvent()`（SDK 标注 since 1.6.0）对齐；`setTooltip()` 为 1.4.4，菜单分组／图标等更早。开发 SDK 版本不是最低运行版本，不因 API 类型覆盖而升级所有依赖。阅读私有渲染器接口注释记录曾对照 Obsidian 1.14.4 的形状；这与最低版本、开发 SDK 是不同证据，不能推定 1.6.0 的阅读私有形状或全部运行时能力已实测。
- Vite／Rolldown 输出 CommonJS，宿主 Obsidian／CodeMirror／Electron／Node 内建模块为 external；pnpm overrides 保持 state/view 单版本，不能把另一套 CodeMirror 打包替换宿主实例。主构建与内嵌 Worker／调色器均显式 target ES2018，不代表所有宿主运行时 API 可用。
- 依赖升级以最新稳定且满足 peer／宿主契约的组合为准：CodeMirror state/view 对齐开发 SDK 的精确 peer，TypeScript 遵守 typescript-eslint 支持范围，Node 类型跟随开发 Node 主版本。Lucide 新包 `@lucide/vue` 改变现有图标轮廓，未经独立视觉批准仍保留旧包；不能通过更新截图或放宽比较完成依赖升级。

依据：`src/platform/obsidian/preview-renderer.ts:rendererFor()` 的私有形状说明、`manifest.json`、`package.json`、`vite.config.mjs`、`tools/vite-build.mjs`、`pnpm-workspace.yaml`。

### 依赖安全边界

- 生产已移除 Svelte；旧公告的可达性分析不是 Vue 安全结论。Vue 只编译仓库模板，不将笔记、查询或历史文本作为模板／HTML 注入。`tools/vue-plugin.mjs:ownerVue()` 在正式、Vitest 和浏览器构建统一设置 `hoistStatic: false`，关闭静态 HTML 字符串化；owner renderer 只创建节点，遇到静态 HTML VNode 明确抛错，不继承 Vue 默认 HTML 解析。没有 SSR／hydrate 入口。扫描命中须检查调用链，不将“客户端”作为通用豁免。
- moment 来自宿主 Obsidian external；本插件调用 `moment.locale()` 读取语言，不将用户值传给 locale 加载。开发 SDK 的 moment 扫描结果不能证明实际宿主版本安全。
- i18next 插值不做 HTML 实体预转义；Vue／原生文本及属性写入负责安全输出，不使用 `v-html`／HTML 解析展示查询或预设名。`tests/component/i18n-text.test.mjs` 使用真实双语资源检查特殊字符及注入样本文字，不能用关闭文本输出保护换取正确显示。
- 设置写入合并仅覆盖尚未开始的连续批次，读取始终封存前批次并维持跨重载顺序；这不提供宿主磁盘崩溃原子性或跨进程同步冲突保证。
- braces 位于开发 lint 的 glob 调用链，不在插件运行时包中；当前 lint 模式由开发命令固定，不由笔记或查询控制。处理开发工具风险与插件运行时风险须分开，不为扫描结果盲目升级框架主版本。

依据：`package.json`／`pnpm-lock.yaml`、`vite.config.mjs`、`src/i18n/index.ts` 和组件模板。依赖版本或不可信输入边界变化时重新扫描并检查可达性；这不是永久豁免。

## API 边界与保护

菜单入口：公开 file-menu 的 `source`／leaf 在本机 Obsidian 1.14.4 源码中可确认 more-options 与所属视图，editor-menu 依赖公开事件（SDK 标记 since 1.1.0）。阅读右键没有对应的公开正文事件，使用公开 `Menu.forEvent()`（since 1.6.0）共享事件菜单，仍保留能力检测；缺失时不创建第二菜单或接管默认行为，异常记录告警。原生阅读选中文字查询的 `.document-search-input input` 是 DOM 形状桥接，缺失提示，不向全局活动窗口猜测控件。`tools/diagnostics/menu-host-check.mjs` 对指定 ASAR 提取真实 Menu.forEvent 验证同事件复用及一次延后显示，并静态检查 pane 来源／leaf／输入形状；不执行 GUI，不能证明触摸选词菜单、复制权限或宿主版本兼容。分屏、弹窗、链接、移动端和第三方菜单实际合并仍待实机验收。

| 依赖 | 用途 | 保护／限制 | 源码 |
| --- | --- | --- | --- |
| Obsidian Plugin／Workspace／MarkdownView／Editor／Modal／Setting | 加载、命令、视图、编辑、设置、存储、原生查找 | 按 owner 路由、检查视图仍打开；宿主行为需实测 | `src/app/create-plugin-runtime.ts`、`workspace-runtime.ts`、`settings-tab.ts`、`history-modal.ts` |
| Obsidian setTooltip／aria-label 自动悬浮提示 | 控件功能说明 | 用户反馈确认宿主会由 aria-label 产生提示；非操作容器改为 aria-labelledby 标题引用，真实操作保留提示。自动测试检查标签结构，不证明宿主提示实际位置／消失时机 | `src/features/settings/ui/settings-view.ts:section()`、`color-picker.ts`、`src/features/finder/ui/FinderToolbar.vue`、`tests/integration/main-settings.test.mjs` |
| DOM combobox／listbox、owner Window 视口与焦点 | 外观页位置下拉 | body 挂载避免滚动裁切，限制视口并上翻，关闭／销毁清监听；jsdom 验证导航、提交、清理与模拟定位，不证明 Obsidian 主题绘制、触屏、读屏或默认开启的实际视觉对齐 | `src/features/settings/ui/settings-select.ts`、`settings-view.ts`、`tests/component/settings-select.test.mjs`、`tests/integration/main-settings.test.mjs` |
| 内部 `editor.cm` | CodeMirror 文档、事务及高亮 | 缺失时返回无编辑上下文，不向其他活动编辑器借用目标 | `src/app/workspace-runtime.ts:getEditorContext()` |
| CodeMirror `EditorState.readOnly` | 替换写入资格 | 提交时检查当前 state，拒绝只读正文写入；查找／高亮／导航仍可用，不把 `EditorView.editable` 当作同义权限。不是文件系统权限或宿主额外锁定能力的替代 | `src/platform/codemirror/finder-editor.ts:commit()`、`tests/integration/finder-editor.test.ts`、`tests/component/finder-panel.test.mjs` |
| CodeMirror layer／mark DOM client rects／lineBlockAt／coordsAtPos／SVG | 搜索选区可选外轮廓、换行匹配标记 | 测量已渲染文字；同范围完整选中且可见的普通空白行依据源码及实际行坐标补轮廓连接，真实换行匹配用独立 `↵` layer。拒绝折叠／替换块、隐藏坐标与歧义 bidi 连接；不以矩形猜测写入范围。旧宿主无 layer 保留背景／文字高亮；不可用行测量不补几何。实际字体、缩放、行尾裁切、引用／列表、实时预览和移动绘制需实测；SVG／marker 不拦截输入，资源随 owner layer 清理 | `src/platform/codemirror/editor-geometry.ts`、`scope-geometry.ts`、`search-highlight.ts`、`search-scope.ts`、`tests/integration/editor-whitespace.test.mjs` |
| Pointer Events／CSS translate／VisualViewport／safe-area env／ResizeObserver | Finder 临时拖动与贴边、菜单和状态避让 | owner 可见边界与视口取交集；VisualViewport 缺失回退 innerWidth／innerHeight，Observer 缺失仍处理窗口事件；销毁清监听。窗口迁移重建位置控制器，工具栏／行对齐／状态浮层更新或测量时释放旧 Window 资源并绑定新 owner；临时坐标不跨 Document 保留。jsdom 不证明软键盘动画、缩放、系统手势、拖动主题绘制或触屏不误触 | `src/features/finder/interaction/panel-presentation.ts`、`finder-position.ts`、`mobile-toolbar.ts`、`row-alignment.ts`、`src/features/finder/ui/FinderToolbar.vue`、`SearchStatus.vue` |
| Pointer Capture／requestAnimationFrame | 拖动指针保持及帧合并 | 捕获缺失／失败回退 Document 监听；丢失捕获取消，结束／销毁释放捕获和待绘制帧。无 rAF 时同步更新缓存坐标。自动测试可证明无长按和合并机制，不能把“跟手”实机主观验收写成通过 | `src/features/finder/interaction/finder-position.ts`、`tests/unit/finder-position.test.mjs` |
| 移动宿主 Pointer／Touch 滑动手势 | 收起入口／手柄局部拖动所有权 | 移动有效按下尽早捕获并阻止冒泡，同指针移动用 Document capture；入口触摸以 identifier 限制临时 non-passive touchmove，Touch 不重复移动，down／end 不取消默认 click。捕获失败仍能先于祖先冒泡处理；不能保证拦截先注册的 Document／Window 捕获监听或原生系统边缘手势。用户报告 Android 收起图标误触文件目录／大纲及原地不动；修正有模拟宿主回归，仍待该设备实机验收 | `src/features/finder/interaction/drag-handle.ts`、`finder-position.ts:start()`、`tests/component/finder-panel.test.mjs`、`tests/unit/finder-position.test.mjs` |
| 私有 `previewMode.renderer` | 全部分块、渲染等待、虚拟挂载／定位 | shape 检查和运行时异常保护；缺失则不做局部 DOM 冒充全文 | `src/platform/obsidian/preview-renderer.ts:rendererFor()`、`src/features/reading/dom/reading-search.ts:supported()` |
| 内部 `Vault.getConfig("livePreview")` | 用户关闭入口恢复编辑偏好 | 缺失／非布尔／抛错返回 undefined，不切模式；模式 Promise 拒绝提示，不阻止隐藏 | `src/platform/obsidian/live-preview.ts`、`src/features/finder/application/finder-session.ts:closeFinder()` |
| 公开 DataAdapter stat／read／write | 原插件 data.json 设置与历史 | stat 不把权限失败当作不存在；直接解析及传播写入错误；共享 realm 的读写队列跨实例重载保持顺序 | `src/platform/obsidian/settings-storage.ts`、`src/app/create-plugin-runtime.ts` |
| CSS highlights／Highlight／Range | 阅读高亮与定位 | 能力检测，所属 Document 注册表，普通／当前优先级；运行失败清理所有权 | `src/features/reading/dom/reading-search.ts`、`reading-text.ts:endpointRange()` |
| MutationObserver／ResizeObserver／Pointer／Selection | 模式、正文、布局、工具栏拖动、阅读选区 | 多数操作使用 ownerDocument；不能由 jsdom 推定窗口／移动宿主表现 | `src/app/workspace-runtime.ts`、组件 actions、`src/features/settings/ui/settings-view.ts` |
| Workspace window-open／window-close／layout-change、Document style／pagehide | 跨窗口显式颜色覆盖与清理 | 按 Document 管理，不写宿主 inline 样式；旧宿主事件缺失时依赖布局扫描／owner 注册，弹窗实际注入与级联需实测 | `src/app/create-plugin-runtime.ts`、`src/features/settings/ui/appearance-styles.ts` |
| Workspace iterateAllLeaves／file-open／active-leaf-change／layout-change | 打开笔记的默认悬浮入口 | 初始化及事件扫描 Markdown owner／文件，按视图去重，不以全局编辑器替代 owner；布局未就绪或无文件不创建。自动入口不启动阅读能力探测或匹配，点击／显式查找后统一使用插件并执行不支持降级。真实宿主事件顺序、后台标签挂载和软键盘待实测 | `src/app/workspace-runtime.ts:syncFloatingEntries()`／`activateFloatingFinder()`、`src/features/finder/application/finder-session.ts:showFloatingEntry()` |
| vanilla-colorful／Custom Elements／Shadow DOM／requestAnimationFrame | 颜色／色相／alpha 与局部草稿预览 | 工厂绑定 owner realm、清库的拖动监听，私有注册名可重载复用；jsdom 覆盖真实库键盘／拖动监听，但不证明实机触摸、弹窗定位或绘制性能 | `src/features/settings/ui/color-picker.ts`、`tools/color-picker-build.mjs`、`tests/component/color-picker.test.mjs` |
| Clipboard／crypto／moment | 历史复制、ID、日期／语言 | Clipboard 使用所属 Document，失败提示；crypto 缺失可降级；语言由 moment locale 映射，英文 fallback | `src/features/history/ui/HistoryPanel.vue`、`src/shared/lifecycle/unique-id.ts`、`src/i18n/index.ts` |

## 阅读范围与降级

- 插件阅读查找需要完整渲染分块及 Custom Highlight 支持。正常“打开／切换查找”、菜单及悬浮入口统一使用插件；旧原生偏好设置已移除并迁移清理，不再影响路由。不兼容时仍提示并使用原生查找；运行失败的手动原生入口保留，显式范围命令仍禁止降级为全文。
- 全字匹配使用固定的 VS Code 默认编辑器分隔符，不读取宿主或 VS Code 用户设置、不承诺中文分词或所有 Unicode 标点边界。只对既有 JS 正则结果进行边界过滤，不增加 flags／宿主 API／依赖；原生查找降级不保证继承插件全字选项。实际新增按钮布局、主题、触屏和提示需独立验收，不能由逻辑测试推定。
- 等待渲染时不发布局部数量；默认 5 秒等待超时是渲染保护，不是正则或索引执行限时。
- 定位私有接口返回失败、Highlight 异常等进入错误状态，不能报告成功导航。用户可重试或主动降级。
- 离屏节点的 CSS 祖先／兄弟依赖可能与挂载后不同；索引规则不模拟任意 CSS 可见性。伪元素、公式、图表、嵌入及第三方动态输出边界见 [features](product/features.md#阅读模式正文)。
- 首次全文 DOM 索引仍同步，大文档可能阻塞。查找、替换候选及提交后重算优先 Worker 隔离，关闭／取消可终止；同步兼容、候选传输／解码、事务及绘制仍可能阻塞，渲染等待超时不能中断这些主线程工作。
- 编辑选区用源码坐标及 CodeMirror StateField／事务；阅读选区独立反向映射 DOM 正文逻辑偏移，不与源码互转。阅读完整索引／renderer 就绪才确认范围，浏览器实际提供的多个 Range 才能多选；元素端点和折叠空白按明确内收规则，排除内容端点拒绝。节点替换／源快照／owner 身份变化失效，不借用其他视图或凭同文猜测恢复。Worker 仍传完整正文，小选区不保证仅按范围长度耗时。自动回归不证明首次命令面板选区、移动选词、真实虚拟分块及覆盖层通过。
- 阅读轮廓／换行覆盖层依赖 owner DOM Range 几何及 fixed portal，缺测量时不猜坐标；ResizeObserver／字体事件可选，窗口 resize／scroll 仍请求重绘。连续 `<br>`／pre 空行仅在测得同列小间距连接，段落／表格／嵌入空隙保守分离。社区主题的裁切、层叠、transform、图片加载、RTL 和弹出窗口实际绘制需实测；CSS Highlight 保留原能力检测与原生全文降级，但显式范围命令不静默原生全文。
- 高亮注册表按 Document 合并视图所有权；正常关闭一个视图不清另一个视图。注册表异常清理是失败保护，不能承诺损坏宿主 API 下的完整多视图绘制。

依据：`src/app/workspace-runtime.ts:showFinder()`／`openNativeSearch()`；`src/features/reading/dom/reading-search.ts` 的 `ready()`／`run()`／`scroll()`／`removeHighlights()`。内部机制见 [architecture](architecture.md#阅读索引与高亮机制)。

## 发布检查中的设计例外

- DOM 创建保留原生 `ownerDocument.createElement()`／`createElementNS()`，不机械替换为全局宿主 helpers，也不为隐藏告警套无实际职责的包装。renderer 必须在每次创建时读取当前 owner Document，保留命名空间及原生参数；owner／adopt 回归不等于 Obsidian 弹窗实测。
- `match-worker.ts` 的 `globalThis` 是 Worker 全局，没有 Window；`settings-storage.ts` 的共享 realm 队列不能随 `activeWindow` 拆分；`unique-id.ts` 的 UUID 是非 DOM 数据能力。三者不是操作错误窗口的证据。Worker 启动计时器则明确由捕获的 owner Window 创建和清理。
- `composition-input.ts` 的 `keyCode === 229` 与 `isComposing`／composition 事件共同保护 IME，保留 legacy 229 回归；弃用提示不能替代目标输入法兼容证据。
- 匹配异常保留 `console.debug`，只输出固定消息及错误类型，不输出查询、正文或可能带查询的正则错误消息。Worker／宿主异常仍保留必要告警，不统一禁用诊断。
- 设置页统一使用 `display()` 的五分类布局，最低版本仍为 1.6.0；1.13+ 未提供非空声明式定义时仍使用此公开兼容路径。按用户批准放弃逐项全局设置搜索，不覆盖 `getSettingDefinitions()`，不引入宿主私有索引 API 或新版专用布局。控件继续走 SettingsController，不采用宿主默认 saveData；hide 和 owner Window 的 pagehide 释放外观资源。SDK 已将 display 标记 deprecated，这是明确接受的兼容依赖；未来宿主若移除此路径需重新评估，实际主题布局与移动端仍须实机验收。

依据：上述源码、`tests/integration/owner-renderer.test.ts`、`match-engine.test.mjs`、`settings-storage.test.mjs`、`tests/component/finder-panel.test.mjs` 和 `tests/unit/text-matching.test.mjs`。这是逐项设计依据，不代表发布服务自动豁免；仓库 ESLint 已启用方法绑定和枚举比较规则，但未安装／运行完整 Obsidian 发布扫描器。

## 验证能力

| 手段 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| TypeScript／Vue check | 类型及组件诊断 | 私有 API 在实际宿主可用 |
| Node 算法／控制器测试 | 文本、模板、数据规范化、统计、保存队列 | Chromium 绘制／滚动、移动体验 |
| Vitest 直接导入 TypeScript | 真实应用用例及端口的模拟执行，过期任务与错误边界 | 真实宿主生命周期／私有 API |
| Playwright Test 与固定 Linux 截图 | Chromium Blob Worker、IME、跨 realm／adopt、固定模拟主题的像素回归 | Obsidian GUI、社区主题、Android／iOS |
| 真实 Vue 组件 jsdom 测试 | 官方 Vue／Vite 编译的组件、图标、scoped CSS、事件和焦点 | 翻译／宿主可为替身，布局可用 mock 几何；不证明真实绘制 |
| 阅读 benchmark | 当前机器逻辑索引／导航开销及 Range 数量 | 固定性能门槛、实机绘制／滚动性能 |
| CI 构建与产物检查 | 配置中的锁定安装、检查、构建链路 | 某次 CI 已成功；所有目标平台兼容 |
| 可选宿主方法脚本 | 指定 ASAR 的真实 stat/read/write/queue、布局与卸载方法在内存边界中的行为 | 真实磁盘、移动适配器、完整宿主加载、GUI／滚动 |
| Node Worker 实验 | 同一 Node/V8 的原生正则结果传输、快照标签／取消、线程终止及计算／复制开销 | 浏览器 Worker、Obsidian CSP、移动 WebView、CodeMirror owner／事务安全 |
| 独立浏览器 Worker 实验页 | 在实际执行环境的 Blob Worker、传输与终止行为 | 未执行时没有兼容证据；执行通过也不证明 Obsidian 集成 |
| 独立 Obsidian Worker 探针 | 实际执行时宿主 Worker／只读 owner 文档身份／生命周期证据 | 构建或替身测试不证明真实宿主；不覆盖正文替换、撤销、阅读 DOM 或未测试平台 |
| 实际 Obsidian 验收／截图 | 记录环境中的表现 | 未测试平台和其他主题／版本 |

依据：`vitest.config.mjs`、`tests/component/finder-panel.test.mjs`、`tests/component/history-panel.test.mjs`、`tests/browser/finder.spec.mjs`、`.github/workflows/ci.yml`。验证命令见 [testing](testing.md)。已有模拟主题的严格 Chromium 截图回归，但没有真实宿主 E2E 或覆盖率门槛，不能将它们列为已有保障。

生产查找／替换使用 `src/platform/browser/match-engine.ts`／`match-worker.ts`，独立实验不直接导入生产。已批准启动不可用时同步兼容，执行中失败不自动重放；没有新增语法黑名单、匹配硬上限或查询执行期限。仅忽略旧结果或发取消消息不能中断正在执行的正则，应 terminate。替换事务与逆变更已有自动回归，真实宿主撤销、模式切换、窗口迁移和移动端仍须实测。

独立宿主探针已有用户提供的 Windows／API 1.14.4、Electron 39.8.3、Chrome 142 主窗口证据：368 次语义比较、7 字符／2 匹配快照、正文／查询／owner 失效和资源归零；用户确认该轮探针验证收口。该证据属于独立探针，不是新生产查找入口、弹窗／迁移或移动端的实机通过证明。

用户另确认第一阶段正式查找入口的编辑／阅读、大小写／导航、连续输入、正文／文件／关闭重开、同文件双分屏，以及当时同步替换／撤销检查成功。该反馈不替代第二阶段异步替换的实机验收，不推定未提供的平台或窗口场景通过。

`tests/browser/harness.mjs` 在 Chromium 检查生产 Finder 的 Worker 查找／替换、IME、iframe owner 构造器身份、live adopt 后新节点归属及卸载，并采集固定模拟主题截图。`src/shared/ui/mount-view.ts` 使用 owner-bound renderer，而非默认初始化 Document。iframe／adopt／模拟截图不是 Obsidian 弹窗或移动支持证据。用户此前的简单功能正常反馈，不等于本次重构产物已实机验收。

## 实机证据要求

真实应用检查需记录 Obsidian／系统版本、主题／snippets、语言、窗口／缩放、重现笔记和操作。重点是长文离屏全文计数、真实滚动、高亮重挂载、分屏／弹窗／迁移、编辑撤销重做、IME／焦点及目标 Android／iOS；外观页还需验收完整预览固定、低高度／移动键盘可用空间、颜色选择器／alpha、编辑与阅读高亮及恢复 CSS 继承。

实机方法集中在 [testing](testing.md#实际应用验收)，但仓库没有据此确认的完整支持矩阵。验证场景和源码注释不是通过证据；真实报告应限定所验证环境。

还需实机证据的边界包括：社区主题和离屏 computed style、details／折叠正文具体宿主结构、Clipboard／样式注入在弹出窗口的表现、插件卸载时历史 Modal 的关闭与订阅释放、移动存储适配器及慢 I/O 重载。对应实现：`src/features/reading/dom/reading-text.ts`、`reading-search.ts:scroll()`、`src/features/history/ui/HistoryPanel.vue`、`src/platform/obsidian/settings-storage.ts`、`vite.config.mjs`、`src/app/create-plugin-runtime.ts:onunload()`。
