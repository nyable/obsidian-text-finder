# 交互与状态契约

除单独标出的“已批准约束”外，下文为当前实现事实，不代表授权调整其他交互。实际宿主表现需要按 [compatibility](../compatibility.md) 验证。

## 打开与查询会话

- Finder 懒创建并绑定 Markdown 视图；同文件双分屏分别维护查询会话和当前项。
- 普通“打开查找”使用有效选区，否则复用旧查询；“打开查找与替换”无选区时传入空字符串，会清空旧查询。此差异按现状记录，不擅自统一。
- 阅读选区必须两端都在所属预览容器内，来自所属 Document 的 Selection。
- 打开后立即发起匹配、聚焦并全选查询；输入／切换选项重算，合法当前索引通常保留，不强制新查询回到第一项。Worker 结果异步完成，等待期间不使用旧坐标。
- 文件变化保留查询、重算结果；模式变化清除另一模式结果，保留查询和选项。阅读界面强制隐藏替换区域。
- 普通关闭保留组件实例，不持久化会话；视图关闭／卸载释放资源。默认保留查询、替换文本、选项，关闭会折叠替换区域。
- 每个 owner 的编辑／阅读 Worker 通道独立；取代忙碌请求、关闭及卸载终止线程，不只忽略回包。同查询、同快照后台刷新保留待定滚动及累计导航方向，不能替换成不滚动意图。

依据：`src/editor-extension.ts` 的 `getFinder()`／`selectionText()`／`showFinder()`／`registerCommand()`；`src/SearchBox.svelte` 的 `setVisible()`／`rememberMatches()`／`setFindText()`／`matchAgain()`。

## 已批准的关闭契约

以下行为经维护者批准，已有源码实现及自动回归；不等于全部宿主环境已验收：

1. 关闭按钮、视图内 Escape、关闭命令、切换查找的关闭分支共用关闭语义，以关闭按钮为基准。
   - 基准：`closeFinder()` 在可编辑 owner 存在且 `sourceModeWhenSearch` 开启时，根据有效的全局 livePreview 偏好恢复 `state.source`，然后隐藏面板。
    - 偏好缺失、非布尔或读取抛错时不写模式；恢复的是全局偏好，不是保存的打开前视图状态。
    - 模式恢复失败仍隐藏面板；Promise 拒绝被处理并提示。面板已经隐藏时关闭无副作用；Escape 仅在可见、未被消费、无修饰键且非组合输入时生效。
2. 开启 `clearAfterHidden` 后，关闭应同时清空查询和替换输入；关闭仍不等于重置所有查询选项。
    - 默认保留两种输入和正则／大小写选项；开启清空后也保留选项，不把关闭当作重置会话偏好。

依据：`src/SearchBox.svelte` 的 `closeFinder()`／`setVisible()`／`resetMatches()`；`src/editor-extension.ts` 的 `registerFinderEvent()` 和 HideFind／ToggleFind 命令；`src/util/obsidian-internal.ts:getLivePreviewPreference()`。上述约束经维护者明确确认，不来自源码推断。

范围不自动扩大到原生查找降级、视图销毁或插件卸载；这些路径当前承担隐藏／资源释放职责，是否执行同一模式恢复语义没有额外产品决定。

## 导航与替换

- 前后导航循环；过期文档／查询先重算。编辑定位滚动后可强制源码、选中匹配；保存历史不参与等待链。
- 正文变化、文件打开、活动视图变化及布局刷新采用不主动滚动的重新匹配。
- 替换前重新取得 owner 的 Editor、CodeMirror 和文档，重新计算原文变化。已关闭视图、阅读模式或上下文失效不作为写入目标。
- 单次替换按钮、替换框 Enter 和命令调用 `replaceOnce()`：替换后重算；数量未变且文档／编辑器仍有效时再前进一项，否则定位重算后的当前项。不成功或写入中换文件时不额外前进。
- 替换先异步计算完整原文的候选；提交前再次校验具体文件、Editor、CodeMirror doc、窗口、查询、替换输入和转义选项。正文同步提交后异步重算，再完成宿主定位，最后才决定额外前进。请求被新操作、关闭／重新打开、查询变化、文档变化或销毁取代后，不再提交旧候选、选区或额外前进；宿主重建编辑器时只后台重算，不复用旧坐标。不能取消已交给宿主的模式切换本身。
- 全部替换一次提交所有原文变化，不套用单次替换的额外前进规则。
- 匹配始终基于完整原文，但单次操作只展开目标匹配的模板，全部替换才展开所有模板。写入后定位失败提示“替换已完成”，不把它当作未写入，也不再额外前进。
- 隐藏面板仍可通过编辑命令执行替换；安全来自写入前重算，而不是假设隐藏期间结果有效。

