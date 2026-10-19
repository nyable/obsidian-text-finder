# 交互与状态契约

除单独标出的“已批准约束”外，下文为当前实现事实，不代表授权调整其他交互。实际宿主表现需要按 [compatibility](../compatibility.md) 验证。

内部重构不改变本契约。Finder 应用逻辑位于 `src/features/finder/application/`，DOM 效果位于 `interaction/`，组件位于 `ui/`。DOM 提交等待使用 Vue nextTick，Toolbar 在 onBeforeUpdate 归还搬移节点。

## 打开与查询会话

- Finder 默认懒创建并绑定 Markdown 视图；同文件双分屏分别维护查询会话和当前项。“常规”设置 `showFloatingFinderOnOpen` 默认 false；启用后初始化已有笔记、新打开文件及新分屏的小图标，不抢焦点、不搜索／滚动、不切换模式。
- 新建 Finder 时从 `defaultRegexMode`／`defaultCaseSensitive`／`defaultWholeWord` 初始化选项（均默认关闭）；修改设置不覆盖已有 Finder。关闭重开、换文件及编辑／阅读切换仍保留手动选择，不重新套用默认值。
- 非收起态普通“打开查找”使用有效选区，否则复用旧查询；“打开查找与替换”无选区时传入空字符串，会清空旧查询。收起态两者均保留已有查询／替换文本／选项，不用选区覆盖查询。
- 阅读选区必须两端都在所属预览容器内，来自所属 Document 的 Selection。
- 显式查找命令打开后立即匹配、聚焦并全选查询；打开查找与替换聚焦并全选替换输入。输入／切换选项重算，合法当前索引通常保留，不强制新查询回到第一项。Worker 结果异步完成，等待期间不使用旧坐标。
- 从小图标经命令展开时，查询聚焦／全选在 Vue 提交完整控件并校正位置后执行；非收起态查询打开保留同步聚焦，更新绑定值后补全选而不再次聚焦。替换命令布局提交后直接聚焦替换输入，不经过查询输入。程序化输入／标记／移动入口聚焦使用 `preventScroll: true`，避免浏览器为焦点滚动祖先；正文匹配导航仍可主动滚动。迟到聚焦／全选校验面板意图、文件、模式、所属 Document、可见性及销毁，不覆盖新的关闭／收起／命令意图。
- 自动入口为 `passiveEntry`，后台模式／文件／布局刷新不激活搜索；点击图标后不滚动地开始匹配、不聚焦输入，阅读模式统一使用插件，仍校验能力并保留不兼容降级。已经展开或手动收起的会话不被打开默认强制收起或重置位置；用户关闭后同 owner／文件的普通激活不重新显示，换文件可重新应用默认。关闭设置只停止后续自动显示。
- 自动入口初次显示按现有 `finderDockSide`（缺省右侧）靠 owner／可见视口安全边界，不依赖“拖边自动收起”开关。`showFloatingEntry()` 在小图标布局提交后再校正，暂时不可测量时保留贴边意图，由既有布局监听恢复；迟到校正检查 intent／文件／Document／可见性／被动收起状态，不聚焦或激活查询。用户将小图标拖到中间后保持手动停放，普通后台刷新或标签激活不强制回边缘。此初始定位修正经维护者批准，实际移动端首次显示仍需复测。
- “切换查找”从关闭或小图标状态打开完整框，只有已展开才关闭。“切换替换区域”从关闭或小图标状态展开并确保替换栏显示、聚焦替换输入；已展开时正常切换替换栏。框内箭头行为不变。替换 UI 命令仍只作用可编辑 owner，不切换阅读模式。迟到替换聚焦校验 intent、文件、可见性、折叠及模式，不覆盖新的查找／关闭意图。
- 文件变化保留查询、重算结果；模式变化清除另一模式结果，保留查询和选项。阅读界面强制隐藏替换区域。
- 普通关闭保留组件实例，不持久化会话；视图关闭／卸载释放资源。默认保留查询、替换文本、选项，关闭会折叠替换区域。
- 每个 owner 的编辑／阅读 Worker 通道独立；取代忙碌请求、关闭及卸载终止线程，不只忽略回包。同查询、同快照后台刷新保留待定滚动及累计导航方向，不能替换成不滚动意图。
- 全字匹配切换沿用正则／大小写的重算策略，属于编辑／阅读查询身份及替换候选校验的一部分；切换取消旧计算，迟到结果不能发布、写入或定位。常驻及 More 均为图标按钮，使用 `aria-pressed`；常驻切换聚焦查询，More 切换保留面板及按钮焦点；隐藏按钮不关闭选项。

依据：`src/app/workspace-runtime.ts` 的 `syncFloatingEntries()`／`activateFloatingFinder()`／`getFinder()`／`showFinder()`，`workspace-commands.ts:registerWorkspaceCommands()`；`src/features/finder/application/finder-session.ts` 的 `showFloatingEntry()`／`showReplace()`／`toggleReplaceFromCommand()`／`setVisible()`／`matchAgain()`；`tests/integration/floating-entry.test.mjs`、`reading-commands.test.mjs`、`tests/component/finder-panel.test.mjs`。新增打开与命令规则经维护者批准；自动回归不等于宿主键盘／焦点验收。

## 已批准的关闭契约

以下行为经维护者批准，已有源码实现及自动回归；不等于全部宿主环境已验收：

1. 关闭按钮、视图内 Escape、关闭命令、切换查找的关闭分支共用关闭语义，以关闭按钮为基准。
   - 基准：`closeFinder()` 在可编辑 owner 存在且 `sourceModeWhenSearch` 开启时，根据有效的全局 livePreview 偏好恢复 `state.source`，然后隐藏面板。
    - 偏好缺失、非布尔或读取抛错时不写模式；恢复的是全局偏好，不是保存的打开前视图状态。
    - 模式恢复失败仍隐藏面板；Promise 拒绝被处理并提示。面板已经隐藏时关闭无副作用；Escape 仅在可见、未被消费、无修饰键且非组合输入时生效。
2. 开启 `clearAfterHidden` 后，关闭应同时清空查询和替换输入；关闭仍不等于重置所有查询选项。
    - 默认保留查找和替换文本及匹配选项；开启清空后也保留选项，不把关闭当作重置会话偏好。

