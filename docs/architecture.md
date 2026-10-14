# 架构与数据边界

这里描述当前模块、数据流和依赖边界。产品行为见 [features](product/features.md) 和 [interactions](product/interactions.md)。

## 模块关系

```text
TextFinderPlugin                         加载、设置、错误与持久化
├─ SettingTab                            原生 Obsidian／DOM 设置 UI、会话折叠与局部恢复
│  └─ ToolbarPreview.svelte              无笔记行为的外观预览，复用 Toolbar
│     color-picker.ts                    颜色草稿／确认壳，vanilla-colorful 提供交互
├─ HistoryController                     共享历史、同步订阅通知
├─ SettingsStorage                       独立快照、跨实例串行读写
├─ AppearanceStyles                      各 Document 的显式颜色覆盖与清理
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
| 贴边状态／临时位置 | `src/SearchBox.svelte:docked`，`src/finder-position.ts` 的 owner 局部坐标；不属于查询身份、不持久化 |
| 历史浏览、暂存输入、连续使用周期 | `src/history.ts:HistoryNavigation` 及组件的 `lastRecordedSearch`／`currentSearch` |
| 匹配上下文、查询身份、阅读／编辑定位请求代次 | `src/SearchBox.svelte` 的 `matchedContext`／`matchedQuery`／`readingRequest`／`positionRequest` 等 |
| 菜单、焦点、状态提示延迟／定位 | `src/Toolbar.svelte`、`src/SearchStatus.svelte` |
| 设置与共享历史 | `src/main.ts:settings`、`src/history.ts:HistoryController` |
| 历史选择／详情 | `src/HistoryModal.svelte:selectedTexts`／`viewingItem` |
| Finder、适配器、监听与模式观察器 | `src/editor-extension.ts:EditorSearch` 的各 Map |
| 自动入口应用过的 owner／文件、被动入口状态 | `EditorSearch.entryFiles` WeakMap 与 `SearchBox.svelte:passiveEntry`；不持久化，同文件双分屏独立 |
| 阅读索引、端点、请求、计时器及 Document 高亮所有权 | `src/reading-search.ts:ReadingSearch` 和文档级 `documents` WeakMap |

自动入口定位：`SearchBox.svelte:showFloatingEntry()` 同步设置收起可见性后，在 `tick()` 后按面板 intent／文件／Document／被动状态校验再 `refreshPlacement()`，不调用 reset／focus／匹配。移动端收起 CSS 不使用完整框居中 transform，收起定位只保留 opacity 过渡。`finder-position.ts:measure()` 在 owner 或节点无法测量时清除旧 geometry，但保留 `markerEdge`／`marker`／`manual` 意图，复用 ResizeObserver 与窗口／VisualViewport 监听在恢复可见时重新定位；没有新增计时器、持久化字段或跨视图状态。

编辑链路：输入／操作 → `setFindText()` → 原文匹配 → 校验 owner／文档／查询 → CodeMirror effect／选择／滚动。文档变化立即清旧高亮，重算后再提交新结果。依据：`src/SearchBox.svelte` 的上下文方法、`src/search-highlight.ts:textMatchMarker`。

选区范围：`src/search-scope.ts:searchScopeField` 保存锁定范围及用户选择候选，`finderSelection` Annotation 排除导航产生的选择，`searchScopeEffect` 明确设置／清除范围；范围通过 changes 映射，`searchScopeDecoration` 绘制独立装饰。`SearchBox` 管理范围 owner／窗口、代次和失效写入保护；`queryKey()` 包含范围及代次。范围不放进 `SearchOptions`、历史或持久化设置。`MatchRequest.ranges` 为纯数字快照，undefined 表示全文，空数组表示禁止匹配；Worker／同步 helper 共用范围扫描，Worker 解码及提交前都检查完整包含。自身提交后更新任务的范围查询身份，仍校验纯查询身份和范围代次，防止重入修改被误接受。

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
  defaultWholeWord: boolean; // 新建 Finder 的初始全字匹配选项
  finderDockSide: "left" | "right"; // 历史兼容字段，无设置控件；不覆盖已有值
  finderAutoDock: boolean; // 默认 false，拖动松手自动贴边
  showFloatingFinderOnOpen: boolean; // 默认 false，打开笔记时显示无焦点的小图标
  appearanceColors: Partial<Record<AppearanceColorKey, string>>; // 默认 {}，规范化 hex RGB/RGBA
}
```

