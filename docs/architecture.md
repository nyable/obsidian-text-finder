# 架构与数据边界

这里描述当前模块、数据流和依赖边界。产品行为见 [features](product/features.md) 和 [interactions](product/interactions.md)。

## 模块关系

```text
TextFinderPlugin                         加载、设置、错误与持久化
├─ SettingTab                            原生 Obsidian／DOM 设置 UI
│  └─ ToolbarPreview.svelte              无笔记行为的外观预览，复用 Toolbar
├─ HistoryController                     共享历史、同步订阅通知
├─ SettingsStorage                       独立快照、跨实例串行读写
└─ EditorSearch                          命令、视图归属、资源生命周期
   ├─ MarkdownView → SearchBox.svelte     每视图查询会话
   │  ├─ Toolbar.svelte × 2
   │  └─ SearchStatus.svelte
   ├─ MarkdownView → ReadingSearch       阅读适配器
   └─ HistoryModal.ts                    原生 Modal 容器
      └─ HistoryModal.svelte
         ├─ HistoryList.svelte
         └─ HistoryDetail.svelte
```

依据：`src/main.ts:onload()`、`src/editor-extension.ts` 的资源 Map／`getFinder()`／`getReadingSearch()`／`openHistory()`、`src/HistoryModal.ts`、组件导入与模板。

## 状态归属与数据流

没有 `svelte/store` Store；`$:` 响应式语句、组件局部状态及框架无关控制器订阅承担状态更新。

| 状态 | 所属／证据 |
| --- | --- |
| 查询／替换／选项、可见性／折叠、匹配／索引 | `src/SearchBox.svelte` 的 `cache` |
| 历史浏览、暂存输入、连续使用周期 | `src/history.ts:HistoryNavigation` 及组件的 `lastRecordedSearch`／`currentSearch` |
| 匹配上下文、查询身份、阅读／编辑定位请求代次 | `src/SearchBox.svelte` 的 `matchedContext`／`matchedQuery`／`readingRequest`／`positionRequest` 等 |
| 菜单、焦点、状态提示延迟／定位 | `src/Toolbar.svelte`、`src/SearchStatus.svelte` |
| 设置与共享历史 | `src/main.ts:settings`、`src/history.ts:HistoryController` |
| 历史选择／详情 | `src/HistoryModal.svelte:selectedTexts`／`viewingItem` |
| Finder、适配器、监听与模式观察器 | `src/editor-extension.ts:EditorSearch` 的各 Map |
| 阅读索引、端点、请求、计时器及 Document 高亮所有权 | `src/reading-search.ts:ReadingSearch` 和文档级 `documents` WeakMap |

编辑链路：输入／操作 → `setFindText()` → 原文匹配 → 校验 owner／文档／查询 → CodeMirror effect／选择／滚动。文档变化立即清旧高亮，重算后再提交新结果。依据：`src/SearchBox.svelte` 的上下文方法、`src/search-highlight.ts:textMatchMarker`。

查找执行：`tools/match-worker-build.mjs` 将 `src/match-worker.ts` 和原始 `text-helper.ts` 打包为自包含源码字符串，嵌入 `main.js`，运行时通过 Blob URL 在所属 Window 创建 Worker；无需额外安装 Worker 文件。`MatchEngine` 每个 owner／模式独立，空闲线程复用，忙碌取代时 terminate。输入传全文／查询／选项，回包传请求 ID 和可转移 Float64 坐标，不增加 32-bit 偏移上限。真实宿主对象不传给 Worker：编辑在完成时检查具体 Editor／CodeMirror doc／文件／窗口，阅读检查请求／renderer／全文就绪／DOM index／Document，并消费待定 MutationRecords。

`MatchEngine` 初始化 ready 前不发送查询，初始化失败才自动同步降级；执行中故障不重放。没有有效查询执行超时。关闭／卸载及窗口 pagehide／beforeunload 移除监听、计时器、Worker 和 URL。阅读 DOM 索引和端点仍同步。替换复用同一通道和 helper；Worker 返回完整匹配坐标及目标 changes，主线程验证候选数量／坐标／插入类型，再校验实际不可变 doc 身份，单事务提交。单次只展开目标模板，全部才展开全部，无额外正则重验证。

编辑替换分成候选／提交／重算／定位阶段：`replaceInWorker()` 返回 `ReplaceResult | Promise<ReplaceResult>`，Promise 完成时可检查 `changed` 是否实际提交；已提交结果的 `navigationCompletion` 覆盖后续匹配及宿主定位。完成后再次校验请求代次、查询／索引、可见性及文件／编辑器／文档身份，再提交选区并决定单次替换的额外前进。自身提交触发的同步宿主通知不重入；提交后的错误只提示“替换已完成”，重试不重复写入。重建编辑器仅后台重算，过期请求不再定位；无法取消宿主内部已启动的模式切换。无 Worker 的同步兼容路径仍保留。