依据：`src/features/finder/application/finder-session.ts` 的 `closeFinder()`／`setVisible()`／`resetMatches()`；`src/app/workspace-runtime.ts:registerFinderEvent()` 和 `workspace-commands.ts` 的 HideFind／ToggleFind 命令；`src/platform/obsidian/live-preview.ts:getLivePreviewPreference()`。上述约束经维护者明确确认，不来自源码推断。

范围不自动扩大到原生查找降级、视图销毁或插件卸载；这些路径当前承担隐藏／资源释放职责，是否执行同一模式恢复语义没有额外产品决定。

## 面板移动与贴边收起

- 此交互经维护者批准，源码实现不代表全部宿主验收。展开／贴边／关闭分别表达显示完整控件、显示边缘标签、结束可见查找。`cache.visible` 在贴边时仍为 true，以保留匹配与高亮；关闭沿用原契约。
- 桌面装饰条统一作为拖动区，移动端手柄仍在结果栏；约 3px 移动后立即进入拖动（80% 透明度），无长按。折叠箭头仅切换替换行；收起标记不移动时仍单击展开，拖动后抑制 pointer click、不吞键盘激活。使用 Pointer Capture（不支持／失败回退 Document 监听），取消捕获／pointercancel／Escape／失焦／pagehide 回滚；隐藏／销毁清帧、捕获、计时器和监听。
- 自动贴边配置默认关闭；仅完整框移动后的 pointerup 确认，不由 resize／打开触发。满宽（85%）用横向 56px 和方向优势 1.4 倍，非满宽用朝边缘 12px 移动及 16px 距离；候选移回撤销、替换时禁用。收起标记可二维自由移动，不靠边就停在松手处，靠边吸附左右；保持收起形态不展开。满宽展开居中、保留标记高度，其他宽度围绕标记位置展开并限制边界。
- 移动完整框与收起标记均不对 right／transform 做位置过渡，仅保留 opacity（普通态 0.2s linear，拖动／收起态 0.12s ease），避免展开定位器读取动画中间基础坐标并留下过期 translate。DOM 提交后的既有校正保留，不增加延迟展开或等待动画结束；桌面位置过渡不变，reduced-motion 优先禁用所有状态过渡。此移动展开越界修正经维护者批准，有模拟几何与实际组件 CSS 回归，Android 最终绘制仍需复测。
- 临时位置属于具体 MarkdownView；关开、换文件、换模式保留位置，但销毁后不恢复。尺寸／软键盘变化只约束可见位置，不覆盖保存的手动意图。恢复位置保留当前视图命令、桌面收起标记右键及移动控件聚焦后的 Home，不再提供常规设置中的跨视图恢复按钮。恢复位置不改查询、选项或正文；自动显示但尚未使用的入口恢复时保持小图标，不激活匹配或原生查找。
- 收起 blur 输入、同步 inert／aria-hidden 并移出 Tab；More 关闭，拒绝迟到输入聚焦。标签展开不聚焦查询，焦点回原移动入口；命令打开仍聚焦／全选。桌面右键菜单提供关闭／恢复；关闭与重新打开取消迟到焦点。
- 移动端收起图标／移动手柄阻止 contextmenu 默认行为及冒泡，不打开插件关闭／恢复菜单，局部禁用 touch callout／文字选择；不影响输入框选词／复制粘贴。移动端按住至少 500ms 后松手／取消，或已经收到 contextmenu 时，抑制随后指针 click（复用 700ms 过期清理）；短按单击展开、长按后拖动及键盘 click 正常，约 3px 直接拖动不增加等待。移动端关闭可点图标展开后使用关闭按钮，恢复使用已有命令。此移动长按契约经维护者批准，系统实际触控事件仍需真机验收。
- 移动端拖动入口在有效 pointerdown 时阻止冒泡并尽早请求 Pointer Capture；同指针的 move／up／cancel 使用 Document 捕获阶段，移动阈值前也隔离 move（取消可取消的默认行为），避免宿主祖先冒泡滑动识别先行；down／up 不取消默认行为，保留短按原生 click。入口同时隔离从该手柄开始的 touchstart，并在 Document 捕获阶段以非 passive touchmove 保护同一 touch identifier；Touch Events 不重复更新坐标，未参与拖动的手指／正文／输入不屏蔽。touchend／cancel、隐藏、销毁、失焦／pagehide 释放触摸保护，Pointer Capture 失败仍用捕获阶段监听，真实取消继续回滚。桌面路径及满宽横向约束不变。此局部手势隔离经维护者批准；Android 收起图标侧栏误触／拖不动的消失仍需实机验证，不能保证拦截更早的宿主捕获监听或原生系统手势。
- 移动端 More 仍在输入行，只把放不下的常驻后缀搬到结果栏。同一节点保留事件／勾选／焦点；排序前先回原容器以保证 Vue keyed 生命周期，布局不持久化。设置隐藏／删除动作、销毁时不能留下重复或孤立按钮；极窄结果栏可换行。
- 移动端拖动入口由结果栏左侧 grip 改为顶部中央短横条，72×30px 命中区与左右计数／动作区独立，只有手柄拦截触摸滚动。结果栏和单行搜索框基础外高均 40px；查询／替换使用同一 30px 输入盒及明确的行高／padding，多行／长文本保持可滚动，不改输入与替换语义。此移动端修正经维护者批准，桌面及收起图标尺寸／吸附不变，真机触控和内容滚动仍待验收。
- 收起保留计算／高亮但放弃之前待定的导航意图（编辑位置代次、Worker scroll／direction、阅读 pauseNavigation）；后续主动命令导航正常。替换候选与提交后重算期间禁用收起；贴边执行替换先展开。没有自动滚动收起。

依据：`src/features/finder/application/finder-session.ts`、`src/features/finder/interaction/panel-presentation.ts`、`finder-position.ts`、`src/features/reading/dom/reading-search.ts:pauseNavigation()`；`tests/unit/finder-position.test.mjs`、`tests/component/finder-panel.test.mjs`。

## 选区范围契约

精确字符、编辑查找／替换共用范围、阅读正文选区查找及不增加整行扩展设置经维护者批准；编辑与阅读使用独立坐标，阅读不替换。以下为实现规则，自动回归不代表实机验收：

