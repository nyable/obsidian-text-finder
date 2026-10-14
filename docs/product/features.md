# 产品能力与边界

本文件记录当前源码可确认的功能；已批准的关闭语义见 [interactions](interactions.md#已批准的关闭契约)。源码事实不等于真实 Obsidian 验收通过，验证边界见 [compatibility](../compatibility.md)。

## 范围与入口

- 编辑模式搜索／替换所属视图的 Markdown 源码（默认全文，可明确限定精确选区），包括源码中的标记。
- 阅读模式搜索当前笔记的渲染正文，不支持替换；两个模式的匹配数量可以不同。
- 插件注册命令和设置页，默认通过命令懒创建；“常规”页可开启打开笔记时显示悬浮搜索入口（默认关闭），已有笔记及新分屏各自显示小图标，不抢焦点、不自动搜索。未注册 Ribbon 或笔记右键菜单入口；桌面边缘标签有关闭／恢复菜单，移动端长按不弹该菜单。未定义默认快捷键，用户在 Obsidian 中自行分配。

依据：`src/editor-extension.ts` 的 `registerCommand()`／`getFinder()`、`src/SearchBox.svelte` 的 `setFindText()`／`prepareReplacement()`；使用说明见 `README-zh_CN.md`。

| 命令 ID | 能力 | 目标 |
| --- | --- | --- |
| `text-finder-show-find` | 打开查找 | 编辑／阅读 |
| `text-finder-find-in-selection` | 捕获精确选区并打开查找，保留已有查询 | 编辑 |
| `text-finder-show-find-and-replace` | 打开查找与替换 | 编辑 |
| `text-finder-hide-find` | 关闭查找 | 当前 Markdown 视图 |
| `text-finder-reset-position` | 恢复查找框默认位置 | 当前 Markdown 视图的已有 Finder，不创建新实例 |
| `text-finder-toggle-find` | 切换查找显示 | 当前 Markdown 视图 |
| `text-finder-toggle-replace` | 切换替换区域 | 编辑 |
| `text-finder-previous-match` | 上一个匹配 | 编辑／阅读 |
| `text-finder-next-match` | 下一个匹配 | 编辑／阅读 |
| `text-finder-replace` | 替换一次 | 编辑 |
| `text-finder-replace-all` | 全部替换 | 编辑 |
| `show-search-history` | 打开历史弹窗 | 打开不要求 Markdown 视图；复用要求可搜索视图 |

## 查找与替换

- 输入即重新匹配；支持大小写、全字匹配选项、数量、当前项、循环导航及高亮。
- 编辑／阅读查找优先在所属窗口的 Worker 执行匹配，不限制正则语法或匹配数量。启动不可用时提示并使用同步兼容路径；执行中故障显示错误，不自动在主线程重跑。用户可明确选择同步重试。
- 替换候选与替换后重算同样优先 Worker；正文写入仍为同步 CodeMirror 事务。阅读 DOM 索引／端点／绘制、结果解码和事务仍在主线程，不能承诺所有操作都不会阻塞。
- 普通文本按字面量搜索，非重叠匹配；不先把原文转成小写，偏移为原文 UTF-16 坐标。
- 正则使用 JavaScript `RegExp`，flags 为 `g`、正则模式下的 `m` 和大小写不敏感时的 `i`。没有单独 flags 输入；全字匹配可与正则组合。
- 全字匹配默认关闭，在共享匹配循环中按 VS Code 默认 `editor.wordSeparators` 过滤完整匹配的两端，不改写正则、捕获组或 UTF-16 坐标。首尾、空格／Tab／CR／LF 和默认 ASCII 分隔标点构成边界；匹配自身首尾的分隔符也满足对应边界。下划线、全角标点、NBSP、中文及组合标记不作为分隔符，不执行中文分词。例如 `cat` 匹配 `cat-dog` 但不匹配 `cat_name`，`中文` 不匹配 `中文内容`，`C++` 匹配 `C++17`。编辑／阅读／替换及 Worker／同步路径共用判定。
- 空查询、空正文、无结果、无效正则均返回空匹配；零宽匹配不计数、不替换。无效正则当前没有独立语法错误界面。
- 单次替换和全部替换基于当前原文重新计算。全部替换通过一个 CodeMirror changes 事务提交，不递归处理新插入文本。
- 单次替换只展开目标模板，不预先创建所有候选插入文本；不限制既有捕获、前缀／后缀或转义能力。
- 正则替换支持 `$1`–`$99`、`$<name>`、`$&`、`$$`、原文前缀 `` $` `` 和后缀 `$'`；遵循 JavaScript 模板语义。
- 正则模式且转义设置开启时，替换输入单次解析 `\n`、`\t`、`\\`；未知转义、末尾反斜杠和真实 NUL 保留。普通文本替换不展开美元模板或反斜杠转义。

依据：`src/util/text-helper.ts` 的 `findTextMatches()`／`prepareReplacements()`／`expandReplacement()`；`src/SearchBox.svelte` 的 `adjustReplaceText()`／`replaceText()`。回归：`tests/text-helper.test.mjs`、`tests/regex-replacement.test.mjs`、`tests/replacement.test.mjs`。

全字边界依据：`src/util/text-helper.ts:isWholeWordMatch()`；上游对照 [VS Code `isValidMatch()`](https://github.com/microsoft/vscode/blob/3fd165bbb0d1dcafd9e3df36c3aa26474c6ecb85/src/vs/editor/common/model/textModelSearch.ts) 和 [`USUAL_WORD_SEPARATORS`](https://github.com/microsoft/vscode/blob/3fd165bbb0d1dcafd9e3df36c3aa26474c6ecb85/src/vs/editor/common/core/wordHelper.ts)。这是默认边界规则对照，不表示整个正则引擎／flags 与 VS Code 完全一致。

多行边界细节：CR／LF 在匹配范围外时形成边界；若换行本身属于匹配首尾，不单凭该换行放行，需要继续满足外侧字符／正文首尾边界。回归见 `tests/text-helper.test.mjs` 的多行样例。

## 精确选区查找／替换

- 编辑模式提供“在选定内容中打开查找”命令与工具栏开关，默认关闭，按钮默认位于 More；可配置常驻／更多／隐藏，但没有默认开启或跨行扩大整行设置。
- 范围为精确 UTF-16 源码字符；跨行不扩行，多选区不包含空隙、不拼接；只接受完整包含的匹配。所有导航及替换入口共用范围。
- 范围独立于当前选择，导航不重捕获；正文用淡背景、不加下划线，启用以按钮激活态为准，不在计数旁增加状态文字。按钮在 More 中时，收起的 More 用强调色圆点提示内部模式开启，展开隐藏圆点且不使用模式激活配色，隐藏按钮则不另加标记；空／失效范围仍保持限制、选区按钮激活及恢复提示。编辑事务映射范围，生命周期失效及关闭后的隐藏替换均不得默默扩大为全文。
- 匹配从每个范围起点在原文扫描，前后顾、锚点、全字边界及替换模板仍使用全文上下文；不是在切片上重新匹配。原范围外前缀的非重叠匹配不占用范围内起点，例如 `aaa` 中选后两个字符搜索 `aa` 可以命中。
- 仅编辑源码／实时预览，阅读保持全文正文查找。范围不保存到设置或历史；同文件双分屏各自独立。

依据：`src/search-scope.ts`、`src/util/text-helper.ts:findTextMatches()`、`src/SearchBox.svelte:findInSelection()`／`scopeRanges()`、`src/match-engine.ts`。回归：`tests/search-scope.test.mjs`、`tests/match-engine.test.mjs`、`tests/search-box-dom.test.mjs`；宿主实际范围绘制／输入选区仍需实测。

## 阅读模式正文

- 行内格式和链接显示文本连续，可跨节点匹配；链接目标和隐藏 Markdown 标记不作为阅读正文。
- 块边界合成换行，`<br>` 保留硬换行且连续硬换行不合并；表格单元格间用制表符，连续空单元格保留分隔。
- 普通 ASCII 空白折叠、行尾待定空白丢弃；NBSP 不折叠，`<pre>` 保留原始空白，视觉自动换行不产生文本换行。
- 全文索引包含离屏分块，排除页眉／页脚。只覆盖合成分隔符、没有真实文本端点的匹配不计数。
- 排除嵌入笔记、属性控件、公式、Mermaid、Dataview／DataviewJS、阅读控件及明确隐藏内容。折叠列表／Callout 正文有专门保留规则。
- 不承诺任意第三方动态输出、伪元素文字、图片、Canvas 或 iframe 内容的全文兼容。
- 不支持环境回退原生查找；渲染失败／超时提供重试和原生入口。

依据：`src/reading-text.ts` 的 `excluded`／`indexReadingText()`、`src/reading-search.ts` 的 `run()`、`src/editor-extension.ts` 的 `showFinder()`。索引与端点机制见 [architecture](../architecture.md#阅读索引与高亮机制)。

## 历史与工具栏

- 历史提供查看、复用、复制、详情、单项删除、全选／取消全选和批量删除；删除没有额外确认步骤。
- 查询身份是精确文本，空白有效、空字符串无效。使用周期、排序、复制及复用流程见 [interactions](interactions.md#历史交互)。
- 历史容量为 1–200；按创建时间、最近使用时间或使用次数降序排序，缩容按当前排序淘汰。
- 禁用历史保留已有记录，停止记录／统计及输入框上下键历史导航；命令仍可打开弹窗，已有记录仍可操作。工具栏历史按钮禁用。
- 搜索／替换工具栏分别支持顺序及 `inline`（常驻）、`more`（更多）、`hidden`（隐藏）；隐藏按钮不移除命令能力。
- 支持拖动、上下按钮、手柄方向键排序和单栏恢复默认；关闭按钮与展开替换入口固定。
- “外观”设置页顶部固定完整实时纯展示预览，下方颜色及工具栏配置独立滚动；颜色、搜索栏按钮、替换栏按钮三个分组可独立折叠，默认全部折叠，预览始终展开两行，无任何操作。分类 Tab 提供悬停、选中、按下及键盘聚焦样式。每个按钮使用独立配置块，左侧整高拖动区，上层身份／排序、下层显示位置／默认开关；正则、大小写及全字匹配项支持默认开启。分组标题旁的回退图标提示“恢复默认设置”，点击直接恢复，仅作用于本组；搜索栏同时恢复布局及三个默认选项，替换栏仅恢复布局，不改变已有 Finder 或颜色。颜色整组和单项恢复也直接执行，无确认框，统一提示“已恢复默认设置”。
- 外观页按钮显示位置使用主题化自定义下拉，支持鼠标／键盘、当前项勾选和视口边缘上翻；导航不修改配置，明确选择不同值才保存，保持现有显示位置含义。“默认开启”文字与开关采用局部居中布局；历史分类的排序下拉不变。依据：`src/settings-select.ts`、`src/settings-tab.ts`、`tests/settings-select.test.mjs`、`tests/main-settings.test.mjs`。
- 预览查找词固定为 `text`，替换框无内容、显示 placeholder；下方正文区随文字实际行数自适应高度，以固定英文展示一个当前匹配和两个普通匹配，复用编辑高亮的 CSS 类及颜色变量，不执行真实匹配。
- 外观页提供聚焦边框／装饰条、普通匹配背景／文字、当前匹配背景／文字六项颜色；点击色块打开 vanilla-colorful 的颜色／色相／透明度面板，支持 alpha 十六进制输入。调色只更新预览草稿，点击“应用”才一次更新真实编辑／阅读样式及保存；取消或离开页面丢弃草稿。单项或颜色分组恢复移除覆盖，继续继承 CSS snippet／Style Settings／主题，不影响工具栏配置。

依据：`src/history.ts`、`src/HistoryModal.svelte`、`src/HistoryList.svelte`、`src/Toolbar.svelte`、`src/settings-tab.ts` 的 `toolbar()`。

## 面板避让

- 桌面编辑／阅读统一直接拖动左侧装饰条，约 3px 位移启动，无长按等待；扩大命中区不覆盖折叠箭头。折叠箭头仅负责替换行，不再承担移动或附带移动说明。移动端手柄在结果栏顶部中央：小横条配 72×30px 拖动区，远离面板侧边，计数／关闭不作为拖动区；原折叠箭头和 More 原位。实际拖动时透明度 80%，松手／取消恢复；移动入口用 aria-labelledby 保留读屏名称，不产生 aria-label／title 悬浮提示。
- 移动端按实际按钮尺寸保留输入可用宽度，放不下的常驻动作后缀搬到结果栏，More／隐藏操作不搬；复用原按钮节点、保留排序和焦点，不改设置。恢复宽度后回流；结果栏可换行、计数可省略但读屏仍保留全文。
- 移动端结果栏与单行搜索框均以 40px 为基础外高，输入行统一留白；替换展开面板自然增高，不继承桌面固定高度／行间隙。输入明确 border-box、上下 padding、行高与字号，避免宿主默认内边距挤占单行空间；保留 textarea、换行文本和 overflow auto，不以隐藏溢出掩盖尺寸。实际空输入滚动、长文本光标和软键盘表现需真机复测。
- “拖到边缘时自动收起”默认关闭，开启后拖近左右边缘松手才收起。宽度达到可用宽度 85% 时改用横向位移至少 56px 且超过纵向 1.4 倍的意图，不因满宽或上下移动误收起。非满宽需有朝边缘至少 12px 的移动及 16px 内边缘距离；预览可撤回，取消不收起，阈值为实机待调初值。
- 收起为桌面 30px／移动端 40px 的查找标记（16px 图标、无面板阴影），可直接二维拖动；松手靠边吸附，不靠边保持紧凑状态停留，不强制回边缘。拖动不展开，单击展开不聚焦输入；桌面右键菜单提供关闭／恢复，移动长按不弹菜单、不因松手误展开，仍可按住后拖动；关闭命令及 Escape 仍可用。展开围绕标记位置限制在视图内，满宽水平居中、保留高度；不因展开靠边而再次收起。查询、替换行、当前项及高亮保留。
- 收起标记采用主题次级背景、细边框、正文色图标及 8px 圆角，悬停／按下与键盘焦点沿用主题交互色，不改变标记尺寸或公开 CSS 接口。自动显示入口首次按历史左右侧偏好靠安全边界（缺省右侧、保留 8px 留白），无需开启拖边自动收起；移动端收起态与完整框居中规则分离，完成布局后重新校正。后台不可测量时等待布局恢复，不覆盖之后的手动停放。深浅主题及首次显示位置待实机验收。
- 移动收起图标／中央手柄从按下开始隔离宿主冒泡滑动，尽早捕获指针并在 Document 捕获阶段处理同指针；并行 Touch 事件只保护同手指、不重复位移。正文左右侧栏手势、输入框触摸／选词、桌面拖动不作全局屏蔽；真实 pointercancel 保留回滚。Android 侧栏误触／拖不动修正需实机复测，不保证原生系统手势或更早的宿主捕获监听。
- 方向键移动 8px、Shift＋方向键 32px，Home／恢复位置命令恢复默认；常规设置的恢复入口作用于已有各视图，不占面板按钮。位置仅保留到具体视图销毁，不保存像素坐标。
- 收起时“显示／切换查找”均展开并聚焦查询，不关闭图标、不用选区覆盖已有查询；编辑模式的“打开查找与替换／切换替换区域”展开并确保替换栏显示、聚焦替换输入。完整框已展开时切换命令才执行正常开关；点击图标仍不聚焦输入。自动入口点击在阅读模式沿用原生偏好和不兼容降级。
- 收起不是关闭，不执行清空输入或源码模式恢复；正常关闭仍遵守原契约。收起放弃尚未完成的导航意图但保留计算，后续命令导航仍可用。替换候选／提交后重算期间禁止收起；收起时执行替换命令先展开显示进度。
- 位置限制在 owner 可见边界与 VisualViewport 的交集，考虑安全区；移动端以垂直避让为主，resize／键盘／视口滚动后重新约束。More 和状态提示随位置更新，菜单可上翻并限制尺寸。没有自动收起、惯性或宿主正文布局改写。

依据：`src/finder-position.ts:createFinderPosition()`、`src/SearchBox.svelte:dockFinder()`／`expandFinder()`／`positionFinder()`、`src/reading-search.ts:pauseNavigation()`。回归：`tests/finder-position.test.mjs`、`tests/search-box-dom.test.mjs`；移动端软键盘与宿主几何仍待实测。

## 设置语义

默认值的唯一代码来源为 `src/settings.ts:defaultSettings()` 和 `src/toolbar.ts:defaultToolbar()`。

| 设置页 | 字段 | 默认／语义 |
| --- | --- | --- |
| 常规 | `showFloatingFinderOnOpen` | 默认关闭；打开 Markdown 笔记时显示收起的小图标，启用后也应用于已有笔记；不自动搜索或抢焦点，主动关闭后同视图同笔记不因标签激活而重现 |
| 查找 | `clearAfterHidden` | 默认关闭；清空范围的已批准约束见 interactions |
| 查找 | `enableInputHotkeys` | 默认开启；输入框 Enter 快捷操作 |
| 查找 | `useSelectionAsSearch` | 默认开启；打开时取所属视图选区 |
| 查找 | `sourceModeWhenSearch` | 默认开启；编辑匹配定位时强制源码模式 |
| 查找 | `moveCursorToMatch` | 默认开启；选中当前编辑匹配 |
| 查找 | `useObsidianSearchInRead` | 新安装默认关闭；已有显式原生偏好保留 |
| 兼容字段（无控件） | `finderDockSide` | 保留历史 left／right 值，缺省 right；新手势由拖动方向选择两侧，不覆盖历史持久化值 |
| 常规 | `finderAutoDock` | 默认关闭；完整框拖动松手时自动贴边收起，左右均可；不保存临时位置 |
| 替换 | `useEscapeCharInReplace` | 默认开启；仅作用于正则替换 |
| 历史 | `enableHistory` | 默认开启 |
| 历史 | `historyMaxCount` | 默认 10；1–200，Enter／blur 提交 |
| 历史 | `historySortOrder` | 默认 `lastUsedAt` |
| 外观 | `searchToolbar` | 正则、大小写、全字匹配、上一项、下一项常驻；历史隐藏。精确旧默认及上一版末尾追加全字的默认布局迁移到此顺序；其他自定义布局保留顺序及位置并追加缺失动作 |
| 外观 | `replaceToolbar` | 单次替换、全部替换常驻 |
| 外观 | `defaultRegexMode` | 默认关闭；仅初始化新建视图查找器的正则选项 |
| 外观 | `defaultCaseSensitive` | 默认关闭；仅初始化新建视图查找器的大小写选项 |
| 外观 | `defaultWholeWord` | 默认关闭；仅初始化新建视图查找器的全字匹配选项 |
| 外观 | `appearanceColors` | 默认 `{}`，仅保存显式设置的六项十六进制颜色；空项目继续继承现有公开 CSS 变量 |

设置页控件是 Obsidian 原生 `PluginSettingTab`／`Setting` 和 DOM 实现；预览挂载 `src/ToolbarPreview.svelte` 并复用 `src/Toolbar.svelte`。依据：`src/settings-tab.ts`。

## 非能力

没有实现阅读模式选区查找、跨行扩大整行或拖动调整面板宽度；`.nya-dragger` 注释不是产品承诺。未见跨 Vault 搜索或独立清空全部历史按钮。

依据：`src/SearchBox.svelte` 的 `.nya-dragger`／范围逻辑、`src/editor-extension.ts:registerCommand()`、`src/HistoryList.svelte`。
