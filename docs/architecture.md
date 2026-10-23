# 架构与数据边界

这里描述当前源码事实；产品行为见 [features](product/features.md) 和 [interactions](product/interactions.md)，视觉接口见 [ui-baseline](product/ui-baseline.md)。检查命令及宿主验收边界见 [testing](testing.md)。

## 模块关系

项目是模块化单体，没有全局 UI store、DI 容器或事件总线。

```text
main.ts → app/create-plugin-runtime.ts    Obsidian 插件默认导出与装配
 ├─ SettingsStorage                     原目录 data.json、跨重载读写队列
 ├─ HistoryController                   精确文本历史、同步通知／异步保存
 ├─ AppearanceStyles                    每 Document 的显式 CSS 覆盖
 ├─ SettingTab → SettingsView 统一五分类、设置控件与 Vue 预览
 │               └─ SettingsController 类型化设置更新与通知策略
 └─ EditorSearch                        workspace 事件、owner 资源及视图工厂
     ├─ registerWorkspaceCommands       命令可用性及 owner 路由
     ├─ OwnerRegistry<MarkdownView>     Finder／阅读／Worker／选区／监听／菜单
     ├─ createFinderHost／EditorPort    owner-bound 能力与不透明身份
     │   └─ mountFinder → FinderPanel → useFinderViewModel
     │       ├─ createFinderSession     查询／范围／导航／替换编排
     │       ├─ QueryLane               异步查询意图、取消及旧结果隔离
     │       ├─ runReplacement          prepare → 单次 commit → rematch
     │       └─ panel-presentation      DOM／焦点／IME／拖动／布局
     ├─ ReadingSearch                   完整渲染正文索引、导航、高亮与范围
     └─ HistoryModal → HistoryPanel     HistoryView 能力，不传插件实例
```

### 目录和依赖

- `src/core/search/`：纯匹配、范围、替换模板、业务类型和 Worker 协议。无 DOM／Vue／宿主依赖。
- `src/features/finder/`：`model` 保存工具栏与查询身份，`application` 定义 ports 和用例，`interaction` 管 DOM 效果，`ui` 连接 Vue。
- `src/features/reading/dom/`：明确依赖 DOM 的正文索引、数字端点、选区跟踪、覆盖层和阅读协调器；不伪装成纯领域算法。
- `src/features/history/`：纯历史模型／控制器、窄 HistoryView 契约和列表／详情组件。
- `src/features/presets/`：可移植 SearchRecipe／独立 ID 的 SearchPreset、规范化、PresetController 及草稿表单；经公共入口向 Finder 提供配置，功能层不获取宿主对象。
- `src/features/settings/`：持久化 DTO、规范化、更新策略及控件／草稿／预览。设置 DTO 引用历史和工具栏公共模型，反向功能不导入设置服务。
- `src/platform/`：Obsidian 私有能力检测／存储／日期、CodeMirror 文档与事务／高亮、浏览器 Worker 传输。
- `src/app/`：连接具体宿主和功能，唯一允许同时知道插件、owner、适配器和视图工厂的装配层。
- `src/shared/`：资源释放、跨功能纯几何、owner renderer／DOM action／TextRun；不依赖具体业务。
- `src/i18n/`：资源、键类型及语言初始化；宿主 locale 由装配层读取。
- `src/styles/`：公开变量、高亮与共享视觉 primitives；组件局部样式随 SFC 编译。

`.dependency-cruiser.cjs` 检查包括类型依赖的循环、core／shared 纯度、app 反向引用、model／application 宿主导入、跨功能私有路径和 platform 挂载 UI。功能间只经 `index.ts`／`ui.ts` 等显式入口协作，不使用全仓库 export-star。反例回归：`tests/integration/architecture-boundaries.test.mjs`。TypeScript／Vite／Vitest 共用 `@/` 别名，模块内部可用短相对路径。

## 状态归属与 Finder 数据流

每次 `createFinderSession()` 创建独立的、完整类型初始化的 `FinderState`。Vue 通过 `useFinderViewModel()` 注入浅响应式、nextTick 和生命周期；cache／options 分别浅响应式，大匹配数组不深度代理。应用层不导入 Vue、Obsidian、CodeMirror 或 DOM 类型。