- 独立命令先捕获正文选区再打开 Finder，保留查询；普通打开仍按旧的选区填词设置执行，但已经限定范围时不以当前匹配覆盖查询。
- CodeMirror 保存非空用户选区候选，插件导航通过 Annotation 标记，不覆盖原候选；明确光标选择清空候选，文档变化清候选。范围只在启用／重新执行独立命令时捕获，普通重新选择不自动改变锁定范围。
- 同一视图多个非空范围可用；反向选择归一化，重叠合并，相邻范围保持各自边界。跨行严格使用实际字符，不扩行；范围外字符可以作为正则上下文，但完整匹配／修改必须包含在单个范围中。
- 范围随 CodeMirror changes 映射：边界插入包含在范围内，范围完整替换包含新插入文本；只删除范围保留空锚点，撤销可恢复。删除跨越边界无法无损映射，移除受影响范围，撤销不凭猜测扩大它；其他存活范围保留。空范围显示不可用、匹配为零、不写入。
- 范围变化参与查询身份和请求代次，取消旧候选／查询／定位；提交前核验 doc／owner／范围，提交后按同一事务映射的新范围重算，不以新范围身份误判自身写入失败。
- 收起保留范围。关闭清除正文范围并取消任务，留下写入阻断保护；该会话的隐藏替换不得转成全文。明确重新打开普通 Finder 后开启新的全文会话；从未限定范围的隐藏替换保持旧契约。
- 换文件、切模式、编辑器 State 重建丢失范围字段、窗口迁移使范围失效，查找／替换保持空范围保护，需重选或明确清除，不把源码范围用于阅读或反向转换。阅读同样展示选区按钮及失效状态。销毁释放所属范围装饰，不影响其他 owner。
- 工具栏默认 More，常驻及 More 均用 `aria-pressed`；隐藏按钮不清范围，也不添加额外标记。选区启用以按钮激活态为准，More 汇总其内部模式；计数旁不增加文字／清除入口。空／失效范围仍保持激活和写入限制，按钮提示说明需重选或关闭限制。正文默认淡背景，可明确开启外轮廓，无下划线，不给非操作容器添加 tooltip 标签。

依据：`src/platform/codemirror/search-scope.ts`、`src/features/finder/application/search-scope.ts`、`finder-session.ts:replaceMatches()`、`src/app/workspace-runtime.ts`。回归：`tests/integration/search-scope.test.mjs` 和 `tests/component/finder-panel.test.mjs` 的 selection/scoped 系列。

### 阅读范围及换行

- `ReadingSelectionTracker` 为已打开阅读视图捕获候选（不必先创建 Finder），在所属 Document selectionchange、离开正文前的 pointerdown／keydown 取节点＋数字端点；正文重新交互／明确清空候选不沿用旧选择。输入框或命令面板聚焦不重定义正文候选；其他正文选区不借用。独立命令保留查询，普通打开的选区填词行为不变。
- 完整 renderer 就绪才允许确认范围；DOM 两端必须位于 owner 正文，文本／元素端点按索引反向映射。折叠空白部分选择向内取整，不猜测 Markdown 源坐标，不用选择字符串重搜；零长度／未索引端点拒绝。浏览器提供多 Range 则逐个校验，不拼接间隙。
- 请求携带范围代次，Worker／同步共用 ranges；空查询仍建立范围背景，清查询不解除范围。导航／浏览器 Selection 变化不重捕获。虚拟挂载同节点保留；源快照／文件／renderer／Document／文字或数字节点映射改变失效，重试失败也不自动全文。明确关闭范围或关闭后普通重开才结束限制。
- `<br>`、`pre` 保留换行及正文块边界记录独立锚点；纯换行结果不再要求文本端点，先挂载目标分块再定位。连续换行一次匹配仍计一项，按匹配位置绘制 `↵`；排除内容保护边界和末尾合成分隔符不单独成为结果，自动折行不造换行。阅读展示的是渲染逻辑边界，不是源码换行。
- 背景注册表按 Document 合并 owner，scope priority -1／匹配 0／当前 1；轮廓与换行在 body 的独立 fixed portal，aria-hidden、pointer-events none、不写正文。滚动先隐藏旧几何、按帧重测，ResizeObserver／字体／viewport／外观变更请求绘制，按 owner 与裁切祖先限制显示。挂回重建临时 Range，不缓存 live Range；销毁释放监听、Observer、rAF 和覆盖层。
- 普通查找统一使用插件，不兼容时提示并回退原生；显式范围命令使用插件能力，失败说明原因，不打开原生全文冒充范围。阅读替换／文件写入／切编辑模式保持禁止。

依据：`src/features/reading/dom/reading-selection.ts`、`reading-text.ts`、`reading-search.ts`、`reading-overlay.ts`；回归：`tests/integration/reading-scope.test.mjs`、`reading-commands.test.mjs`、真实 Finder 的 `reading scope` 测试。实机选区丢焦、命令面板及覆盖层绘制仍待验收。

### 搜索选区外观

- 外观页新增独立“搜索选区”折叠组，默认收起；背景及边框色支持 alpha，沿用应用／取消、单项恢复继承。边框默认关闭、粗细默认 1px，可选 1–3px；开关及粗细立即保存并更新展示，不重算或改变查找范围。
- 设置顺序为始终可见的背景色、轮廓开关、边框色／粗细；开关关闭时关联组 hidden 并保留颜色／粗细值，关闭调色及下拉，内部焦点回开关。隐藏控件不得打开面板或保存；开关通过实例唯一 aria-controls 引用关联组，不给非操作容器添加 aria-label。
- 跨行选区预览与正文使用相同矩形并集轮廓算法；颜色草稿只覆盖预览变量，取消／折叠／切页／卸载清除。分组恢复一次保存，清选区两项颜色并恢复开关／粗细，不改其他组；旧控件不得在重绘／隐藏后保存。
- 范围背景不盖匹配颜色；可选边框使用独立、不可交互且读屏隐藏的 SVG layer，不对 mark 逐片 outline，不画整个选区的大矩形。语法／匹配拆分片段按范围身份合并；视口内矩形、折行／缩放／滚动及宿主文档布局变化由 CodeMirror 测量更新。普通行仅连接小行间距；同一范围内完全选中、可见的空行／空格及 Tab 空白行，另按源码归属与实际行坐标补连接。优先上下文字共同水平区间，无重叠时经空白行插入点形成窄阶梯；不可跨独立范围、隐藏／折叠块或有歧义的 bidi 空隙。不把视觉轮廓当作新的允许写入范围，背景语义不变。
- 默认无边框且无有效范围时不测选中文字几何；颜色／开关更新通知各 owner layer，销毁或迁移释放旧 Document 监听。旧宿主缺少 layer API 降级为背景，不替换宿主 CodeMirror。
- 轮廓留白只影响几何路径：左右仅按半线宽外扩，内缘贴近测得选中文字边界，不增加左右 2px 空间；上下保留 2px 内侧净距加半线宽外扩。片段先按视觉行合并；狭窄断开片段／多范围间隙沿分离轴限制外扩，不为留白连接本来分离的轮廓，左右紧间隙不取消上下留白。不添加正文 padding、不改变匹配坐标。正文与预览共用算法，粗细变化也请求预览重测。
- 编辑匹配包含真实换行时，每个已消耗换行在测得行尾显示 `↵`，空白行同样可见；当前项／普通项复用既有颜色。标记只存在于独立 layer，pointer-events none、aria-hidden，无 aria-label／title／可聚焦控件，CSS 伪元素不插入正文文本。软折行、匹配末端未包含的换行、零宽位置和无换行的 EOF 不标记；一个跨行匹配仍只计一项。关闭／文档变更清理遵循原高亮失效规则，阅读模式不添加源码标记。

