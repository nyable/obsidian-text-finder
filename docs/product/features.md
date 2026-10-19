# 产品能力与边界

本文件记录当前源码可确认的功能；已批准的关闭语义见 [interactions](interactions.md#已批准的关闭契约)。源码事实不等于真实 Obsidian 验收通过，验证边界见 [compatibility](../compatibility.md)。

## 范围与入口

- 编辑模式搜索／替换所属视图的 Markdown 源码（默认全文，可明确限定精确选区），包括源码中的标记。
- 阅读模式搜索当前笔记的渲染正文，不支持替换；两个模式的匹配数量可以不同。
- 插件注册命令和设置页，默认通过命令懒创建；“常规”页可开启打开笔记时显示悬浮搜索入口（默认关闭），已有笔记及新分屏各自显示小图标，不抢焦点、不自动搜索。笔记右上角“更多选项”提供“Text Finder：打开查找”，行为与普通命令一致、遵守设置。正文有非空选择时，编辑／阅读右键提供“以选中内容查找”（清旧范围、选中文字作为全文查询）和“在选区中查找”（锁定所选范围、保留查询）。阅读普通／选中文字查询统一使用插件，不兼容时回退原生，范围操作不以原生全文冒充。未注册 Ribbon；桌面边缘标签有关闭／恢复菜单，移动端长按不弹该菜单。未定义默认快捷键，用户在 Obsidian 中自行分配。

菜单按所属视图路由，打开时不创建 Finder／启动匹配；选择操作保存菜单打开时的选择，正文或 owner 身份变化后拒绝过期操作。阅读右键依赖可检测的内部 `Menu.forEvent()` 合并宿主菜单，缺失时不另建菜单；纯正文保留复制选中文字，链接仍贡献其原有菜单。实机及移动端菜单呈现待验收。

依据：`src/app/workspace-commands.ts:registerWorkspaceCommands()`、`src/app/workspace-runtime.ts:getFinder()`、`src/features/finder/application/finder-session.ts` 的 `setFindText()`／`replaceMatches()`；使用说明见 `README-zh_CN.md`。

| 命令 ID | 能力 | 目标 |
| --- | --- | --- |
| `text-finder-show-find` | 打开查找 | 编辑／阅读 |
| `text-finder-find-in-selection` | 捕获精确选区并打开查找，保留已有查询 | 编辑／阅读 |
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
| `text-finder-apply-preset` | 打开预设分类，选择后应用配置但不写正文 | 打开不要求 Markdown 视图；应用要求可搜索视图 |
| `text-finder-save-preset` | 捕获当前视图配置，打开命名保存表单 | 编辑／阅读 |

## 查找与替换

- 输入即重新匹配；支持大小写、全字匹配选项、数量、当前项、循环导航及高亮。
- 编辑／阅读查找优先在所属窗口的 Worker 执行匹配，不限制正则语法或匹配数量。启动不可用时提示并使用同步兼容路径；执行中故障显示错误，不自动在主线程重跑。用户可明确选择同步重试。
- 替换候选与替换后重算同样优先 Worker；正文写入仍为同步 CodeMirror 事务。阅读 DOM 索引／端点／绘制、结果解码和事务仍在主线程，不能承诺所有操作都不会阻塞。
- 普通文本按字面量搜索，非重叠匹配；不先把原文转成小写，偏移为原文 UTF-16 坐标。
- 正则使用 JavaScript `RegExp`，flags 为 `g`、正则模式下的 `m` 和大小写不敏感时的 `i`。没有单独 flags 输入；全字匹配可与正则组合。
- 全字匹配默认关闭，在共享匹配循环中按 VS Code 默认 `editor.wordSeparators` 过滤完整匹配的两端，不改写正则、捕获组或 UTF-16 坐标。首尾、空格／Tab／CR／LF 和默认 ASCII 分隔标点构成边界；匹配自身首尾的分隔符也满足对应边界。下划线、全角标点、NBSP、中文及组合标记不作为分隔符，不执行中文分词。例如 `cat` 匹配 `cat-dog` 但不匹配 `cat_name`，`中文` 不匹配 `中文内容`，`C++` 匹配 `C++17`。编辑／阅读／替换及 Worker／同步路径共用判定。
- 空查询、空正文、无结果、无效正则均返回空匹配；零宽匹配不计数、不替换。无效正则当前没有独立语法错误界面。
- 编辑模式下匹配包含真实换行时，在每个已匹配换行的行尾绘制非交互 `↵`（RTL 镜像），空白行也可见；沿用普通／当前匹配颜色。不把软折行或无换行的文末标记出来，连续换行属于一次匹配时计数仍为一项。只改变展示，不插入字符、修改排版或替换坐标；阅读模式不添加源码换行标记。依据：`src/platform/codemirror/search-highlight.ts:newlineMatchLayer`、`tests/integration/editor-whitespace.test.mjs`。
- 单次替换和全部替换基于当前原文重新计算。全部替换通过一个 CodeMirror changes 事务提交，不递归处理新插入文本。
- 单次替换只展开目标模板，不预先创建所有候选插入文本；不限制既有捕获、前缀／后缀或转义能力。
- 正则替换支持 `$1`–`$99`、`$<name>`、`$&`、`$$`、原文前缀 `` $` `` 和后缀 `$'`；遵循 JavaScript 模板语义。
- 正则模式且转义设置开启时，替换输入单次解析 `\n`、`\t`、`\\`；未知转义、末尾反斜杠和真实 NUL 保留。普通文本替换不展开美元模板或反斜杠转义。

依据：`src/core/search/text-matching.ts` 的 `findTextMatches()`／`prepareReplacements()`／`expandReplacement()`；`src/features/finder/application/finder-session.ts` 的 `adjustReplaceText()`／`replaceMatches()`、`replacement-operation.ts`。回归：`tests/unit/text-matching.test.mjs`、`regex-replacement.test.mjs`、`tests/integration/replacement.test.mjs`。

全字边界依据：`src/core/search/text-matching.ts:isWholeWordMatch()`；上游对照 [VS Code `isValidMatch()`](https://github.com/microsoft/vscode/blob/3fd165bbb0d1dcafd9e3df36c3aa26474c6ecb85/src/vs/editor/common/model/textModelSearch.ts) 和 [`USUAL_WORD_SEPARATORS`](https://github.com/microsoft/vscode/blob/3fd165bbb0d1dcafd9e3df36c3aa26474c6ecb85/src/vs/editor/common/core/wordHelper.ts)。这是默认边界规则对照，不表示整个正则引擎／flags 与 VS Code 完全一致。

多行边界细节：CR／LF 在匹配范围外时形成边界；若换行本身属于匹配首尾，不单凭该换行放行，需要继续满足外侧字符／正文首尾边界。回归见 `tests/unit/text-matching.test.mjs` 的多行样例。

## 精确选区查找／替换

- 编辑模式提供“在选定内容中打开查找”命令与工具栏开关，默认关闭，按钮默认位于 More；可配置常驻／更多／隐藏，但没有默认开启或跨行扩大整行设置。
- 范围为精确 UTF-16 源码字符；跨行不扩行，多选区不包含空隙、不拼接；只接受完整包含的匹配。所有导航及替换入口共用范围。
- 范围独立于当前选择，导航不重捕获；正文用淡背景、不加下划线，启用以按钮激活态为准，不在计数旁增加状态文字。按钮在 More 中时，收起的 More 用强调色圆点提示内部模式开启，展开隐藏圆点且不使用模式激活配色，隐藏按钮则不另加标记；空／失效范围仍保持限制、选区按钮激活及恢复提示。编辑事务映射范围，生命周期失效及关闭后的隐藏替换均不得默默扩大为全文。
- 匹配从每个范围起点在原文扫描，前后顾、锚点、全字边界及替换模板仍使用全文上下文；不是在切片上重新匹配。原范围外前缀的非重叠匹配不占用范围内起点，例如 `aaa` 中选后两个字符搜索 `aa` 可以命中。
- 编辑范围使用源码／实时预览的源码坐标；阅读范围使用渲染正文逻辑坐标，两者不自动互转。范围不保存到设置或历史；同文件双分屏各自独立。
- 可选轮廓为同一连续范围内完全选中且可见的普通空白行（含空格／Tab）补充连接区域；优先沿上下选中文字的共同宽度连接，无重叠时从测得的空白行插入点形成窄阶梯。不扩展为整行大框，不改变背景或实际范围；独立选区、折叠／隐藏源码和有歧义的 bidi 片段不强行相连。依据：`src/platform/codemirror/scope-geometry.ts:addScopeBlankLines()`。

依据：`src/platform/codemirror/search-scope.ts`、`src/core/search/text-matching.ts:findTextMatches()`、`src/features/finder/application/search-scope.ts`／`finder-session.ts:findInSelection()`、`src/platform/browser/match-engine.ts`。回归：`tests/integration/search-scope.test.mjs`、`match-engine.test.mjs`、`tests/component/finder-panel.test.mjs`；宿主实际范围绘制／输入选区仍需实测。

## 阅读模式正文

- 行内格式和链接显示文本连续，可跨节点匹配；链接目标和隐藏 Markdown 标记不作为阅读正文。
- 块边界合成换行，`<br>` 保留硬换行且连续硬换行不合并；表格单元格间用制表符，连续空单元格保留分隔。
- 普通 ASCII 空白折叠、行尾待定空白丢弃；NBSP 不折叠，`<pre>` 保留原始空白，视觉自动换行不产生文本换行。
- 全文索引包含离屏分块，排除页眉／页脚。真实 `<br>`、预格式文本换行及有正文两端锚点的块边界可单独匹配、计数和导航，并以 `↵` 显示；隔开排除内容的保护分隔符、末尾补齐分隔符不单独计数或造标记。视觉自动折行不是换行，Markdown 未渲染空行不凭空恢复。
- 阅读模式支持“在选定内容中打开查找”及同一工具栏开关：捕获所属 Document 中正文选区，按节点及数字端点反向映射，不用选中文字重搜位置。反向选择及浏览器提供的多 Range 可用；部分选中的折叠空白向内收紧，排除内容端点拒绝，不扩大到全文。正则仍使用完整正文上下文，完整匹配必须包含于单个范围。
- 锁定阅读范围后点击 Finder／导航不重捕获；同节点虚拟移出／挂回及纯主题重索引可保留，正文／节点映射／源快照／文件／renderer／Document 改变时失效，按钮保持不可用限制，需重选或关闭范围。空查询保留范围展示，关闭清理；普通打开统一使用插件并保留不兼容降级，显式选区命令不可静默降级为原生全文。
- 阅读选区背景用低优先级 Custom Highlight，边框与匹配换行用正文之外的非交互覆盖层，沿用外观色和左右紧／上下留白算法；仅对挂载内容测量，滚动／尺寸变化重绘。连续硬换行且测得同列的小间距可补连接；段落大间距、表格、嵌入及未知几何不强连。实际宿主选区及覆盖层待实机验收。
- 排除嵌入笔记、属性控件、公式、Mermaid、Dataview／DataviewJS、阅读控件及明确隐藏内容。折叠列表／Callout 正文有专门保留规则。
- 不承诺任意第三方动态输出、伪元素文字、图片、Canvas 或 iframe 内容的全文兼容。
- 不支持环境回退原生查找；渲染失败／超时提供重试和原生入口。

依据：`src/features/reading/dom/reading-text.ts` 的 `excluded`／`indexReadingText()`、`reading-search.ts:run()`、`src/app/workspace-runtime.ts:showFinder()`。索引与端点机制见 [architecture](../architecture.md#阅读索引与高亮机制)。

## 历史与工具栏

- 历史与预设共享稳定高度弹窗、分类及筛选入口，模型独立；列表不显示顶部标题或保留标题行空位。新建加号位于预设分类内容工具条的数量前，仅在预设分类显示。历史提供查看、复用、复制、详情、单项删除；每行直接勾选，工具条提供全选／取消全选、取消选择和批量删除，不需进入管理模式。删除无额外确认，最近一次删除可在当前弹窗 8 秒内撤销。
- 查询身份是精确文本，空白有效、空字符串无效。使用周期、排序、复制及复用流程见 [interactions](interactions.md#历史交互)。
- 历史列表在查询下方以同一小字号、次级文字色集中显示使用次数、字符长度与相对时间，统计组整体右对齐到操作列右边缘，窄屏右对齐换行，不挤压查询列。不显示时间字段前缀，读屏仍可区分创建／最后使用，并由查询按钮关联统计说明。创建排序取创建时间，其他排序取最后使用时间。整行单层悬停，统计展示不改变使用记录。详情顶部固定次数、长度及完整时间，只有完整原文独立滚动，底部保留文字操作按钮，删除使用危险操作样式。
- 历史容量为 1–200；列表按创建时间、最近使用时间或使用次数降序排序。容量裁剪独立使用保留策略，可优先保留最近使用或高频查询，并保留最近创建的兼容选项；旧数据按原排序初始化策略，之后切换排序不改变淘汰规则。复制不统计查找使用。
- 预设使用独立 ID，用于快速填充搜索栏，保存名称、精确查询、正则／大小写／全字选项、替换行折叠状态，以及可选替换值。替换转义统一跟随全局设置，不提供预设独立解析选项。折叠不丢失替换内容；空替换字符串表示删除匹配，与仅查找不同。预设为独立卡片，左侧手柄排序、中间配置摘要应用、右侧竖排编辑／删除；整卡悬停反馈不合并操作目标。摘要显示等宽单行值及右侧实际行数，仅展示三个匹配设置，不跟随真实 Finder 工具栏布局，不匹配、不显示假计数。支持新建、捕获当前 Finder、编辑／重命名、另存为、删除及短暂撤销；手动顺序持久化，筛选期间禁排，历史排序不受影响。不受历史关闭、清空或容量影响。无分组、变量模板、逐预设命令或批处理。
- 应用预设一次性填入配置并发起匹配，不自动替换、不修改全局默认值、不捕获新选区；保留当前选区及失效限制。恢复保存的替换行折叠状态，未保存替换对象时清除旧替换值；旧版仅查找预设默认收起。阅读仅应用查找部分，仍强制收起，不把替换值留给后续编辑模式、不切换模式。显式应用计一次历史使用，紧接导航不重复计数。
- 预设编辑是独立草稿，取消不保存，关闭有改动的草稿需明确丢弃；修改 Finder 不自动更新预设。名称去首尾空白后区分大小写且唯一，新建／改名／另存／撤销均不能制造重名；已有重名数据保留配置，提示逐项改名。另存先在同一弹窗进入命名步骤，预填并全选草稿名称，确认不同的可用名称后才创建新 ID，返回编辑保留配置草稿。历史转预设只以文字创建，默认普通文本、不含替换，不能还原旧选项或借用当前替换值。磁盘保存异步且可能失败，不把内存更新等同持久化成功。
- 禁用历史保留已有记录，停止记录／统计及输入框上下键历史导航；命令仍可打开弹窗，已有记录仍可操作。工具栏历史按钮禁用。
- 搜索／替换工具栏分别支持顺序及 `inline`（常驻）、`more`（更多）、`hidden`（隐藏）；隐藏按钮不移除命令能力。
- 支持拖动、上下按钮、手柄方向键排序和单栏恢复默认；关闭按钮与展开替换入口固定。
- “外观”设置页顶部固定完整实时纯展示预览，下方颜色及工具栏配置独立滚动；颜色、搜索选区、搜索栏按钮、替换栏按钮四个分组可独立折叠，默认全部折叠，预览始终展开两行，无任何操作。分类 Tab 提供悬停、选中、按下及键盘聚焦样式。每个按钮使用独立配置块，左侧整高拖动区，上层身份／排序、下层显示位置／默认开关；正则、大小写及全字匹配项支持默认开启。分组标题旁的回退图标提示“恢复默认设置”，点击直接恢复，仅作用于本组；搜索栏同时恢复布局及三个默认选项，替换栏仅恢复布局，不改变已有 Finder 或颜色。颜色整组和单项恢复也直接执行，无确认框，统一提示“已恢复默认设置”。
- 外观页按钮显示位置使用主题化自定义下拉，支持鼠标／键盘、当前项勾选和视口边缘上翻；导航不修改配置，明确选择不同值才保存，保持现有显示位置含义。“默认开启”文字与开关采用局部居中布局；历史分类的排序下拉不变。依据：`src/features/settings/ui/settings-select.ts`、`settings-view.ts`、`tests/component/settings-select.test.mjs`、`tests/integration/main-settings.test.mjs`。
- 预览查找词固定为 `text`，替换框无内容、显示 placeholder；下方仅一个两行英文正文区，同时展示一个当前匹配、两个普通匹配、首尾不齐的跨行选区及少量选区外文字。窄屏自然折行、高度自适应，复用编辑高亮的 CSS 类及颜色变量，不执行真实匹配。
- 外观页提供聚焦边框／装饰条、普通匹配背景／文字、当前匹配背景／文字六项颜色；点击色块打开 vanilla-colorful 的颜色／色相／透明度面板，支持 alpha 十六进制输入。调色只更新预览草稿，点击“应用”才一次更新真实编辑／阅读样式及保存；取消或离开页面丢弃草稿。单项或颜色分组恢复移除覆盖，继续继承 CSS snippet／Style Settings／主题，不影响工具栏配置。

依据：`src/features/history/model/history.ts`、`application/history-controller.ts`、`ui/HistoryPanel.vue`、`HistoryList.vue`；`src/features/presets/model/preset.ts`、`application/preset-controller.ts`、`ui/PresetEditor.vue`；`src/features/finder/application/finder-session.ts:captureRecipe()`／`applyRecipe()`；回归 `tests/unit/presets.test.ts`、`tests/component/search-library.test.ts`、`tests/integration/finder-session.test.ts`。工具栏配置依据 `src/features/finder/ui/FinderToolbar.vue`、`src/features/settings/ui/settings-view.ts:toolbar()`。

## 面板避让

- 桌面编辑／阅读统一直接拖动左侧装饰条，约 3px 位移启动，无长按等待；扩大命中区不覆盖折叠箭头。折叠箭头仅负责替换行，不再承担移动或附带移动说明。移动端手柄在结果栏顶部中央：小横条配 72×30px 拖动区，远离面板侧边，计数／关闭不作为拖动区；原折叠箭头和 More 原位。实际拖动时透明度 80%，松手／取消恢复；移动入口用 aria-labelledby 保留读屏名称，不产生 aria-label／title 悬浮提示。
- 移动端按实际按钮尺寸保留输入可用宽度，放不下的常驻动作后缀搬到结果栏，More／隐藏操作不搬；复用原按钮节点、保留排序和焦点，不改设置。恢复宽度后回流；结果栏可换行、计数可省略但读屏仍保留全文。
- 移动端结果栏与单行搜索框均以 40px 为基础外高，输入行统一留白；替换展开面板自然增高，不继承桌面固定高度／行间隙。输入明确 border-box、上下 padding、行高与字号，避免宿主默认内边距挤占单行空间；保留 textarea、换行文本和 overflow auto，不以隐藏溢出掩盖尺寸。实际空输入滚动、长文本光标和软键盘表现需真机复测。
- “拖到边缘时自动收起”默认关闭，开启后拖近左右边缘松手才收起。宽度达到可用宽度 85% 时改用横向位移至少 56px 且超过纵向 1.4 倍的意图，不因满宽或上下移动误收起。非满宽需有朝边缘至少 12px 的移动及 16px 内边缘距离；预览可撤回，取消不收起，阈值为实机待调初值。
- 收起为桌面 30px／移动端 40px 的查找标记（16px 图标、无面板阴影），可直接二维拖动；松手靠边吸附，不靠边保持紧凑状态停留，不强制回边缘。拖动不展开，单击展开不聚焦输入；桌面右键菜单提供关闭／恢复，移动长按不弹菜单、不因松手误展开，仍可按住后拖动；关闭命令及 Escape 仍可用。展开围绕标记位置限制在视图内，满宽水平居中、保留高度；不因展开靠边而再次收起。查询、替换行、当前项及高亮保留。
- 收起标记采用主题次级背景、细边框、正文色图标及 8px 圆角，悬停／按下与键盘焦点沿用主题交互色，不改变标记尺寸或公开 CSS 接口。自动显示入口首次按历史左右侧偏好靠安全边界（缺省右侧、保留 8px 留白），无需开启拖边自动收起；移动端收起态与完整框居中规则分离，完成布局后重新校正。后台不可测量时等待布局恢复，不覆盖之后的手动停放。深浅主题及首次显示位置待实机验收。
- 移动收起图标／中央手柄从按下开始隔离宿主冒泡滑动，尽早捕获指针并在 Document 捕获阶段处理同指针；并行 Touch 事件只保护同手指、不重复位移。正文左右侧栏手势、输入框触摸／选词、桌面拖动不作全局屏蔽；真实 pointercancel 保留回滚。Android 侧栏误触／拖不动修正需实机复测，不保证原生系统手势或更早的宿主捕获监听。
- 方向键移动 8px、Shift＋方向键 32px，Home／当前视图的恢复位置命令恢复默认，桌面收起标记右键也可恢复；常规设置不再提供跨视图恢复按钮。位置仅保留到具体视图销毁，不保存像素坐标。
- 收起时“显示／切换查找”均展开并聚焦查询，不关闭图标、不用选区覆盖已有查询；编辑模式的“打开查找与替换／切换替换区域”展开并确保替换栏显示、聚焦替换输入。完整框已展开时切换命令才执行正常开关；点击图标仍不聚焦输入。自动入口点击在阅读模式统一使用插件并保留不兼容降级。
- 收起不是关闭，不执行清空输入或源码模式恢复；正常关闭仍遵守原契约。收起放弃尚未完成的导航意图但保留计算，后续命令导航仍可用。替换候选／提交后重算期间禁止收起；收起时执行替换命令先展开显示进度。
- 位置限制在 owner 可见边界与 VisualViewport 的交集，考虑安全区；移动端以垂直避让为主，resize／键盘／视口滚动后重新约束。More 和状态提示随位置更新，菜单可上翻并限制尺寸。没有自动收起、惯性或宿主正文布局改写。

依据：`src/features/finder/interaction/finder-position.ts:createFinderPosition()`、`panel-presentation.ts`、`src/features/finder/application/finder-session.ts:dockFinder()`／`expandFinder()`、`src/features/reading/dom/reading-search.ts:pauseNavigation()`。回归：`tests/unit/finder-position.test.mjs`、`tests/component/finder-panel.test.mjs`；移动端软键盘与宿主几何仍待实测。

## 设置语义

默认值的唯一代码来源为 `src/features/settings/model/settings.ts:defaultSettings()` 和 `src/features/finder/model/toolbar.ts:defaultToolbar()`。

旧版 `useObsidianSearchInRead` 已退役：不再提供控件或参与路由，归一化删除旧字段并沿用已有保存队列迁移，其他设置和精确历史不变。阅读正常统一使用插件，不兼容仍提示并回退，运行失败仍可手动打开原生查找。依据：`src/features/settings/model/settings.ts:normalizeSettings()`、`src/app/workspace-runtime.ts:activateFloatingFinder()`；回归：`tests/unit/history-contracts.test.mjs`、`tests/integration/main-settings.test.mjs`、`reading-commands.test.mjs`。

| 设置页 | 字段 | 默认／语义 |
| --- | --- | --- |
| 常规 | `showFloatingFinderOnOpen` | 默认关闭；打开 Markdown 笔记时显示收起的小图标，启用后也应用于已有笔记；不自动搜索或抢焦点，主动关闭后同视图同笔记不因标签激活而重现 |
| 查找 | `clearAfterHidden` | 默认关闭；清空范围的已批准约束见 interactions |
| 查找 | `enableInputHotkeys` | 默认开启；输入框 Enter 快捷操作 |
| 查找 | `useSelectionAsSearch` | 默认开启；打开时取所属视图选区 |
| 查找 | `sourceModeWhenSearch` | 默认开启；编辑匹配定位时强制源码模式 |
| 查找 | `moveCursorToMatch` | 默认开启；选中当前编辑匹配 |
| 兼容字段（无控件） | `finderDockSide` | 保留历史 left／right 值，缺省 right；新手势由拖动方向选择两侧，不覆盖历史持久化值 |
| 常规 | `finderAutoDock` | 默认关闭；完整框拖动松手时自动贴边收起，左右均可；不保存临时位置 |
| 替换 | `useEscapeCharInReplace` | 默认开启；仅作用于正则替换 |
| 历史 | `enableHistory` | 默认开启 |
| 历史 | `historyMaxCount` | 默认 10；1–200，Enter／blur 提交 |
| 历史 | `historySortOrder` | 默认 `lastUsedAt` |
| 历史 | `historyRetention` | 新安装默认 `lastUsedAt`；升级缺失时继承旧 `historySortOrder`，控制容量裁剪，不随查看排序改变 |
| 持久化（无设置控件） | `searchPresets` | 默认 `[]`；独立命名预设集合，不受历史容量控制 |
| 外观 | `searchToolbar` | 正则、大小写、全字匹配、上一项、下一项常驻；历史隐藏。精确旧默认及上一版末尾追加全字的默认布局迁移到此顺序；其他自定义布局保留顺序及位置并追加缺失动作 |
| 外观 | `replaceToolbar` | 单次替换、全部替换常驻 |
| 外观 | `defaultRegexMode` | 默认关闭；仅初始化新建视图查找器的正则选项 |
| 外观 | `defaultCaseSensitive` | 默认关闭；仅初始化新建视图查找器的大小写选项 |
| 外观 | `defaultWholeWord` | 默认关闭；仅初始化新建视图查找器的全字匹配选项 |
| 外观 | `appearanceColors` | 默认 `{}`，仅保存显式设置的八项十六进制颜色（含选区背景／边框，支持 alpha）；空项目继续继承 CSS／主题 |
| 外观 → 搜索选区 | `scopeAppearance` | 默认 `{ border: false, width: 1 }`；可选轮廓边框、粗细 1／2／3px，只改变呈现，不影响范围 |

搜索选区有独立折叠分组与分组恢复：只清除 `scopeBackground`／`scopeBorder` 显式颜色并恢复边框开关／粗细，不改工具栏或匹配色；原颜色分组恢复不重置搜索选区。增加跨行预览，颜色草稿不写正文。轮廓从已渲染范围标记的矩形并集提取外边界，避免语法／匹配拆框及整体大矩形误导；分离多选区不连接，未渲染／空白片段不猜测整行边界。依据：`src/shared/geometry/scope-outline.ts`、`src/platform/codemirror/search-scope.ts:scopeOutlineLayer`、`src/features/settings/ui/settings-view.ts:scopeStyles()`、`appearance-styles.ts`；宿主绘制待验证。

搜索选区顺序为背景色、轮廓开关、关联边框色／粗细；仅开启边框才显示关联项，关闭保留取值并结束弹出面板／不可见焦点。外观页统一 32px 基础行高、8px 行间距及名称／操作列对齐，360px 窄宽采用上下布局；其他设置页不变。轮廓左右仅补偿半线宽、内缘贴近测得字符边界，上下保留约 2px 内侧视觉净距并考虑线宽；狭窄间隙按分离方向限制外扩，不增加留白设置、不改正文排版或允许写入坐标。依据：`scopeStyles()`、`paddedScopeOutlines()`、`src/styles/index.scss`。

设置页控件是 Obsidian 原生 `PluginSettingTab`／`Setting` 和 DOM 实现；预览挂载 `src/features/settings/ui/ToolbarPreview.vue` 并复用 `src/features/finder/ui/FinderToolbar.vue`。依据：`src/app/settings-tab.ts`、`src/features/settings/ui/settings-view.ts`。

## 非能力

没有实现阅读模式替换、跨行扩大整行或拖动调整面板宽度；`.nya-dragger` 注释不是产品承诺。未见跨 Vault 搜索或独立清空全部历史按钮。

依据：`src/features/finder/ui/FinderPanel.vue` 的 `.nya-dragger`、`src/features/finder/application/search-scope.ts`、`src/app/workspace-commands.ts:registerWorkspaceCommands()`、`src/features/history/ui/HistoryList.vue`。
