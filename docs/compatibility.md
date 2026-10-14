# 兼容性与验证边界

源码能力检测、类型检查和模拟测试不等于真实宿主验收。这里记录依赖与保护策略，不虚构支持矩阵或发布通过结论。

## 版本与依赖口径

- 插件 ID、最低 Obsidian 版本和移动端声明以 `manifest.json` 为准；`isDesktopOnly: false` 是声明，不是 Android／iOS 实测证明。
- 开发 Node／pnpm、SDK 和依赖版本以 `.node-version`、`package.json`、`pnpm-lock.yaml` 为准，不在此复制版本清单。
- 阅读私有渲染器接口注释记录曾对照 Obsidian 1.14.4 的形状；这与 Manifest 最低 0.15.0、开发 SDK 版本是不同证据，不能推定所有版本支持插件阅读查找。
- esbuild 输出 CommonJS，宿主 Obsidian／CodeMirror／Electron 等为 external；pnpm overrides 保持 state/view 单版本，不能把另一套 CodeMirror 打包替换宿主实例。

依据：`src/reading-search.ts` 文件头、`manifest.json`、`package.json`、`esbuild.config.mjs`、`pnpm-workspace.yaml`。

### 依赖安全边界

- 依赖扫描命中不等于插件可利用漏洞。Svelte 的 SSR 属性展开、动态标签和 contenteditable 绑定类公告需 SSR 调用链；本插件构建为客户端 DOM 组件，无 SSR／hydrate 入口。仍应随框架使用方式变化重新检查。
- [Svelte DOM clobbering 公告](https://github.com/advisories/GHSA-rcqx-6q8c-2c42) 要求 form 属性展开与内部 input／button 的 name 同时由用户控制；当前源码没有 form，也不将查询／历史文本作为属性集合展开。不能因此宣称框架版本已修复。
- moment 来自宿主 Obsidian external；本插件调用 `moment.locale()` 读取语言，不将用户值传给 locale 加载。开发 SDK 的 moment 扫描结果不能证明实际宿主版本安全。
- braces 位于开发 lint 的 glob 调用链，不在插件运行时包中；当前 lint 模式由开发命令固定，不由笔记或查询控制。处理开发工具风险与插件运行时风险须分开，不为扫描结果盲目升级框架主版本。

依据：`package.json`／`pnpm-lock.yaml`、`esbuild.config.mjs`、`src/i18n/index.ts` 和组件模板。依赖版本或不可信输入边界变化时重新扫描并检查可达性；这不是永久豁免。

## API 边界与保护

| 依赖 | 用途 | 保护／限制 | 源码 |
| --- | --- | --- | --- |
| Obsidian Plugin／Workspace／MarkdownView／Editor／Modal／Setting | 加载、命令、视图、编辑、设置、存储、原生查找 | 按 owner 路由、检查视图仍打开；宿主行为需实测 | `src/main.ts`、`src/editor-extension.ts`、`src/settings-tab.ts`、`src/HistoryModal.ts` |
| Obsidian setTooltip／aria-label 自动悬浮提示 | 控件功能说明 | 用户反馈确认宿主会由 aria-label 产生提示；非操作容器改为 aria-labelledby 标题引用，真实操作保留提示。自动测试检查标签结构，不证明宿主提示实际位置／消失时机 | `src/settings-tab.ts:section()`、`src/color-picker.ts`、`src/Toolbar.svelte`、`tests/main-settings.test.mjs` |
| DOM combobox／listbox、owner Window 视口与焦点 | 外观页位置下拉 | body 挂载避免滚动裁切，限制视口并上翻，关闭／销毁清监听；jsdom 验证导航、提交、清理与模拟定位，不证明 Obsidian 主题绘制、触屏、读屏或默认开启的实际视觉对齐 | `src/settings-select.ts`、`src/settings-tab.ts`、`tests/settings-select.test.mjs`、`tests/main-settings.test.mjs` |
| 内部 `editor.cm` | CodeMirror 文档、事务及高亮 | 缺失时返回无编辑上下文，不向其他活动编辑器借用目标 | `src/editor-extension.ts:getEditorContext()` |
| Pointer Events／CSS translate／VisualViewport／safe-area env／ResizeObserver | Finder 临时拖动与贴边、菜单和状态避让 | owner 可见边界与视口取交集；VisualViewport 缺失回退 innerWidth／innerHeight，Observer 缺失仍处理窗口事件；销毁清监听。窗口迁移重建位置控制器，临时坐标不跨 Document 保留。jsdom 不证明软键盘动画、缩放、系统手势、拖动主题绘制或触屏不误触 | `src/finder-position.ts`、`src/SearchBox.svelte:positionFinder()`、`src/Toolbar.svelte:positionMenu()`、`src/SearchStatus.svelte:position()` |
| Pointer Capture／requestAnimationFrame | 拖动指针保持及帧合并 | 捕获缺失／失败回退 Document 监听；丢失捕获取消，结束／销毁释放捕获和待绘制帧。无 rAF 时同步更新缓存坐标。自动测试可证明无长按和合并机制，不能把“跟手”实机主观验收写成通过 | `src/finder-position.ts`、`tests/finder-position.test.mjs` |
| 私有 `previewMode.renderer` | 全部分块、渲染等待、虚拟挂载／定位 | shape 检查和运行时异常保护；缺失则不做局部 DOM 冒充全文 | `src/reading-search.ts:rendererFor()`／`supported()` |
| 内部 `Vault.getConfig("livePreview")` | 用户关闭入口恢复编辑偏好 | 缺失／非布尔／抛错返回 undefined，不切模式；模式 Promise 拒绝提示，不阻止隐藏 | `src/util/obsidian-internal.ts`、`src/SearchBox.svelte:closeFinder()` |
| 公开 DataAdapter stat／read／write | 原插件 data.json 设置与历史 | stat 不把权限失败当作不存在；直接解析及传播写入错误；共享 realm 的读写队列跨实例重载保持顺序 | `src/settings-storage.ts`、`src/main.ts` |
| CSS highlights／Highlight／Range | 阅读高亮与定位 | 能力检测，所属 Document 注册表，普通／当前优先级；运行失败清理所有权 | `src/reading-search.ts`、`src/reading-text.ts:endpointRange()` |
| MutationObserver／ResizeObserver／Pointer／Selection | 模式、正文、布局、工具栏拖动、阅读选区 | 多数操作使用 ownerDocument；不能由 jsdom 推定窗口／移动宿主表现 | `src/editor-extension.ts`、组件 actions、`src/settings-tab.ts` |
| Workspace window-open／window-close／layout-change、Document style／pagehide | 跨窗口显式颜色覆盖与清理 | 按 Document 管理，不写宿主 inline 样式；旧宿主事件缺失时依赖布局扫描／owner 注册，弹窗实际注入与级联需实测 | `src/main.ts`、`src/appearance.ts` |
| vanilla-colorful／Custom Elements／Shadow DOM／requestAnimationFrame | 颜色／色相／alpha 与局部草稿预览 | 工厂绑定 owner realm、清库的拖动监听，私有注册名可重载复用；jsdom 覆盖真实库键盘／拖动监听，但不证明实机触摸、弹窗定位或绘制性能 | `src/color-picker.ts`、`tools/color-picker-build.mjs`、`tests/color-picker.test.mjs` |
| Clipboard／crypto／moment | 历史复制、ID、日期／语言 | Clipboard 使用所属 Document，失败提示；crypto 缺失可降级；语言由 moment locale 映射，英文 fallback | `src/HistoryModal.svelte`、`src/util/common-helper.ts`、`src/i18n/index.ts` |

## 阅读范围与降级

- 插件阅读查找需要完整渲染分块及 Custom Highlight 支持。不兼容时“打开／切换查找”使用原生查找，保留用户原生偏好。
- 全字匹配使用固定的 VS Code 默认编辑器分隔符，不读取宿主或 VS Code 用户设置、不承诺中文分词或所有 Unicode 标点边界。只对既有 JS 正则结果进行边界过滤，不增加 flags／宿主 API／依赖；原生查找降级不保证继承插件全字选项。实际新增按钮布局、主题、触屏和提示需独立验收，不能由逻辑测试推定。
- 等待渲染时不发布局部数量；默认 5 秒等待超时是渲染保护，不是正则或索引执行限时。
- 定位私有接口返回失败、Highlight 异常等进入错误状态，不能报告成功导航。用户可重试或主动降级。
- 离屏节点的 CSS 祖先／兄弟依赖可能与挂载后不同；索引规则不模拟任意 CSS 可见性。伪元素、公式、图表、嵌入及第三方动态输出边界见 [features](product/features.md#阅读模式正文)。
- 首次全文 DOM 索引仍同步，大文档可能阻塞。查找、替换候选及提交后重算优先 Worker 隔离，关闭／取消可终止；同步兼容、候选传输／解码、事务及绘制仍可能阻塞，渲染等待超时不能中断这些主线程工作。
- 高亮注册表按 Document 合并视图所有权；正常关闭一个视图不清另一个视图。注册表异常清理是失败保护，不能承诺损坏宿主 API 下的完整多视图绘制。

依据：`src/editor-extension.ts:showFinder()`／`openNativeSearch()`；`src/reading-search.ts` 的 `ready()`／`run()`／`scroll()`／`removeHighlights()`。内部机制见 [architecture](architecture.md#阅读索引与高亮机制)。

## 验证能力

| 手段 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| TypeScript／Svelte check | 类型及组件诊断 | 私有 API 在实际宿主可用 |
| Node 算法／控制器测试 | 文本、模板、数据规范化、统计、保存队列 | Chromium 绘制／滚动、移动体验 |
| `source-loader.mjs` 抽取 script | 当前导出操作的模拟执行 | `$:` 响应式、bind、模板和生命周期；loader 会移除响应式标签 |
| 真实组件 jsdom 测试 | 组件绑定、响应式、DOM 事件及焦点语义 | 实际图标／翻译／宿主；历史 DOM 测试移除样式，部分布局由 mock 几何值提供 |
| 阅读 benchmark | 当前机器逻辑索引／导航开销及 Range 数量 | 固定性能门槛、实机绘制／滚动性能 |
| CI 构建与产物检查 | 配置中的锁定安装、检查、构建链路 | 某次 CI 已成功；所有目标平台兼容 |
| 可选宿主方法脚本 | 指定 ASAR 的真实 stat/read/write/queue、布局与卸载方法在内存边界中的行为 | 真实磁盘、移动适配器、完整宿主加载、GUI／滚动 |
| Node Worker 实验 | 同一 Node/V8 的原生正则结果传输、快照标签／取消、线程终止及计算／复制开销 | 浏览器 Worker、Obsidian CSP、移动 WebView、CodeMirror owner／事务安全 |
| 独立浏览器 Worker 实验页 | 在实际执行环境的 Blob Worker、传输与终止行为 | 未执行时没有兼容证据；执行通过也不证明 Obsidian 集成 |
| 独立 Obsidian Worker 探针 | 实际执行时宿主 Worker／只读 owner 文档身份／生命周期证据 | 构建或替身测试不证明真实宿主；不覆盖正文替换、撤销、阅读 DOM 或未测试平台 |
| 实际 Obsidian 验收／截图 | 记录环境中的表现 | 未测试平台和其他主题／版本 |

依据：`tests/source-loader.mjs`、`tests/search-box-dom.test.mjs`、`tests/history-dom.test.mjs`、`tests/reading-benchmark.mjs`、`.github/workflows/ci.yml`。验证命令见 [testing](testing.md)。未见真实宿主 E2E／截图自动回归或覆盖率门槛，不能将这些列为已有保障。

生产查找／替换使用 `src/match-engine.ts`／`src/match-worker.ts`，独立实验仍留在 tests，不直接导入生产。已批准启动不可用时同步兼容，执行中失败不自动重放；没有新增语法黑名单、匹配硬上限或查询执行期限。仅忽略旧结果或发取消消息不能中断正在执行的正则，应 terminate。替换事务与逆变更已有自动回归，真实宿主撤销、模式切换、窗口迁移和移动端仍须实测。

独立宿主探针已有用户提供的 Windows／API 1.14.4、Electron 39.8.3、Chrome 142 主窗口证据：368 次语义比较、7 字符／2 匹配快照、正文／查询／owner 失效和资源归零；用户确认该轮探针验证收口。该证据属于独立探针，不是新生产查找入口、弹窗／迁移或移动端的实机通过证明。

用户另确认第一阶段正式查找入口的编辑／阅读、大小写／导航、连续输入、正文／文件／关闭重开、同文件双分屏，以及当时同步替换／撤销检查成功。该反馈不替代第二阶段异步替换的实机验收，不推定未提供的平台或窗口场景通过。

## 实机证据要求

真实应用检查需记录 Obsidian／系统版本、主题／snippets、语言、窗口／缩放、重现笔记和操作。重点是长文离屏全文计数、真实滚动、高亮重挂载、分屏／弹窗／迁移、编辑撤销重做、IME／焦点及目标 Android／iOS；外观页还需验收完整预览固定、低高度／移动键盘可用空间、颜色选择器／alpha、编辑与阅读高亮及恢复 CSS 继承。

实机方法集中在 [testing](testing.md#实际应用验收)，但仓库没有据此确认的完整支持矩阵。验证场景和源码注释不是通过证据；真实报告应限定所验证环境。

还需实机证据的边界包括：社区主题和离屏 computed style、details／折叠正文具体宿主结构、Clipboard／样式注入在弹出窗口的表现、插件卸载时历史 Modal 的关闭与订阅释放、移动存储适配器及慢 I/O 重载。对应实现：`src/reading-text.ts`、`src/reading-search.ts:scroll()`、`src/HistoryModal.svelte`、`src/settings-storage.ts`、`esbuild.config.mjs`、`src/main.ts:onunload()`。