依据：`src/shared/geometry/scope-outline.ts`、`src/platform/codemirror/search-scope.ts`、`src/features/settings/ui/appearance-styles.ts`、`settings-view.ts`；回归 `tests/integration/scope-outline.test.mjs`、`tests/unit/appearance.test.mjs`、`tests/integration/main-settings.test.mjs`。批准外观不等于宿主实机验收。

## 导航与替换

- 前后导航循环；过期文档／查询先重算。编辑定位滚动后可强制源码、选中匹配；保存历史不参与等待链。
- 正文变化、文件打开、活动视图变化及布局刷新采用不主动滚动的重新匹配。
- 替换前重新取得 owner 的 Editor、CodeMirror 和文档，重新计算原文变化。已关闭视图、阅读模式或上下文失效不作为写入目标。
- 单次替换按钮、替换框 Enter 和命令调用 `replaceOnce()`：替换后重算；数量未变且文档／编辑器仍有效时再前进一项，否则定位重算后的当前项。不成功或写入中换文件时不额外前进。
- 替换先异步计算完整原文的候选；提交前再次校验具体文件、Editor、CodeMirror doc、窗口、查询、替换输入和转义选项。正文同步提交后异步重算，再完成宿主定位，最后才决定额外前进。请求被新操作、关闭／重新打开、查询变化、文档变化或销毁取代后，不再提交旧候选、选区或额外前进；宿主重建编辑器时只后台重算，不复用旧坐标。不能取消已交给宿主的模式切换本身。
- 全部替换一次提交所有原文变化，不套用单次替换的额外前进规则。
- 宿主拒绝／过滤替换事务时，不因 dispatch 正常返回而报告成功；保留未修改结果，不定位或额外前进、不自动重放。同值替换仍按实际接受的文档事务处理，不用文本相等冒充拒绝。
- 匹配始终保留完整原文上下文，选区开启时只扫描允许范围内起点并接受完整包含的匹配；单次操作只展开目标匹配的模板，全部替换才展开所有模板。写入后定位失败提示“替换已完成”，不把它当作未写入，也不再额外前进。
- 隐藏面板仍可通过编辑命令执行替换；安全来自写入前重算，而不是假设隐藏期间结果有效。

依据：`src/features/finder/application/finder-session.ts` 的 `navigateMatch()`／`scrollToMatch()`／`replaceOnce()`／`replaceMatches()`、`replacement-operation.ts:runReplacement()`；`src/app/workspace-runtime.ts:registerEvent()`。回归：`tests/integration/editor-isolation.test.mjs`、`replacement.test.mjs`、`finder-editor.test.ts`。

## 输入、焦点与菜单

### 笔记菜单入口

- 右上角 `file-menu` 仅在 source 为 `more-options` 且 leaf 的 MarkdownView／文件匹配时增加“Text Finder：打开查找”。复用 `showFinder()`，遵守选区填词设置，收起／已锁定范围保留查询的规则不变；阅读统一使用插件并保留不兼容降级。不扩展文件管理器、链接或标签右键。点击校验原 owner，不能转向当前活动分屏。
- 正文非空选择增加“以选中内容查找”与“在选区中查找”。前者是明确填词操作，不受自动选区填词开关限制；清除已有或失效范围，索引回零，以选中文字在当前笔记全文查找，其他查询选项保持不变。后者保存本次选择为精确范围、保留已有查询，沿用选区命令的插件能力检测，不降级成原生全文。
- 编辑 `editor-menu` 按传入 Editor／MarkdownView 或 MarkdownFileInfo 解析 owner，不借用全局活动编辑器；捕获 CodeMirror doc 身份及非空 ranges。阅读在 owner 正文 contextmenu 时捕获实际 Selection 的节点数字端点和文本，不使用旧候选；排除输入、嵌入、页眉／页脚及已排除内容端点。
- 点击前再次校验视图仍打开、file／mode／Document 和 editor doc 或阅读 source／renderer／DOM 修订标记；焦点或浏览器 Selection 改变不替换快照，正文变化则提示重新打开菜单。阅读候选 tracker 的修订标记消费待定 MutationRecords，拒绝同文字改回后的过期边界。多选区仍分别传递，不拼接为范围。
- 阅读插件不兼容时，“以选中内容查找”调用既有原生打开，再只向 owner 预览容器的 `.document-search-input input` 填入快照并派发 input；控件形状不可用时提示，不能向其他分屏输入框写值。
- 阅读通过 shape-checked 公开 `Menu.forEvent()`（since 1.6.0）共享同一事件菜单，不停止传播、不调用第二次显示；缺失／调用失败不另建替代菜单。链接复制／打开等项目继续由宿主贡献；纯正文因默认浏览器菜单被抑制，补充所属 Document 的复制选中文字操作。菜单项不额外添加 title／aria-label；菜单按实例去重，卸载隐藏持有菜单并释放正文监听。

依据：`src/app/workspace-runtime.ts:connectReadingMenu()`／`selectionMenu()`／`showSelectedText()`／`registerEvent()`；`src/features/finder/application/finder-session.ts:findSelectedText()`／`findInCapturedSelection()`；`src/features/reading/dom/reading-selection.ts:stamp()`。回归：`tests/integration/finder-menus.test.mjs`、`tests/component/finder-panel.test.mjs`；宿主方法检查 `tools/diagnostics/menu-host-check.mjs` 不等于 GUI 验收。