| 状态／资源 | 所属 |
| --- | --- |
| 查询、替换、选项、可见／折叠、当前项、结果、历史浏览周期 | Finder 会话及 `HistoryNavigation` |
| 待执行查询和累积导航方向、接受的 promise、matcher 能力 | `QueryLane`，不放进 Vue state |
| 范围身份、代次、失效保护 | `application/search-scope.ts`；数字范围由 EditorPort 或 ReadingPort 提供 |
| 替换阶段与提交后重算／定位结果 | `replacement-operation.ts` 和会话，提交后失败不得重放；EditorPort.commitResult 返回写入、完整性、可确认数量及可选只读拒绝类别，部分过滤／改写数量为 null |
| DOM refs、IME、面板焦点／菜单／手势、尺寸／位置 | `useFinderViewModel`、`panel-presentation` 及 interaction 控制器 |
| 原始 MarkdownView／Editor／CodeMirror doc／文件对象 | app 和 `platform/codemirror/finder-editor.ts`；通过稳定 token 和 DocumentSnapshot 提供身份 |
| 设置、共享历史及保存可读性封锁 | 插件装配、SettingsController、HistoryController、SettingsStorage |
| 历史选择／详情、迟到复制意图 | `HistoryPanel.vue`，精确文本 keyed identity |
| 阅读索引／端点／等待／绘制和 Document 高亮所有权 | `ReadingSearch`、`reading-text.ts`、`reading-overlay.ts` |

宿主只持有 `FinderCommands` 和挂载生命周期，不获取 session.state／内部事件／原始编辑器。`finderCommands()` 显式挑选命令，`FinderPanel.vue` 只暴露该对象。真实组件、纯端口及渲染边界分别有回归，不因默认 Vue mount 成功就推定跨窗口安全。

### 查询与导航

输入 → `setFindText()` → 编辑／阅读路由 → 捕获查询、范围与 owner 身份 → 计算 → 校验当前身份 → 发布结果／导航。编辑发布绑定不可变 doc，正文变化先清旧高亮。`QueryLane` 使用 idle／pending 可辨识状态；同查询追加导航意图，收起面板只暂停定位，过期 promise 不发布。文件、编辑器、文档、模式、Window token、查询和范围代次分别校验，不合并成一个全局序号。

`scrollToMatch()` 保留同步和异步宿主定位时序；模式切换可能重建编辑器，完成后须重新校验，包括捕获的环境 token 未变及 `environmentClosed()` 为 false，不依赖 layout 事件及时使旧请求失效。过期请求不得提交 selection。无匹配不滚动。保存历史不是导航的一部分，不等待磁盘。回归：`tests/integration/finder-session.test.ts` 的 `rejects late navigation after owner window`。

`showFloatingEntry()` 只显示被动收起入口，不聚焦、不匹配旧查询。布局提交后的修正再次校验 panel intent、文件和 Document；手动位置不重置。展开命令与点击使用不同的原有焦点策略，关闭契约见 interactions，不从内部方法名推导产品行为。

`createFinderPosition()` 将几何采样 `measureGeometry()` 与布局约束／绘制 `measure()` 分开；拖动按下只读当前几何，未达阈值的松开／取消不写位置或宽度，真实布局事件仍更新约束且不覆盖手动位置意图。桌面／移动均仅过渡 opacity，避免将动画中基础坐标计入独立 translate；鼠标按下不主动聚焦，键盘焦点仍由原控件和 presentation 管理。回归：`tests/unit/finder-position.test.mjs`、`tests/browser/drag.spec.mjs`。

`createSearchScope()` 独立记录 source／preview 模式；`syncMode()` 在 owner 刷新、范围同步及激活时检测双向切换，取消旧任务／定位、推进范围代次并清除限制。模式变更不把旧范围转成另一套坐标，也不重新捕获当前选区；同模式身份失效仍使用 `clear(true)` 保持 [] 保护。`matchAgain()` 在后台任务保留判断前同步模式，避免旧候选经快速往返复活。回归：`tests/unit/search-scope.test.ts`、真实 Finder 的 mode switches／pending scoped replacement 测试。

### 替换安全

同步兼容路径和 Worker 路径都从本次原文快照准备候选，不能复用隐藏面板的旧坐标。全文正则上下文及模板展开在 `core/search/text-matching.ts`，单次只展开目标模板，全部才展开全部；没有二次正则切片验证或递归替换模板。