`ToolbarAction` 及各栏有效动作以 `src/toolbar.ts` 为准，两个工具栏不是可任意混放动作的列表。时间戳为非负安全整数，次数为正安全整数，递增饱和在最大安全整数；文本不 trim。

- `normalizeHistory()` 逐项校验旧字符串、旧 timestamp 对象和混合记录；精确重复文本合并最早创建、最近使用、最大计数。旧记录中已经裁掉的空白无法恢复。
- `normalizeSettings()` 校验布尔／容量／排序，加载时裁剪超量历史；忽略未知字段，结果保持幂等，默认数组相互独立。属性顺序不构成数据迁移。
- `sortHistory()` 按选定字段降序，再按最近使用时间、创建时间和精确文本形成稳定顺序；`trimHistory()` 用同一顺序保留容量内记录，不修改输入数组。
- `normalizeToolbar()` 保留合法顺序、移除重复／外来动作、修复 placement、补齐缺失动作的默认配置。新增 `selection` 动作默认 `more`，旧完整默认布局迁移到新默认位置，自定义布局只在末尾补缺，不重排已有配置；只有动作布局持久化，实际范围不保存。
- 默认选项独立于工具栏布局持久化，只接受布尔值；旧数据缺失时补为 false，保持既有初始化行为。预览固定展开，无折叠／菜单状态，也不注册菜单监听。
- `wholeWord` 属于每视图 `SearchOptions`，不持久化当前手动值；仅持久化 `defaultWholeWord`。编辑 `queryKey()` 和阅读 `Request.key` 均包含它，Worker 请求复制完整选项，查找／替换／同步重试最终复用 `text-helper.ts:isWholeWordMatch()`。阅读在全文逻辑索引上判定，不以文本节点切分；切换只重算匹配而复用有效索引。`normalizeToolbar()` 将精确旧默认以及上一版末尾追加全字的默认布局迁移到新默认顺序；其他布局仍保留合法顺序／placement 并补齐缺失动作。无历史自定义标记，无法区分人为设置成精确旧默认与历史默认，两者均按默认迁移。
- `createFinderPosition()` 使用独立 CSS `translate` 保留原有 transform／top／right 和公开定位接口，只在会话中保存 owner 相对位置。观察 owner／面板尺寸、所属 Window／VisualViewport 变化；拖动监听在结束、取消、隐藏、收起、销毁时清理，安全区探针和 Observer 在销毁时释放。移动不触发查找／保存；`nya-finder-position` 事件让 More／状态提示重新定位。
- 自动贴边方向为局部会话值；历史 `finderDockSide` 保留但不再有配置控件，`finderAutoDock` 默认关闭。`finder-position.ts` 分离完整框 manual 和紧凑标记 marker／markerEdge，标记自由位置不被后台更新吸回边缘；缓存几何，pointermove 只更新最新坐标，requestAnimationFrame 合并写入 translate，pointerup 刷新最终坐标；只有布局／视口变化重新测量。无长按计时，捕获、待绘制帧、click 抑制和候选随生命周期清理；替换是否可收起由组件回调校验。`mobile-toolbar.ts` 搬移已有常驻 DOM 节点，More 不搬；`Toolbar.svelte:beforeUpdate` 数据变化前归还节点以保证 keyed 生命周期。
- 移动长按与拖动：`SearchBox.svelte:dragToMove()` 向 `createFinderPosition.start()` 传入移动端 held-click 抑制标志，控制器仅记录所属 Window 的 `performance.now()` 并在 cleanup 比较 500ms，不设长按启动计时器。`dockMenu()`／拖动入口 contextmenu 处理器在移动端阻止菜单并调用 `suppressClick()`；拖动与长按复用同一 WeakSet／700ms 过期清理，新 pointerdown 解除该目标旧 click 抑制，detail 0 键盘 click 不吞。生命周期继续释放已有 click 清理计时器／指针监听，无新增全局事件或持久化字段。
- 移动手势所有权：`createFinderPosition.start(event, mobileGesture)` 在移动端有效按下后阻止冒泡、立即尝试捕获；会话 pointermove／up／cancel 使用 owner Document 捕获阶段，cleanup 按相同 capture 参数移除，桌面仍用原冒泡路径。`SearchBox.svelte:dragToMove()` 另维护局部 touch identifier，仅入口 touchstart 安装临时 Document touchmove（capture／non-passive）及 end／cancel 保护，位置始终只由 Pointer Events 计算。两套会话分别按原事件结束／取消释放，避免 Android pointerup 先于 touchend 时漏出结束事件；隐藏／卸载／失焦／pagehide 清监听，Document 迁移清旧监听并在下次触摸重绑定。没有常驻全局触摸拦截或坐标持久化。
- `showFloatingFinderOnOpen` 只接受布尔值，旧数据补 false。常规页启用时调用 `syncFloatingEntries()`；EditorSearch 初始化及文件／活动视图／布局事件按 owner 和文件路径去重应用，关闭 leaf 删除记录。`showFloatingEntry()` 只同步可见／收起和模式，不调用聚焦或匹配；`passiveEntry` 阻止后台刷新搜索旧查询，显式输入／导航／展开再激活。入口点击通过 `activateFloatingFinder()` 共用阅读降级，而非直接绕过宿主策略。
- `SearchBox.svelte:focusInput()` 统一查询／替换输入焦点目标；小图标展开及替换命令等待 `tick()`，重新校正位置后使用 `focus({ preventScroll: true })`。捕获面板 intent、文件、模式和 Document 后校验，销毁或更新意图即失效；无计时器／帧监听需要额外释放。非收起态查询打开仍同步聚焦，绑定更新后仅补选中。替换入口不再先聚焦查询。
- 移动结果栏使用左计数／中央手柄／右 `.nya-mobile-actions` 三列，`.nya-mobile-inline` 仍为原跨容器节点迁移目标，不重建 Toolbar 按钮。结果栏及单行框基础高 40px，`FinderPlacement.toolsHeight` 移动 fallback 同步为 40，优先读取实际 offsetHeight；动作换行后整个顶部栏仍被纳入可达范围，ResizeObserver 继续观察其高度。移动面板自然高度及显式输入尺寸不修改共享桌面／预览 primitives。
- `appearanceColors` 仅接受 `focusBorder`、`accentStrip`、`matchBackground`、`matchText`、`currentMatchBackground`、`currentMatchText`。`normalizeColor()` 接受 3／4／6／8 位十六进制，展开简写并转小写、不透明 alpha 归并为 RGB；未知／非法值丢弃，旧数据缺失时补 `{}`，不产生额外样式覆盖。`src/appearance.ts` 定义键与既有公开变量映射。
- `SettingsStorage.write()` 排队前序列化快照；按 App 和数据路径共享读写队列。注册表通过 Symbol 存在共享 realm 中，插件模块重载仍复用；新实例读取排在旧实例所有已接受写入之后。失败只拒绝该操作，不阻塞后续任务。
- `read()` 用 `stat()` 区分文件不存在和权限异常，再读取并解析 JSON，不依赖可能吞异常的宿主 JSON 包装。卸载关闭旧实例入口，但已接受写入继续完成；`flush()` 可用于验证，不宣称同步卸载或宿主强制退出会等待它。
- 读取失败启用默认内存状态并禁止写入；修复后重载，临时内存修改不会与重新读取的数据合并。保存失败不回滚，下次修改尝试保存最新快照，没有自动后台重试或强制退出落盘保证。