- `enableInputHotkeys` 开启时，普通 Enter／NumpadEnter 在查找框导航下一项，在替换框替换一次；排除 Alt／Ctrl／Shift／Meta，避免截获系统或用户快捷键。
- IME 使用 `isComposing`、`keyCode === 229` 和 composition 事件状态防护；组合期间 Enter 和历史上下键不触发快捷操作。输入事件本身仍会更新查询。
- 查询 textarea 支持多行；不自动纠错／大写、不检查拼写、不允许用户 resize。
- 隐藏面板同步设 `visibility: hidden` 和 `aria-hidden`，移除 Tab 入口，blur 内部焦点并拒绝迟到聚焦；不承诺统一把焦点送回编辑器。
- More 是工具栏延伸的紧凑图标按钮面板，不是文字列表／勾选菜单；同外部按钮几何、激活／禁用／提示样式，横排并在宽度不足时换行，宽高受 owner／可见视口限制。容器用 `role="group"`／`aria-labelledby`，模式用 `aria-pressed`，不用 menu／menuitemcheckbox。
- More 触发器支持 Enter／Space，打开后聚焦首个可用按钮；方向键循环、Home／End 定位，跳过禁用项。切换模式保留面板和按钮焦点，普通操作执行后收起。Escape 关闭面板并回焦触发器，不关闭 Finder；Tab 原生浏览，焦点离开面板后收起且不抢回焦点。外部 pointerdown 或再次点击 More 收起。
- More 仅汇总实际放在面板内的开启模式，收起且存在开启模式时右上角显示 5px 主题强调色圆点，不使用模式激活蓝底／边框；常驻／隐藏模式和普通动作不参与。展开时隐藏圆点，收起按当前内部状态恢复；圆点绝对定位、不改几何、无动画、无独立点击区域且 `aria-hidden`。展开用独立内边框反馈／`aria-expanded`，不是新模式开关；读屏说明列出内部开启模式且在展开时保留，容器不添加 tooltip 标签。设置纯展示预览显示相同收起圆点。不增加底部状态栏。
- 工具栏内外按钮及 More 的额外焦点框采用 `:focus-visible` 的 2px outline，鼠标／触屏焦点不附加蓝色 box-shadow，保留键盘焦点、模式按钮自身激活边框和 More 的展开反馈；不改变输入框聚焦样式及其他 Finder 控件的焦点样式。依据：`src/features/finder/ui/FinderToolbar.vue`、`src/styles/finder-primitives.scss:focus($keyboardOnly)`。
- 设置分类支持左右键／Home／End；工具栏排序后恢复对应按钮／手柄焦点。拖动有 4px 启动阈值，pointercancel、窗口失焦和 Escape 可取消；切页／隐藏设置清理拖动。
- 历史复用及常显复选框使用原生 button，Enter／Space 原生点击分别复用／选择，不触发页面滚动。详情／复制／删除与复用为兄弟控件，不再嵌套；操作常显，不依赖 hover。

依据：`src/features/finder/interaction/panel-presentation.ts`、`composition-input.ts`、`input-shortcuts.ts` 和 `src/features/finder/ui/FinderPanel.vue` 的 textarea 模板；`FinderToolbar.vue:menuKeys()`；`src/features/settings/ui/settings-view.ts`；`src/features/history/ui/HistoryList.vue`。回归：`tests/component/finder-panel.test.mjs`、`history-panel.test.mjs`。

## 外观设置与预览