`runReplacement()` 是同步兼容与 Worker 共用的 prepare → 单次 commit → rematch 用例；会话提供 owner／查询有效性和导航效果，不维护另一条同步写入实现。提交前校验文件／Editor／EditorView／doc、模式、窗口、查询／替换输入及范围代次；`EditorPort.commit()` 在 CodeMirror 边界再次校验原始身份并一次 dispatch。自身提交期间的同步宿主通知不得重入取消或重放。

`ReplaceResult.changed` 表示实际提交，`navigationCompletion` 表示完整提交后重算及定位完成；定位失败提示“已替换但定位失败”，宿主部分过滤／改写则明确提示检查正文，均不能再提供重放写入的重试。额外前进只在成功、同数量、请求／身份仍有效时发生。取消提交前任务不写入；提交后取消不回滚正文。回归：`replacement-operation.test.ts`、`finder-editor.test.ts`、`finder-session.test.ts`、真实 `finder-panel.test.mjs`。

dispatch 正常返回不等于完整替换：适配器从原始 State 解析一次宿主过滤器，对比实际与请求的 ChangeSet，再提交同一 Transaction，避免过滤器二次执行；过滤后再次校验 owner 身份。`runReplacement()` 读取 `EditorPort.commitResult()`，要求已接受文档事务、变化集合及最终文本均符合预期。完全拒绝返回 changed=false／changeCount=0；部分过滤／改写返回失败、changed=true／changeCount=null，不执行重算定位或额外前进，也不提供重放。即使最终文本相同也须核对实际变化，不能把同值部分接受视为全部成功。真实 CodeMirror 过滤器、纯端口、Finder 组件及浏览器 Worker 回归分别覆盖该边界。

只读拒绝由适配器以 `ReplacementCommitResult.rejection: "readOnly"` 明确传递，不解析错误文本。`commitFailed()` 清除替换重试；未写入时会话区分 readOnly／rejected，状态提示不提供 Worker／同步重试。后续新查询或主动替换清除旧拒绝状态，不改变准备阶段的 Worker 失败恢复语义。

### Worker

`tools/vite-build.mjs:embeddedSources()` 将 `platform/browser/match-worker.ts` 和相同纯算法打包成字符串，内嵌 main.js。每 owner／模式的 `MatchEngine` 使用 owner Window 的 Blob Worker；空闲复用，忙碌取代 terminate。ready 前不提交查询；仅启动不可用自动同步兼容，执行失败不自动重放。没有新增语法黑名单、查询执行期限或匹配硬上限。

协议只传纯文本、选项、数字范围及请求 ID，结果用 Float64 可转移坐标；不传宿主对象或施加 32-bit 坐标上限。范围 undefined 是全文，[] 是禁止匹配；解码及提交前都验证候选完整包含。关闭／迁移／pagehide／卸载释放 Worker、Blob URL、监听及启动计时器。阅读 DOM 索引、事务和绘制仍在主线程，不能宣称所有工作均可取消。

## 阅读索引与高亮机制

`platform/obsidian/preview-renderer.ts:rendererFor()` 集中检测私有 renderer 形状，包含全部 sections、全文／渲染状态及挂载／定位能力。公开 preview API 无法列出虚拟移出的分块；能力缺失不能用局部视口冒充全文。正常打开不兼容时走既有原生降级，显式范围命令不静默扩大为原生全文。

同模块的 `capturePreviewBody()` 为菜单捕获较窄的正文／render stamp，不要求全文搜索能力；`event-menu.ts` 检测公开事件菜单能力，`editor-context.ts` 隔离内部 CodeMirror 实例探测。缺失／异常能力及过期快照由 `host-bridges.test.ts` 和 `finder-menus.test.mjs` 覆盖。

