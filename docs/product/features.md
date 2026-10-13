# 产品能力与边界

本文件记录当前源码可确认的功能；已批准的关闭语义见 [interactions](interactions.md#已批准的关闭契约)。源码事实不等于真实 Obsidian 验收通过，验证边界见 [compatibility](../compatibility.md)。

## 范围与入口

- 编辑模式搜索／替换所属视图的完整 Markdown 源码，包括源码中的标记。
- 阅读模式搜索当前笔记的渲染正文，不支持替换；两个模式的匹配数量可以不同。
- 插件注册命令和设置页，面板通过命令懒创建。未注册 Ribbon 或右键菜单入口，也未定义默认快捷键；用户在 Obsidian 中自行分配。

依据：`src/editor-extension.ts` 的 `registerCommand()`／`getFinder()`、`src/SearchBox.svelte` 的 `setFindText()`／`prepareReplacement()`；使用说明见 `README-zh_CN.md`。

| 命令 ID | 能力 | 目标 |
| --- | --- | --- |
| `text-finder-show-find` | 打开查找 | 编辑／阅读 |
| `text-finder-show-find-and-replace` | 打开查找与替换 | 编辑 |
| `text-finder-hide-find` | 关闭查找 | 当前 Markdown 视图 |
| `text-finder-toggle-find` | 切换查找显示 | 当前 Markdown 视图 |
| `text-finder-toggle-replace` | 切换替换区域 | 编辑 |
| `text-finder-previous-match` | 上一个匹配 | 编辑／阅读 |
| `text-finder-next-match` | 下一个匹配 | 编辑／阅读 |
| `text-finder-replace` | 替换一次 | 编辑 |
| `text-finder-replace-all` | 全部替换 | 编辑 |
| `show-search-history` | 打开历史弹窗 | 打开不要求 Markdown 视图；复用要求可搜索视图 |

## 查找与替换

- 输入即重新匹配；支持大小写选项、数量、当前项、循环导航及高亮。
- 编辑／阅读查找优先在所属窗口的 Worker 执行匹配，不限制正则语法或匹配数量。启动不可用时提示并使用同步兼容路径；执行中故障显示错误，不自动在主线程重跑。用户可明确选择同步重试。
- 替换候选与替换后重算同样优先 Worker；正文写入仍为同步 CodeMirror 事务。阅读 DOM 索引／端点／绘制、结果解码和事务仍在主线程，不能承诺所有操作都不会阻塞。
- 普通文本按字面量搜索，非重叠匹配；不先把原文转成小写，偏移为原文 UTF-16 坐标。
- 正则使用 JavaScript `RegExp`，flags 为 `g`、正则模式下的 `m` 和大小写不敏感时的 `i`。没有单独 flags 输入或整词选项。
- 空查询、空正文、无结果、无效正则均返回空匹配；零宽匹配不计数、不替换。无效正则当前没有独立语法错误界面。
- 单次替换和全部替换基于当前原文重新计算。全部替换通过一个 CodeMirror changes 事务提交，不递归处理新插入文本。
- 单次替换只展开目标模板，不预先创建所有候选插入文本；不限制既有捕获、前缀／后缀或转义能力。
- 正则替换支持 `$1`–`$99`、`$<name>`、`$&`、`$$`、原文前缀 `` $` `` 和后缀 `$'`；遵循 JavaScript 模板语义。
- 正则模式且转义设置开启时，替换输入单次解析 `\n`、`\t`、`\\`；未知转义、末尾反斜杠和真实 NUL 保留。普通文本替换不展开美元模板或反斜杠转义。

依据：`src/util/text-helper.ts` 的 `findTextMatches()`／`prepareReplacements()`／`expandReplacement()`；`src/SearchBox.svelte` 的 `adjustReplaceText()`／`replaceText()`。回归：`tests/text-helper.test.mjs`、`tests/regex-replacement.test.mjs`、`tests/replacement.test.mjs`。

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
- “外观”设置页顶部固定完整实时纯展示预览，下方颜色及工具栏配置独立滚动；预览始终展开两行，无任何操作。每个按钮使用独立配置块，左侧整高拖动区，上层身份／排序、下层显示位置／默认开关；正则及大小写项支持默认开启。“恢复默认配置”仅作用于本栏，搜索栏同时恢复布局及两个默认选项，替换栏仅恢复布局，不改变已有 Finder 或颜色。
- 预览查找词固定为 `text`，替换框无内容、显示 placeholder；下方正文区随文字实际行数自适应高度，以固定英文展示一个当前匹配和两个普通匹配，复用编辑高亮的 CSS 类及颜色变量，不执行真实匹配。
- 外观页提供聚焦边框／装饰条、普通匹配背景／文字、当前匹配背景／文字六项颜色；点击色块打开 vanilla-colorful 的颜色／色相／透明度面板，支持 alpha 十六进制输入。调色只更新预览草稿，点击“应用”才一次更新真实编辑／阅读样式及保存；取消或离开页面丢弃草稿。单项或颜色分组恢复移除覆盖，继续继承 CSS snippet／Style Settings／主题，不影响工具栏配置。

依据：`src/history.ts`、`src/HistoryModal.svelte`、`src/HistoryList.svelte`、`src/Toolbar.svelte`、`src/settings-tab.ts` 的 `toolbar()`。

## 设置语义

默认值的唯一代码来源为 `src/settings.ts:defaultSettings()` 和 `src/toolbar.ts:defaultToolbar()`。

| 设置页 | 字段 | 默认／语义 |
| --- | --- | --- |
| 查找 | `clearAfterHidden` | 默认关闭；清空范围的已批准约束见 interactions |
| 查找 | `enableInputHotkeys` | 默认开启；输入框 Enter 快捷操作 |
| 查找 | `useSelectionAsSearch` | 默认开启；打开时取所属视图选区 |
| 查找 | `sourceModeWhenSearch` | 默认开启；编辑匹配定位时强制源码模式 |
| 查找 | `moveCursorToMatch` | 默认开启；选中当前编辑匹配 |
| 查找 | `useObsidianSearchInRead` | 新安装默认关闭；已有显式原生偏好保留 |
| 替换 | `useEscapeCharInReplace` | 默认开启；仅作用于正则替换 |
| 历史 | `enableHistory` | 默认开启 |
| 历史 | `historyMaxCount` | 默认 10；1–200，Enter／blur 提交 |
| 历史 | `historySortOrder` | 默认 `lastUsedAt` |
| 外观 | `searchToolbar` | 正则、大小写、上一项、下一项常驻；历史隐藏 |
| 外观 | `replaceToolbar` | 单次替换、全部替换常驻 |
| 外观 | `defaultRegexMode` | 默认关闭；仅初始化新建视图查找器的正则选项 |
| 外观 | `defaultCaseSensitive` | 默认关闭；仅初始化新建视图查找器的大小写选项 |
| 外观 | `appearanceColors` | 默认 `{}`，仅保存显式设置的六项十六进制颜色；空项目继续继承现有公开 CSS 变量 |

设置页控件是 Obsidian 原生 `PluginSettingTab`／`Setting` 和 DOM 实现；预览挂载 `src/ToolbarPreview.svelte` 并复用 `src/Toolbar.svelte`。依据：`src/settings-tab.ts`。

## 非能力

没有实现选区内查找／替换，也没有实现拖动调整面板宽度；README TODO 和 `.nya-dragger` 注释不是产品承诺。未见跨 Vault 搜索或独立清空全部历史按钮。

依据：`README-zh_CN.md` 的 TODO、`src/SearchBox.svelte` 的 `.nya-dragger`、`src/editor-extension.ts:registerCommand()`、`src/HistoryList.svelte`。