- `ToolbarPreview.vue` 实时呈现保存的布局与默认选项，不读取已有 Finder 的当前状态，也不连接笔记、匹配器或替换操作。
- “外观”页将完整预览置于滚动配置区之外，分类导航／预览固定可见，仅颜色与工具栏配置滚动；其他分类不改滚动方式。
- 始终展示查找／替换两行；预览使用非交互元素，无输入、选择、焦点、悬停反馈、折叠或 More 菜单，不执行操作、不修改设置，也不注册所属 Document 的菜单监听。
- 下方文本预览仅一个两行区域，三处 `text`（一个当前、两个普通）均位于首尾不齐的跨行选区中，另有选区外文字；同时展示所有相关颜色／轮廓，计数保持三项。窄屏自然折行，不固定高度或缩字裁切；原分开的选区样例并入同一区域。
- 固定查找词 `text`、替换框空占位，计数为第一项／共三项；正文样例 `Find text, highlight text, and replace text.` 中第一个词为当前匹配、后两个为普通匹配。样例不随默认正则／大小写／全字匹配改变，也不读取笔记或触发真实匹配；高度随文字自然换行自适应，不裁切、不提供内部滚动操作。
- 颜色、搜索选区、搜索栏按钮、替换栏按钮四个配置分组独立折叠，默认全部折叠，顶部预览始终可见；标题按钮支持原生 Enter／Space，`aria-expanded`／`aria-controls` 及 hidden 内容同步。当前设置访问期间切页／重绘保留手动展开状态，隐藏设置后恢复全部折叠；不持久化、不请求保存。收起颜色／选区组取消调色草稿，收起工具栏组取消拖动，内部焦点回标题。
- 分组标题旁显示常驻 `undo-2` 回退图标，悬停提示统一为“恢复默认设置”，与折叠按钮独立；颜色单项恢复也使用该图标与提示。点击整组或单项恢复先取消调色／拖动，直接恢复对应设置并保存，不弹确认框。重置入口校验页面、预览及触发器归属，切页／隐藏／重绘／卸载后的旧按钮不得修改设置。折叠状态不被恢复按钮改变。
- 所有有效的整组／单项恢复均立即显示统一的 2 秒 Notice“已恢复默认设置”，包括本来已是默认值的分组；提示代表内存设置已恢复，不等待保存，也不宣称磁盘保存成功。保存失败仍由原保存错误路径提示，失效入口不显示成功提示。设置分类 Tab 有悬停、主题色选中下划线／文字、按下背景与键盘聚焦反馈，保持分类导航键盘行为。
- 宿主会将 `aria-label` 用作悬浮提示，因此设置分类、外观滚动区、预览图、颜色选择器和 More 菜单等容器采用 `aria-labelledby` 引用标题／触发器，保留无障碍名称，不制造大片容器提示。预览的装饰图标使用 `aria-hidden`，真实操作按钮保留功能提示；颜色值输入引用面板标题，保留十六进制格式提示。
- 默认开启与按钮位置独立；“恢复默认设置”在搜索栏恢复布局及三个默认选项（false），在替换栏仅恢复布局；单次保存同一配置快照，不影响其他栏或已有 Finder 的查询选项。页面无说明段落／隐藏默认提示，默认选项生效规则保留在开关的悬停提示与文档中。
- 每个按钮独立成块，左侧整高 32px 区域均可拖动，上层功能图标／名称／排序，下层主题化位置下拉／默认开关，省略重复的“显示位置”文字但保留辅助技术标签。“默认开启”文字区与宿主开关区局部垂直居中，不改变宿主开关外观。保持拖动、按钮与键盘排序、焦点恢复及取消清理。
- 外观页位置下拉使用 select-only combobox，选项仍为 inline／more／hidden。点击或 Enter／Space／上下键展开；展开时上下键循环导航、Home／End 到首尾，只有点击选项或 Enter／Space 才提交不同值，更新预览及已有工具栏并保存一次，同值不保存。Escape 取消并保留触发器焦点，Tab 关闭并继续原生焦点导航；组合输入不触发快捷键。列表挂到所属 Document 的 body，用 aria-labelledby 引用实例唯一触发器，选中勾选与临时导航高亮分离，空间不足上翻并限制宽高。
- 下拉 size 支持 sm／md、width 支持 content／fill，默认 sm／content，外观位置下拉显式使用此组合。内容适配按全部选项的最长文字占位，切换值不改变宽度；列表与触发器同宽，字体和文字起点一致，只有视口不足才限制列表宽度。尺寸仅控制高度／内边距／图标，不改变选项语义、保存时机或配置格式。
- 位置列表在外部点击／焦点移出／外部滚动、窗口失焦／pagehide／resize、分组收起、恢复、排序重绘、切页／隐藏／卸载时关闭并清理监听，不提交临时选项或回焦到已隐藏控件。旧列表选项不得作用于重新打开的列表。打开位置列表先取消调色草稿／拖动／其他下拉，打开调色面板或开始拖动也先关闭下拉；历史分类的原生排序下拉不变。
- 切换设置分类、隐藏／重绘设置页及插件卸载销毁预览。
- 点击颜色块打开 vanilla-colorful 透明度选择器，含选区两项在内的八项采用同一界面。拖动／合法输入只改变局部草稿；requestAnimationFrame 合并预览容器 CSS 变量更新，不改插件设置、不重写全窗口样式、不保存。非法／部分输入禁用“应用”，组合输入结束后校验；Enter、失焦和拖动结束均不自动提交。
- 点击“应用”仅提交该项合法草稿，更新真实样式并保存一次；同值无需写入。取消、Escape、点击外部、设置切页／隐藏／重绘／卸载、窗口失焦／pagehide、窗口大小或外部滚动变化均丢弃草稿、取消预览帧并恢复已应用样式；打开另一项先取消上一项。Tab 在选择器内部循环，Escape 回焦色块。
- 单项恢复直接删除对应显式覆盖；颜色分组恢复直接删除全部颜色覆盖，并一次保存，不重置工具栏／默认选项；均先取消未应用草稿。工具栏恢复不改颜色；恢复后沿用主题／CSS snippet／Style Settings，可能不是插件硬编码初始色。颜色更新不重新搜索、不移动当前项、不写笔记。

依据：`src/features/settings/ui/settings-view.ts` 的 `section()`／`reset()`／`clearPreview()`／`refreshPreview()`／`toolbar()`／`colors()`、`settings-select.ts:createSettingsSelect()`、`appearance-styles.ts`、`color-picker.ts`、`ToolbarPreview.vue`，`src/features/settings/application/settings-controller.ts` 和 `src/features/finder/ui/FinderToolbar.vue` 的 preview 分支；回归：`tests/integration/main-settings.test.mjs`、`tests/component/settings-select.test.mjs`、`color-picker.test.mjs`、`tests/unit/appearance.test.mjs`、`tests/component/finder-panel.test.mjs`。

## 历史交互

- 单纯输入不立即记录。匹配导航记录非空查询，不要求一定有匹配；阅读导航还检查当前不处于 unsupported／error。
- 同查询连续导航只计一次使用，后续更新时间；A → B → A 开始新周期。明确复用计一次，紧接导航不重复计数。
- 第一行 ArrowUp 从当前排序首项向较旧／低优先级项浏览；最后一行 ArrowDown 向前返回，离开历史浏览时恢复暂存输入。未进入历史浏览时 ArrowDown 清空非空查询。
- 浏览身份是精确文本。重排保留当前项；删除或裁剪当前项时优先转到原排序的下一个存活邻近项，无则前一项。列表清空恢复暂存输入；手动输入退出浏览。订阅修复结果不主动滚动笔记。
- 复用作用于操作时当前可搜索 Markdown 视图；成功才关闭弹窗，失败保留弹窗并提示。不因为打开历史弹窗就固定未来复用目标。
- 复制使用所属 Modal Document 的 Clipboard，只复制精确文字，不更新时间／次数或请求保存；复制拒绝提示失败，异步完成不修改历史或复活删除项，弹窗销毁后不显示迟到错误。
- 选择以精确文本为身份；重排不改变选中对象。订阅通知同步刷新多个弹窗、容量和详情，删除的详情对象退出详情页。
- 删除立即更新内存并请求保存，无确认弹窗。详情删除返回列表；当前弹窗最近一次历史／预设删除提供 8 秒撤销，关闭后不保留撤销状态。历史撤销按精确文字合并，不覆盖更新后的时间／次数，且继续遵守容量；预设撤销不覆盖同 ID 新对象。保存失败不回滚可见修改。
- 容量输入仅完整十进制整数 1–200 有效，Enter／blur 提交，无效输入恢复当前值；缩容立即按独立 `historyRetention` 裁剪。改列表排序不改策略；旧配置缺失策略时继承原排序（含创建时间），避免升级改变既有淘汰偏好。
- 历史常显多选控件，不设管理模式；全选只作用于当前筛选结果，不丢失其他已选身份，取消选择清除全部选择。切换分类清除选择。工具条在列表滚动区外，高度不随选择改变。查看详情／编辑使用同一稳定尺寸弹窗，返回保留筛选、列表位置与可恢复的触发器焦点；筛选无结果与空库分别提示，不缩小外壳。列表无底部常驻说明；撤销以短暂浮层显示，不推动列表。
- 历史列表只保留整行一层悬停背景，查询复用区、复选框及详情／复制／删除图标不叠加第二层背景；保留手形指针、图标颜色反馈、选中行及键盘焦点，操作目标仍独立。查询下方独立统计行统一展示使用次数、精确 UTF-16 长度（含空白／换行，与详情一致）及相对时间，三项采用相同小字号、次级文字色和正常字重，整组右对齐到操作列右边缘。统计行横跨查询／操作列，不占用查询列宽度；窄屏换行仍整体右对齐。不显示“最后使用”等字段前缀，但以读屏专用文本保留时间含义，查询按钮通过所属 Document 内唯一的 aria-describedby 引用统计组，不添加容器悬浮提示。创建排序取创建时间，最近使用／使用次数排序取最后使用；有效时间戳 0 不回退。展示、选择和复制不增加使用计数。
- 历史详情将次数、长度、创建及最后使用完整时间固定在原文上方，底部文字操作固定，仅中间完整原文滚动；低高度也不把统计并入原文滚动区。复制／保存预设／删除均保留文字按钮，删除为危险操作样式，继续沿用即时删除与撤销契约。详情返回、预设取消／返回编辑、关闭保护中的继续编辑等次要操作使用轻填充加细边框，保留键盘焦点，不改真实 Finder 或宿主其他按钮。
- 历史统计统一进一步缩小 1px（最小 10px），保持整组右对齐及三项一致。历史／预设列表的删除图标常态显示主题危险色，悬停／键盘焦点加粗图标描边但不叠背景，区别于复制／详情／编辑；名称、独立操作目标和即时删除／撤销行为不变。