- `ReadingSearch.ready()` 要求当前源数据、text／lastText 一致，解析／渲染结束且所有块就绪。等待有界检查和 onRendered 回调，默认 5 秒是渲染保护，不是正则执行期限。
- `reading-text.ts` 建完整 DOM 逻辑字符串、span／元素边界和 breaks。偏移是 UTF-16 正文偏移，不是 Markdown 源码偏移。先排除明确子树再读取样式，仅 display:none 检查折叠正文例外；正文规则以 features 为准。
- 不长期持有 DOM Range：保存节点和数字端点，仅挂载后创建 Range。虚拟同节点移出／挂回只重绘；节点替换、源／renderer／Document 变化令索引或范围失效。
- 查询／选项可复用有效索引；MutationObserver 观察正文及离屏分块的相关文本／属性，导航前消费待处理 records；主题变化显式失效。
- 同步重试是 `ReadingPort.search()` 的本次请求参数，等待渲染时仅同查询／选项／范围、文件、源版本、renderer 和 Document 的后台刷新可保留；清理／超时或替换请求不继承，执行前消费一次。回归见 `reading-search.test.mjs` 的 synchronous reading retry 系列。
- 阅读选区 tracker 在 Finder 懒创建前捕获候选；确认范围需要就绪全文，映射折叠空白向内收紧，排除端点拒绝。同模式失效范围保持 [] 限制，不自动恢复全文；显式编辑／阅读切换由 Finder 会话结束旧范围限制。
- 高亮注册表按 Document 合并视图所有权，范围／普通／当前项有独立优先级。关闭一个 owner 不清其他视图。`reading-overlay.ts` 在 owner body 创建非交互 portal，不污染正文索引；scroll／resize／字体／外观变更合并 owner rAF，销毁取消帧和监听。
- 换行 breaks 区分 hard／text／block／barrier，保留既有正文字符串，保护边界／末尾合成字符不成为独立可导航换行。几何缺失不猜测坐标，段落／表格间未知空隙不强连。
- 阅读轮廓按 Text Range 包围盒递归排除离屏片段，再测量候选片段及邻接余量内的完整矩形／换行，不假定字符偏移的视觉顺序。CSS 裁切不代替几何筛选。`paddedScopeOutlines()` 按纵向邻近矩形扫描间距，不再让长文每行和全文两两比较；全文索引、匹配数量及数字范围不截断。初始 Range 包围盒仍可能读取整个挂载文本块，不能宣称所有主线程工作均与视口大小无关。`tests/browser/reading.spec.mjs` 覆盖大型挂载代码块的测量次数与路径工作量，`scope-outline.test.mjs` 对照原间距算法。

回归：`tests/integration/reading-search.test.mjs`、`reading-scope.test.mjs`、`reading-commands.test.mjs` 和 `tests/unit/reading-index.test.mjs`。宿主实际滚动、虚拟化及绘制仍待实测。

## 持久化数据格式

唯一 DTO 定义为 `features/settings/model/settings.ts:PluginSettings`。原插件目录 `data.json` 保存同一个 JSON 对象，无新增 schema version。会话查询、匹配、可见性、位置、实际范围、菜单、历史选择集合均不持久化。

字段保持：

- 布尔偏好：`clearAfterHidden`、`enableInputHotkeys`、`sourceModeWhenSearch`、`moveCursorToMatch`、`useSelectionAsSearch`、`useEscapeCharInReplace`、`enableHistory`、`defaultRegexMode`、`defaultCaseSensitive`、`defaultWholeWord`、`finderAutoDock`、`showFloatingFinderOnOpen`。
- `historyMaxCount`：1–200 的整数；`historySortOrder`：createdAt／count／lastUsedAt。
- `historyRetention`：同三种优先级，但仅控制容量裁剪，独立于显示顺序；新安装 lastUsedAt，旧对象缺失时继承合法原 historySortOrder。创建时间策略保留为兼容选项。
- `searchHistory`：`{text, createdAt, lastUsedAt, count}[]`。精确文本身份、不 trim；时间戳为非负安全整数，次数为正安全整数并饱和递增。
- `searchPresets`：`{id, name, search, options:{regexMode,caseSensitive,wholeWord}, replacement:null|{text,interpretEscapes}, collapse, order, createdAt, updatedAt}[]`。独立 ID、不按查询去重；名称去首尾空白，规则／替换原文不 trim。`interpretEscapes` 仅为旧存储格式兼容保留，编辑保留旧值，应用不读取；实际替换统一读取全局 `useEscapeCharInReplace`，Finder 捕获时仍填入当前全局值以维持格式。`collapse` 独立表示替换行是否收起，不删除保存的替换值；旧对象缺失时按 replacement 是否为空推导。`order` 为持久化非负整数顺序，规范化连续编号；旧数据无顺序时以原名称排序迁移，之后列表不再按名称重排。时间戳 0 有效，坏条目与重复 ID 过滤；归一化只保留配置字段，不保存宿主坐标或对象。