依据：`src/SearchBox.svelte` 的 `navigateMatch()`／`scrollToMatch()`／`replaceOnce()`／`prepareReplacement()`／`replaceText()`；`src/editor-extension.ts:registerEvent()`。回归：`tests/editor-isolation.test.mjs`、`tests/replacement.test.mjs`。

## 输入、焦点与菜单

- `enableInputHotkeys` 开启时，普通 Enter／NumpadEnter 在查找框导航下一项，在替换框替换一次；排除 Alt／Ctrl／Shift／Meta，避免截获系统或用户快捷键。
- IME 使用 `isComposing`、`keyCode === 229` 和 composition 事件状态防护；组合期间 Enter 和历史上下键不触发快捷操作。输入事件本身仍会更新查询。
- 查询 textarea 支持多行；不自动纠错／大写、不检查拼写、不允许用户 resize。
- 隐藏面板同步设 `visibility: hidden` 和 `aria-hidden`，移除 Tab 入口，blur 内部焦点并拒绝迟到聚焦；不承诺统一把焦点送回编辑器。
- More 触发器支持 Enter／Space；打开后聚焦首个可用菜单项。上下键循环、Home／End 定位；Escape 关闭菜单并回焦触发器，不关闭 Finder；Tab 关闭后回焦触发器再交给默认 Tab 行为。外部 pointerdown 关闭菜单。
- 设置分类支持左右键／Home／End；工具栏排序后恢复对应按钮／手柄焦点。拖动有 4px 启动阈值，pointercancel、窗口失焦和 Escape 可取消；切页／隐藏设置清理拖动。
- 历史行 Enter／Space 复用；复选框 Enter／Space 切换选择并阻止默认滚动。子按钮键盘操作不能触发父行复用；历史操作在 focus-within 及无 hover 设备上显示。

依据：`src/SearchBox.svelte` 的 `syncFinderVisibility()`／`guardHiddenFocus()`／`trackComposition()`／`onFinderKeyDown()`／`enterOnReplacer()` 和 textarea 模板；`src/Toolbar.svelte:menuKeys()`；`src/settings-tab.ts`；`src/HistoryList.svelte`。回归：`tests/search-box-dom.test.mjs`、`tests/history-dom.test.mjs`。

## 历史交互

- 单纯输入不立即记录。匹配导航记录非空查询，不要求一定有匹配；阅读导航还检查当前不处于 unsupported／error。
- 同查询连续导航只计一次使用，后续更新时间；A → B → A 开始新周期。明确复用计一次，紧接导航不重复计数。
- 第一行 ArrowUp 从当前排序首项向较旧／低优先级项浏览；最后一行 ArrowDown 向前返回，离开历史浏览时恢复暂存输入。未进入历史浏览时 ArrowDown 清空非空查询。
- 浏览身份是精确文本。重排保留当前项；删除或裁剪当前项时优先转到原排序的下一个存活邻近项，无则前一项。列表清空恢复暂存输入；手动输入退出浏览。订阅修复结果不主动滚动笔记。
- 复用作用于操作时当前可搜索 Markdown 视图；成功才关闭弹窗，失败保留弹窗并提示。不因为打开历史弹窗就固定未来复用目标。
- 复制使用所属 Modal Document 的 Clipboard；成功才统计使用，且只更新仍存在的条目；复制拒绝不统计，异步完成不能复活删除项或更新已销毁弹窗的统计。
- 选择以精确文本为身份；重排不改变选中对象。订阅通知同步刷新多个弹窗、容量和详情，删除的详情对象退出详情页。
- 删除立即更新内存并请求保存，无确认弹窗。详情删除返回列表；保存失败不回滚可见修改。
- 容量输入仅完整十进制整数 1–200 有效，Enter／blur 提交，无效输入恢复当前值；缩容立即按排序裁剪。