### 预设

- 列表不显示弹窗标题，不保留标题行空位；分类导航使用 owner 内唯一读屏文本命名，不新增悬浮提示。新建加号位于预设内容工具条的“X 个预设”前，保留功能名称／提示，历史分类不放新建按钮或空占位。分类 Tab 增加内边距／圆角悬停底色，选中下划线与 hover 分离，切换分类不移动筛选及列表。
- 预设整张卡片统一提供主题悬停及键盘焦点反馈，不新增持久选中状态；中间应用按钮透明且无独立 hover 内框，避免接缝／贴字。名称／预览应用区、编辑／删除和新建使用手形指针，操作目标仍独立；拖动柄使用抓取指针，通过 owner 内唯一 aria-labelledby 文本及独立排序说明命名，不添加 aria-label／title／setTooltip。静态摘要子区域不增加独立点击目标或提示，键盘焦点及排序操作保持。
- 列表查找／替换值使用同一 Grid 列宽；窄屏匹配图标另起一行，两值区仍等宽。值框固定单行显示第一行，过长省略；首行空白不跳过，多行在值框右端显示换行图标及实际行数，不占额外一行。按 CRLF／CR／LF 分行，连续／末尾换行计入，字面量反斜杠转义和软折行不计。读屏及应用保留精确全文，折叠预设仍隐藏替换行。
- “应用查找／替换预设”打开预设分类；“将当前查找保存为预设”在命令执行时捕获当前 owner 的配置，之后切换视图不改变待保存快照。打开管理不要求可搜索视图，应用目标仍在操作时解析；失败保留弹窗并提示，成功关闭。
- 预设仅用于快速填充搜索栏，保存完整查找选项及可选替换对象，`null` 表示仅查找，`text: ""` 表示删除匹配。替换转义始终跟随全局 `useEscapeCharInReplace`，预设不提供独立开关、不覆盖全局偏好；旧 `interpretEscapes` 字段兼容保留，但不参与解析。
- 应用一次设置所有选项后再匹配，不写正文；保留已锁定选区及失效限制，不使用预设保存坐标。替换行按独立 collapse 状态恢复，折叠仍保存替换值；无替换对象则清空旧替换值。旧版预设按有替换则展开、无替换则收起迁移。阅读仅加载查找部分并强制收起，不切换模式或遗留可写替换。
- 编辑／重命名为显式草稿，应用或修改 Finder 不回写预设。“保存”保留当前 ID，“另存为预设”先进入同一弹窗内的命名步骤，不立即落盘或套第二个 Modal。预填当前草稿名称并全选，名称非空且未被占用才允许“创建预设”，创建新 ID 并追加，原条目不变；“返回编辑”保留查询／替换／选项及原名称草稿。命名步骤关闭也需明确丢弃，继续编辑回焦当前命名输入。删除后的旧编辑器不能直接更新复活条目，允许另存；卸载必须强制释放弹窗。
- 名称按 trim 后精确文本比较、区分大小写，不折叠内部空白。新建／改名／另存均在名称下提示重复，输入以 aria-invalid／aria-describedby 关联错误；编辑校验排除自身 ID。PresetController 写入时按最新集合再次校验，重名拒绝不分配 ID、不修改数据、不请求保存；不默默覆盖或合并。旧数据重名的不同 ID 全部保留，在列表提示改名。撤销恢复若同 ID 或名称被占用，保留现有条目并说明，原 8 秒撤销窗口内可解除冲突后重试。
- 历史创建预设只复制查询文字，明确从普通文本、所有匹配选项关闭及无替换开始；用户在保存前补齐规则，不猜测历史当时的正则模式。
- 预设持久化及多弹窗更新独立于历史开关／容量；不保存文件、选择坐标、当前匹配、UI 筛选或像素位置等临时状态。
- 预设列表以 Finder 样式展示查找／替换行、折叠箭头及固定正则／大小写／全字匹配三个静态设置图标，不跟随真实工具栏顺序／placement，不显示上一项、下一项、替换、全部替换、历史、More 或不随预设保存的选区状态。左侧整高拖动区与中心摘要、竖排编辑／删除为兄弟按钮；点击摘要或原生 Enter／Space 一次应用，操作按钮不触发应用，无匹配器／假结果／可执行的替换。编辑不再嵌入 FinderRecipeFrame：匹配图标单独分组，为 aria-pressed 按钮，只修改草稿，不提交或抢输入焦点。查找和替换始终以独立四行 textarea 编辑，不随折叠配置隐藏；包含替换、应用后收起集中在最下方，两项均在控件下常显简短说明并以 aria-describedby 关联，不新增容器悬浮提示。取消不保存；保存更新当前 ID／新建时创建，另存为预设总是创建新 ID。未包含的替换输入仍保留在草稿，不自动勾选或持久化；空替换删除语义有明确说明。
- 仅从手柄发起鼠标／触屏 pointer 拖动，越过阈值才进入排序，显示插入线，边缘自动滚动，松手按 ID 边界提交。Escape、pointercancel、失去捕获／窗口焦点、列表变动及销毁取消并释放事件／动画帧；键盘上下／Home／End 移动并保持手柄焦点。筛选非空时禁用手柄并说明。编辑／重命名不改位置，新建／另存为追加，撤销删除尽量恢复原位；首次迁移沿用旧可见名称排序，之后用户顺序优先。