预设 UI 的 FinderRecipeFrame 仅共享 Finder 的表现原语／静态 FinderToolbar，固定展示保存的三个匹配选项，不接收全局 searchToolbar／replaceToolbar 布局；不挂载实时 Finder／匹配引擎，不提供文档操作。摘要将首行展示／实际行数与精确原文分开，读屏和应用保留全文，展示截断不写回模型。PresetList 拖动状态及 pointer／键盘／自动滚动仅在 UI 生命周期内，松手才发基于 ID 的 move 到 PresetController；取消不落盘，模型按最新集合解析边界。编辑与重命名保位，新建追加，删除快照的 order 只用于显式撤销时恢复近似原位置，不覆盖同 ID 新对象。
- `searchToolbar`／`replaceToolbar`：`{id: ToolbarAction, placement: inline|more|hidden}[]`；有效动作由 Finder 纯工具栏模型拥有。
- `finderDockSide`：left／right，历史兼容字段，无设置控件，不覆盖合法值。
- `appearanceColors`：八个已知键的可选规范化 hex RGB／RGBA；默认 {}，不写覆盖样式。
- `scopeAppearance`：`{border:boolean, width:1|2|3}`，默认 false／1；关闭保留颜色／粗细。

`normalizeHistory()` 校验旧字符串／timestamp 对象及混合项，重复精确文本合并最早创建、最近使用和最大计数。`normalizeSettings()` 校验、裁剪并保持幂等及独立默认数组；忽略未知字段，退役的 useObsidianSearchInRead 删除后沿既有 changed 路径保存。工具栏仅对精确历史默认布局迁移，自定义合法顺序／placement 保留，新动作补默认值。

`SettingsController` 是设置 UI 更新入口：同步修改／通知后请求保存，不暴露可写设置给 SettingsView。分组恢复只影响该组；颜色草稿仅在局部预览，应用才更新。HistoryController／PresetController 同步更新与订阅通知，异步保存不阻塞导航；复制不再统计使用。预设名称通过纯模型 `presetNameTaken()` 按 trim 后区分大小写比较，UI 提前提示、控制器 put／restore 在提交前按最新集合阻止重名；更新排除自身 ID，归一化保留旧的不同 ID 同名配置，不引入数据迁移丢失。HistoryPanel 管理筛选／详情／编辑／撤销状态，不持久化；PresetEditor 使用独立浅响应式草稿，另存命名步骤保留原配置草稿，明确创建才提交新 ID。Finder 的 captureRecipe 返回复制快照，applyRecipe 原子装载配置、保留范围并匹配；预设只填充搜索栏，不建立会话内替换转义覆盖，也不改共享设置。

`platform/obsidian/settings-storage.ts` 通过公开 stat／read／write 区分不存在、权限、损坏 JSON 和写入错误。按 App／路径的队列通过共享 realm Symbol 跨模块重载复用；调用时序列化为独立 JSON 快照，未开始的连续写入合并为最新快照，进行中的写入不被修改。每次 read 封存此前批次，后续写入不能并入读取之前的批次；新实例仍读到旧实例已接受的最新状态。合并请求共享该批次成功／失败结果，失败不重放也不阻断后续任务。卸载关闭新请求，但已接受任务继续；flush 等待含等待期间新增写入的队列稳定并报告本实例最后批次结果，不代表宿主退出会等待。

读取失败用默认内存状态启动并封锁保存，不能覆写已有磁盘数据；修复后重载不合并临时修改。保存失败不回滚，下次请求保存最新快照，没有自动后台重试或强制退出落盘保证。回归：`settings-storage.test.mjs`、`main-settings.test.mjs`、`history-contracts.test.mjs`、`settings-controller.test.ts`。

## 生命周期与视觉边界