阅读链路：查询 → 检测私有渲染器／Highlight 能力 → 等待全文就绪 → 渲染 DOM 索引 → 精确查询匹配 → 稳定数字端点 → 挂载后临时 Range／Document 高亮注册表 → UI 回调。请求过期即拒绝发布。依据：`src/reading-text.ts`、`src/reading-search.ts`。

历史链路：操作 → 控制器同步更新设置／通知 → 组件刷新 → 异步保存快照。排序后的选择以精确文本为身份；保存不控制 UI 导航。依据：`src/history.ts:commit()`／`subscribe()`、`src/HistoryModal.svelte`。

本地化由 i18next 初始化英文／简体中文资源，以 Obsidian `moment.locale()` 将连字符映射为下划线后选择语言，英文 fallback；没有插件自身的语言切换设置。日期格式化也使用宿主 moment。依据：`src/i18n/index.ts`、`src/HistoryList.svelte`、`src/HistoryDetail.svelte`。

## 阅读索引与高亮机制

- 公共 preview API 无法枚举虚拟化移出的分块，适配器集中使用私有 `previewMode.renderer` 的 sections、渲染状态、`onRendered`、`showSection`、`applyScrollSection` 和 `updateVirtualDisplay`。能力与降级边界见 [compatibility](compatibility.md)。
- 就绪要求 renderer 文本与 lastText／当前视图数据一致、解析和渲染结束、所有分块已渲染。索引读取包含离屏节点的完整分块 DOM，排除页眉／页脚；不额外重渲染整篇 Markdown，避免重复触发第三方处理器。
- `ReadingTextIndex` 保存逻辑文本及文本 span 到节点内偏移的映射。实体已由 DOM 解码，逻辑偏移为 UTF-16，**不是 Markdown 源码偏移**；空白及边界规则见 [阅读模式正文](product/features.md#阅读模式正文)。
- 索引先检查显式排除的元素，再读取 computed style；只有 `display:none` 才检查折叠正文例外。`hidden`／`aria-hidden` 及隐藏 visibility 仍优先排除，不缓存跨索引的样式或折叠结论。
- 匹配保存文本节点和数字端点，不长期缓存可变 DOM Range。节点移出会使 Range 塌缩，重新挂载不会自动恢复；绘制只为挂载分块创建临时 Range，跨节点端点分开绘制以避开排除内容。
- 索引和精确查询结果可缓存；端点按分块分组。纯分块挂载／移出只重绘，正文及相关属性变化使索引失效，不把滚动当成全文编辑。
- 一个 MutationObserver 同时监听阅读根和离屏分块，相关属性为 `class`、`style`、`hidden`、`aria-hidden`、`open`；主题变化也失效。导航前消费待处理变更，避免异步通知尚未执行时复用旧索引。
- 高亮注册表按 Document 合并视图所有权，普通匹配优先级 0、当前项 1；正常关闭只移除对应视图。窗口迁移重建所属文档的索引／高亮。视觉接口见 [ui-baseline](product/ui-baseline.md)。

依据：`src/reading-search.ts` 的 `ready()`／`run()`／`watch()`／`paint()`／`updateRegistry()`；`src/reading-text.ts` 的索引类型／`readingMatchEndpoints()`。回归：`tests/reading-search.test.mjs` 的离屏计数、虚拟化、窗口迁移及端点测试。请求等待、导航和取消行为见 [interactions](product/interactions.md#阅读状态与错误)。

## 持久化数据格式

唯一类型定义是 `src/settings.ts:PluginSettings`；`SettingsStorage` 通过公开 DataAdapter 在原插件目录的 `data.json` 保存同一个 JSON 对象，没有独立 schema version。会话输入、匹配、可见性、菜单、历史选择集合不持久化。

```ts
interface PluginSettings {
  clearAfterHidden: boolean;
  enableInputHotkeys: boolean;
  sourceModeWhenSearch: boolean;
  moveCursorToMatch: boolean;
  useSelectionAsSearch: boolean;
  useObsidianSearchInRead: boolean;
  useEscapeCharInReplace: boolean;
  enableHistory: boolean;
  historyMaxCount: number; // integer，1–200
  historySortOrder: "createdAt" | "count" | "lastUsedAt";
  searchHistory: {
    text: string;
    createdAt: number;
    lastUsedAt: number;
    count: number;
  }[];
  searchToolbar: { id: ToolbarAction; placement: "inline" | "more" | "hidden" }[];
  replaceToolbar: { id: ToolbarAction; placement: "inline" | "more" | "hidden" }[];
  defaultRegexMode: boolean; // 新建 Finder 的初始正则选项
  defaultCaseSensitive: boolean; // 新建 Finder 的初始大小写选项
}
```

`ToolbarAction` 及各栏有效动作以 `src/toolbar.ts` 为准，两个工具栏不是可任意混放动作的列表。时间戳为非负安全整数，次数为正安全整数，递增饱和在最大安全整数；文本不 trim。

- `normalizeHistory()` 逐项校验旧字符串、旧 timestamp 对象和混合记录；精确重复文本合并最早创建、最近使用、最大计数。旧记录中已经裁掉的空白无法恢复。
- `normalizeSettings()` 校验布尔／容量／排序，加载时裁剪超量历史；忽略未知字段，结果保持幂等，默认数组相互独立。属性顺序不构成数据迁移。
- `sortHistory()` 按选定字段降序，再按最近使用时间、创建时间和精确文本形成稳定顺序；`trimHistory()` 用同一顺序保留容量内记录，不修改输入数组。
- `normalizeToolbar()` 保留合法顺序、移除重复／外来动作、修复 placement、补齐缺失动作的默认配置。
- 默认选项独立于工具栏布局持久化，只接受布尔值；旧数据缺失时补为 false，保持既有初始化行为。预览固定展开，无折叠／菜单状态，也不注册菜单监听。
- `SettingsStorage.write()` 排队前序列化快照；按 App 和数据路径共享读写队列。注册表通过 Symbol 存在共享 realm 中，插件模块重载仍复用；新实例读取排在旧实例所有已接受写入之后。失败只拒绝该操作，不阻塞后续任务。
- `read()` 用 `stat()` 区分文件不存在和权限异常，再读取并解析 JSON，不依赖可能吞异常的宿主 JSON 包装。卸载关闭旧实例入口，但已接受写入继续完成；`flush()` 可用于验证，不宣称同步卸载或宿主强制退出会等待它。
- 读取失败启用默认内存状态并禁止写入；修复后重载，临时内存修改不会与重新读取的数据合并。保存失败不回滚，下次修改尝试保存最新快照，没有自动后台重试或强制退出落盘保证。

依据：`src/history.ts`、`src/settings.ts`、`src/toolbar.ts`、`src/settings-storage.ts`、`src/main.ts`。回归：`tests/history.test.mjs`、`tests/main-settings.test.mjs`、`tests/settings-storage.test.mjs`。旧 `SaveQueue` 不再用于生产设置写入，保留其独立算法测试。

## 生命周期

`onLayoutReady()` 在插件仍有效且尚未初始化时创建 EditorSearch 并注册高亮扩展；异步设置加载后也检查卸载状态。Finder 挂到所属 `view.containerEl`。workspace 编辑、文件、活动视图、布局、主题事件驱动刷新。模式变化监听 `data-mode`；关闭 leaf 清理 Finder、适配器和监听，插件卸载调用 `destoryAll()`。

阅读资源按所属 Document 创建，`clear()`／`destroy()` 释放 Observer、计时器、端点映射和高亮所有权，并使迟到的请求回调失效。

历史 Modal 由 EditorSearch 跟踪，卸载主动关闭；`onClose()` 销毁组件并移除跟踪，组件取消历史订阅，迟到复制成功不再统计。真实宿主窗口表现仍需实测。

依据：`src/editor-extension.ts`、`src/reading-search.ts` 的 `watch()`／`clear()`／`destroy()`、`src/HistoryModal.ts:onClose()`、`src/HistoryModal.svelte:onDestroy()`。

## 依赖与耦合边界

| 分类 | 模块 | 边界 |
| --- | --- | --- |
| 框架无关业务 | `text-helper.ts`、`history.ts`、`settings.ts`、`constants.ts`、`toolbar.ts`、`save-queue.ts` | 算法／数据／通知语义不要求 Svelte |
| 框架无关但宿主耦合 | `settings-storage.ts`、`search-highlight.ts`、`editor-context.ts`、`reading-text.ts`、`reading-search.ts`、`obsidian-internal.ts`、`i18n/` | 仍需 CodeMirror、DOM、Obsidian 或私有 API |
| 设置 UI | `settings-tab.ts` | 控件使用 Obsidian Setting 与直接 DOM 操作；挂载／更新／销毁 Svelte 外观预览 |
| 混合集成 | `main.ts`、`editor-extension.ts`、`HistoryModal.ts` | 插件／命令／Modal 与 Svelte 挂载、实例方法、`$destroy()` 直接或间接关联 |
| 直接 Svelte 耦合 | `.svelte` 文件 | `$:`、bind、actions、dispatcher、tick、生命周期、动态组件、事件修饰符、scoped styles |
| 工具链耦合 | esbuild Svelte 插件、tsconfig、类型引用、组件编译测试、script 抽取测试 | 不应把现有测试加载方式误认为框架无关 |

**维护约束：**SearchBox 同时包含业务编排与展示，修改组件时必须核对操作语义和安全不变量，不能当作纯展示层。依据：`src/SearchBox.svelte` 的导出操作、`src/editor-extension.ts` 的 `Map<MarkdownView, SearchBox>` 及调用点。