依据：`src/SearchBox.svelte` 的 `recordSearchToHistory()`／`setVisibleFromHistory()`／`onFinderKeyDown()`；`src/HistoryModal.svelte` 的订阅／`select`／`copy`；`src/history.ts`；`src/settings-tab.ts:renderPage()`。数据规则见 [architecture](../architecture.md#持久化数据格式)。

## 阅读状态与错误

- 等待立即显示计数标记 `…`，持续 400ms 后显示外置状态提示；查询／文件变化、关闭会重置提示延迟。
- 不支持／失败／超时显示 `!` 与状态说明，不冒充无结果；失败和超时提供重试，不支持只提供原生入口。
- 默认最多等待渲染 5 秒，以渲染回调后的微任务及约 100ms 检查补充；该期限不限制正则计算。Worker 初始化在查询发送前最多等待 3 秒，失败选择同步兼容；发送后的计算没有执行期限，可关闭／取消终止线程。
- 请求绑定查询选项、视图、文件及渲染器；同查询后台刷新保留等待中的用户导航意图，连续导航累计净方向并循环定位。过期回调不能定位或发布结果。
- 阅读导航先挂载分块、展开必要列表／Callout／details 祖先，然后定位首个文本端点；不恢复折叠状态。跨块匹配只绘制挂载部分。
- 打开时原生偏好开启则直接用原生查找；不支持时提示并回退。运行失败可主动降级，降级关闭插件面板以避免两套入口同时可见。
- 存储／复制／复用错误由插件 Notice 提示，按全局 5 秒间隔节流；读取失败禁止写入，保存失败保留内存修改。

依据：`src/SearchStatus.svelte`、`src/reading-search.ts` 的 `search()`／`run()`／`scroll()`／`clear()`、`src/editor-extension.ts` 的 `showFinder()`／`openNativeSearch()`、`src/main.ts:reportError()`。

## Worker 兼容与错误

- Worker API 缺失、构造失败或查询发送前初始化失败，当前通道在同一窗口内使用同步兼容路径，并提示复杂正则可能阻塞；窗口变化重新探测。取消不触发降级。
- 查询发送后出现错误（包括消息派发／解码失败）进入明确失败状态；普通重试重建 Worker，另提供带风险文案的“同步重试”。不因查询慢或无效正则自动重放。
- 编辑／阅读匹配等待均显示 `…`，400ms 后状态面板提供“取消并关闭”，该按钮只隐藏／清理，不额外恢复宿主模式。既有用户关闭入口仍遵守统一关闭契约。
- 替换前取消未完成查找；提交前后台刷新同一有效快照不取代任务。替换输入变化、导航及生命周期失效取消候选；连续替换取代旧候选，不排队写旧文档。提交中自身 editor-change 事件不重入替换或取消后续重算。
- 等待文案区分“尚未写入”与“已完成、正在更新匹配”。提交后取消只停止后续计算／定位，不撤销正文。候选失败的重试继续替换操作，必须重新核验身份；提交后失败只允许重新查找，不重复写入。

依据补充：`src/SearchBox.svelte:replaceInWorker()`／`replacementCurrent()`、`src/match-engine.ts:replace()`、`tests/search-box-dom.test.mjs` 的 candidate invalidation／post-commit／same-file split 回归。

依据：`src/match-engine.ts`、`src/SearchBox.svelte:setFindText()`／`cancelEditing()`、`src/reading-search.ts:acceptMatches()`、`tests/match-engine.test.mjs`、`tests/search-box-dom.test.mjs`。