依据：`src/history.ts`、`src/settings.ts`、`src/toolbar.ts`、`src/settings-storage.ts`、`src/main.ts`。回归：`tests/history.test.mjs`、`tests/main-settings.test.mjs`、`tests/settings-storage.test.mjs`。旧 `SaveQueue` 不再用于生产设置写入，保留其独立算法测试。

## 生命周期

`onLayoutReady()` 在插件仍有效且尚未初始化时创建 EditorSearch 并注册高亮扩展；异步设置加载后也检查卸载状态。Finder 挂到所属 `view.containerEl`。workspace 编辑、文件、活动视图、布局、主题事件驱动刷新。模式变化监听 `data-mode`；关闭 leaf 清理 Finder、适配器和监听，插件卸载调用 `destoryAll()`。

阅读资源按所属 Document 创建，`clear()`／`destroy()` 释放 Observer、计时器、端点映射和高亮所有权，并使迟到的请求回调失效。

历史 Modal 由 EditorSearch 跟踪，卸载主动关闭；`onClose()` 销毁组件并移除跟踪，组件取消历史订阅，迟到复制成功不再统计。真实宿主窗口表现仍需实测。

颜色样式不重算查询／移动当前项，只更新公开变量。主窗口、布局就绪／变化时的已有 leaf Document、`window-open` 新窗口及设置 owner Document 注册到 `AppearanceStyles`；`window-close`／`pagehide` 清对应资源，卸载清所有样式和监听，迟到布局回调不重建资源。未覆盖的颜色通过 computed color 探针显示继承值；不改写宿主 style。设置页显示名称改为“外观”，保留内部 `toolbar` 分类 ID／翻译键以免不必要的标识变化。