- `PresetController.put()` 接收编辑器的可选原始快照；有基线的编辑按 ID、名称、规则及时间比较，不因排序变化拒绝，不以毫秒时间戳单独识别冲突。UI 始终提交建立草稿时的复制基线，冲突保留草稿并允许另存，不新增持久化字段。
- 历史／预设通知逐项捕获订阅异常并经装配层提示，保存请求在 finally 中保证发出；数据更新仍同步，初次订阅失败移除回调。SettingsController 的 `commit()` 同样隔离同步副作用并在 finally 请求保存，保留已修改设置；workspace 的工具栏／替换偏好／悬浮入口按 owner 隔离，失败入口不提前记录 entryPath。回归：`settings-controller.test.ts`、`main-settings.test.mjs`、`floating-entry.test.mjs`。
- 编辑匹配结果发布时按结果集复制并冻结一次，隔离会话内部可变数组；导航复用发布快照身份。`search-highlight.ts` 对有效、排序、不重叠结果仅更新旧／新当前项装饰，其他持久化树节点保留。结果变化或文档修改仍完整重建／清空，公开 CSS 类与单层匹配 mark 不变。发布及装饰元数据用 WeakMap 随集合释放，不持有 owner。
- 全局转义设置变动通过 SettingsController → workspace → FinderCommands 同步取消准备阶段，不引入全局事件总线；已经提交的替换仍只重算，不重放。

`SettingTab` 只实现 `display()`／`hide()`，所有支持版本由同一 `SettingsView` 渲染五分类；不覆盖新版宿主的 `getSettingDefinitions()`，明确不提供全局设置搜索逐项索引。`settings-fields.ts` 集中基本项名称／描述／控件逻辑，写入仍经 SettingsController 保留副作用、整数提交与非阻塞保存。外观预览只归属当前设置视图，不维护声明式行或共享预览集合；重绘、切分类、hide 与 owner Window 的 pagehide 释放预览、草稿、菜单和监听。分组恢复直接刷新本组控件，不依赖宿主 update 或默认持久化；字段与数据格式不变。

`OwnerRegistry` 按具体 MarkdownView 懒创建资源，读取选区不预建完整 Finder／Worker；同路径分屏独立。释放时记录保留到清理结束，避免 Finder 清理失去 reading 资源。`Disposables` 逆序、幂等并聚合异常，某资源失败不跳过其他资源。workspace／插件公开 dispose 与宿主 onunload 适配；迟到 layout 回调不重建卸载对象。Modal 关闭销毁视图并取消订阅，workspace 卸载关闭全部已跟踪弹窗和菜单。

`shared/ui/mount-view.ts` 使用 Vue 公开 createRenderer 与 owner-bound 原生 DOM 创建操作，实时读取 target.ownerDocument，HTML／SVG／MathML 均不借用初始化 Document。`tools/vue-plugin.mjs` 统一正式、Vitest 和浏览器编译选项，关闭静态提升／HTML 字符串化，静态内容也走节点操作；renderer 的静态 HTML 插入入口拒绝执行，不回退到默认解析器。每次挂载独立 app／idPrefix，注释锚点隔离插入范围，不增加布局 wrapper。历史文字当前直接使用 Vue 模板，未接入 TextRun。DOM actions 负责 Observer／事件／计时器资源，Toolbar 在 onBeforeUpdate 归还移动节点再进行 keyed patch。

CodeMirror 范围通过 StateField／changes 映射，finderSelection annotation 排除导航选择。轮廓测量仅处理可见源码，拒绝折叠／替换块及歧义 bidi；纯 `shared/geometry/scope-outline.ts` 合并矩形、去内部缝，分轴限制外扩。同范围完整可见空白行通过 `scope-geometry.ts` 补桥，不扩数字写入范围。newline layer 只绘制实际匹配换行的非文本 ↵，不改排版、计数或剪贴板；旧宿主无 layer 保留文字高亮。

AppearanceStyles 按 Document 注入显式变量，window-close／pagehide／卸载移除；继承值以 owner computed color 探针显示。调色器用生产内嵌 owner-window 工厂，库拖动监听随断开／release 清理。SettingsView 统一释放预览、草稿、select 和拖动资源。容器名称使用所属 Document 有效的 aria-labelledby，真实控件保留必要提示。

模拟宿主／jsdom／Chromium 截图都不等于 Obsidian、主题、Android 或 iOS 验收；完整检查方法和平台证据口径见 [testing](testing.md) 与 [compatibility](compatibility.md)。