预设拖动捕获缺失／抛错时继续使用所属 Document 监听，释放捕获异常不阻断其余清理；松手重新计算最终指针位置，不复用最后一次 move 的旧边界。回归：`search-library.test.ts` 的 throwing pointer capture／release coordinate，浏览器 harness 的 synthetic touch-pointer capture failure 与不同松手位置；不代表原生触屏事件验收。

依据：`src/features/finder/application/finder-session.ts:recordSearchToHistory()`／`setVisibleFromHistory()`，`interaction/input-shortcuts.ts`；`src/features/history/ui/HistoryPanel.vue` 的订阅／select／copy；`src/features/history/model/history.ts`；`src/features/settings/ui/settings-view.ts:renderPage()`。数据规则见 [architecture](../architecture.md#持久化数据格式)。

## 设置搜索与生命周期

- 1.13+ 的全局设置搜索消费公开定义：基础项／六项颜色逐项对应可操作控件，选区和工具栏通过配置区名称／aliases 命中；不隐藏非当前分类定义以免丢失索引，不使用空数组或幽灵搜索行。
- 新版宿主控制分组及外观子页导航；复杂外观区初次展开，用户仍可折叠。旧版继续五分类。所有开关、历史整数 Enter／blur 提交、排序、颜色应用／取消、单项／分组恢复及工具栏排序均通过同一控制器；保存不阻塞导航，读取失败仍禁止覆盖磁盘。
- 搜索索引注册不挂载预览、不读盘；外观 render 只在可见页挂载，同 Document 共享预览。开启其他行调色器、位置菜单或拖动会关闭既有交互；行重渲染／子页返回／切 Tab／关闭／插件卸载释放预览、草稿、拖动监听和菜单。旧节点不能再次修改外观配置。

依据：`src/features/settings/ui/settings-definitions.ts`、`settings-fields.ts`、`settings-view.ts`、`tests/integration/main-settings.test.mjs`；宿主搜索结果的真实滚动／聚焦和窗口迁移需实测。

## 阅读状态与错误

- 等待立即显示计数标记 `…`，持续 400ms 后显示外置状态提示；查询／文件变化、关闭会重置提示延迟。
- 不支持／失败／超时显示 `!` 与状态说明，不冒充无结果；失败和超时提供重试，不支持只提供原生入口。
- 默认最多等待渲染 5 秒，以渲染回调后的微任务及约 100ms 检查补充；该期限不限制正则计算。Worker 初始化在查询发送前最多等待 3 秒，失败选择同步兼容；发送后的计算没有执行期限，可关闭／取消终止线程。
- 请求绑定查询选项、视图、文件及渲染器；同查询后台刷新保留等待中的用户导航意图，连续导航累计净方向并循环定位。过期回调不能定位或发布结果。
- 阅读导航先挂载分块、展开必要列表／Callout／details 祖先，然后定位首个文本端点；不恢复折叠状态。跨块匹配只绘制挂载部分。
- 打开时统一使用插件，不再提供使用原生查找的设置；旧 `useObsidianSearchInRead` 无论 true／false 均清理且不参与路由。不支持时提示并回退，运行失败可主动降级，降级关闭插件面板以避免两套入口同时可见。归一化迁移沿用已有保存保护，不因移除偏好绕过读取失败禁止覆盖的约束。
- 存储／复制／复用错误由插件 Notice 提示，按全局 5 秒间隔节流；读取失败禁止写入，保存失败保留内存修改。

依据：`src/features/finder/ui/SearchStatus.vue`、`src/features/reading/dom/reading-search.ts` 的 `search()`／`run()`／`scroll()`／`clear()`、`src/app/workspace-runtime.ts` 的 `showFinder()`／`openNativeSearch()`、`src/app/create-plugin-runtime.ts:reportError()`。

## Worker 兼容与错误

- Worker API 缺失、构造失败或查询发送前初始化失败，当前通道在同一窗口内使用同步兼容路径，并提示复杂正则可能阻塞；窗口变化重新探测。取消不触发降级。
- 查询发送后出现错误（包括消息派发／解码失败）进入明确失败状态；普通重试重建 Worker，另提供带风险文案的“同步重试”。不因查询慢或无效正则自动重放。
- 编辑／阅读匹配等待均显示 `…`，400ms 后状态面板提供“取消并关闭”，该按钮只隐藏／清理，不额外恢复宿主模式。既有用户关闭入口仍遵守统一关闭契约。
- 替换前取消未完成查找；提交前后台刷新同一有效快照不取代任务。替换输入变化、导航及生命周期失效取消候选；连续替换取代旧候选，不排队写旧文档。提交中自身 editor-change 事件不重入替换或取消后续重算。
- 等待文案区分“尚未写入”与“已完成、正在更新匹配”。提交后取消只停止后续计算／定位，不撤销正文。候选失败的重试继续替换操作，必须重新核验身份；提交后失败只允许重新查找，不重复写入。

依据补充：`src/features/finder/application/finder-session.ts:replaceMatches()`／`replacementCurrent()`、`src/platform/browser/match-engine.ts:replace()`、`tests/component/finder-panel.test.mjs` 的 candidate invalidation／post-commit／same-file split 回归。

依据：`src/platform/browser/match-engine.ts`、`src/features/finder/application/finder-session.ts:setFindText()`／`cancelEditing()`、`src/features/reading/dom/reading-search.ts:acceptMatches()`、`tests/integration/match-engine.test.mjs`、`tests/component/finder-panel.test.mjs`。