`src/color-picker.ts` 仅维护单项草稿、局部预览帧、确认／取消及焦点；不持有插件设置或保存队列。`SettingTab` 在应用回调才写设置与全局样式；`clearPreview()` 先销毁选择器，恢复草稿变量、取消帧，再销毁预览。库代码通过 `tools/color-picker-build.mjs`／`virtual:color-picker` 打包为 owner-window 工厂（无 eval／CDN），提供正确 realm 的 HTMLElement、Document、Window、CustomEvent，并跟踪库的拖动监听；元素断开或主动 release 清自己的 Document 监听。版本化私有 custom element 名称注册可重载复用；默认样式留在库 Shadow DOM。颜色转换及手势不自行实现。

`SettingTab.section()` 统一三个分组的折叠标题和独立恢复按钮；`collapsed` Set 默认包含三个分组，仅在本次设置访问中使用，隐藏后重置为全部折叠，不进入持久化字段。`reset()` 校验当前页面、预览存活及触发器归属，先取消调色／拖动，再直接沿用原分组保存路径并立即发统一 2 秒 Notice，不等待磁盘写入、不额外保存，不持有恢复确认 Modal；折叠不保存。非操作容器通过实例唯一标题 ID 的 `aria-labelledby` 保留读屏名称，避免宿主的 `aria-label` 自动悬浮提示；More 菜单引用所在 Toolbar 的独立触发器 ID。

`src/settings-select.ts:createSettingsSelect()` 为外观位置选择提供原生 DOM select-only combobox，独立管理当前值／临时导航、owner Document 列表与监听，不持有插件配置或保存队列。`SettingTab` 提供有效性校验及单次提交路径，统一跟踪控制器；各栏 `render()` 销毁旧控件，`clearPreview()` 在切页／隐藏／卸载时销毁全部控件。关闭列表仅移除弹层与临时监听，销毁另移除触发器事件；旧列表事件通过实例身份检查失效。菜单／调色／拖动相互关闭，不引入新配置字段或依赖。

下拉接口提供 `size?: "sm" | "md"` 和 `width?: "content" | "fill"`，默认 sm／content。所有选项在 aria-hidden 的 Grid 测量占位中叠放，使隐藏分组内也能按内容布局，不增加测量 Observer；触发器限于容器宽度。portal 每次打开读取 owner Window 的 computed 字体及局部尺寸变量、复制到列表，按触发器实测宽度并限制视口；尺寸变量仅为组件内部实现，不纳入 body 的公开 CSS／Style Settings 默认值表。

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
