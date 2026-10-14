# 视觉约束与截图基线

本文件区分源码中的视觉事实和真实截图证据。截图分类用于确定比较范围，不是采集任务进度。交互语义见 [interactions](interactions.md)。

## 样式来源与兼容接口

- 全局变量、编辑高亮、阅读 `::highlight`、设置样式来自 `src/styles/index.scss`，构建为 `dist/styles.css`。
- Svelte 组件有自己的 scoped CSS／SCSS；`esbuild.config.mjs` 使用 `css: "injected"`，组件样式不全部存在于全局样式产物中。
- `ToolbarPreview.svelte` 是设置页新增的展示组件；它与真实 Finder／Toolbar 通过 `src/styles/finder-primitives.scss` 共享面板、输入、按钮、计数和焦点样式，容器定位与窄宽布局独立。
- `src/appearance.ts:AppearanceStyles` 只为显式自定义颜色生成按 Document 管理的 `body` 变量覆盖（`!important`）；默认没有覆盖样式，恢复时移除对应声明，卸载／窗口关闭移除插件样式，不改写宿主 inline style。更具体或 inline 的 `!important` 用户规则仍可能优先，不能承诺覆盖任意 CSS。
- README 公开 `.nya-finder`（位置）、`.nya-toggle`（装饰）、`.nya-text-finder-match`、`.nya-text-finder-match-current` 和下列变量的自定义示例。
- **兼容性推断：**这些公开类／变量是用户 CSS 接口，应保留名称与作用；Svelte 自动生成的作用域类不视为公开接口。改变 CSS 注入／作用域时必须核对级联与宿主窗口，而非只复制全局 SCSS。

依据：`src/styles/index.scss`、各 `.svelte` 的 `<style>`、`esbuild.config.mjs`、`README-zh_CN.md` 的“自定义样式”、`style-settings.css`。

| 公开变量 | 当前默认值 | 用途 |
| --- | --- | --- |
| `--nya-default-width` | `448px` | 面板最小宽度 |
| `--nya-focus-border-color` | `#2488db` | 聚焦边框／选项边框 |
| `--nya-dragger-color` | `#39c5bb` | 左侧装饰条，不代表可拖动宽度 |
| `--nya-match-bgColor` | `#ea5c0054` | 普通匹配背景 |
| `--nya-match-color` | `#ffffff` | 普通匹配文字 |
| `--nya-match-curbgColor` | `#fafa00f2` | 当前匹配背景 |
| `--nya-match-curColor` | `#ff0000` | 当前匹配文字 |
| `--nya-scope-background` | `var(--background-modifier-hover)` | 搜索选区背景 |
| `--nya-scope-border-color` | `var(--interactive-accent)` | 搜索选区轮廓色 |
| `--nya-scope-border-width` | `0px` | 搜索选区边框，0px 隐藏；设置开启后覆盖为 1–3px |

Style Settings 配置文件是独立示例，不是插件自动注册的设置页：`style-settings.css` 没有作为 esbuild 入口导入。

## 当前布局与主题事实

| 区域 | 源码事实 | 依据 |
| --- | --- | --- |
| 桌面 Finder | 绝对定位 top 88px／right 48px；展开 72px、折叠 38px；4px 圆角、阴影、边框；隐藏 transform／opacity 动画，同时同步 visibility | `src/SearchBox.svelte` 的 `.nya-finder`／`syncFinderVisibility()` |
| 输入与按钮 | 桌面输入高 28px，移动输入 30px；可收缩以适配 owner 可见宽度；图标 18px；工具栏按钮 24×24px、margin 2px、padding 4px | `src/SearchBox.svelte`、`src/Toolbar.svelte` |
| 默认／自定义布局 | 默认替换行测量当前计数和操作区做补偿；自定义工具栏用 Grid，阅读／移动／折叠不使用默认补偿 | `src/SearchBox.svelte:alignRows()` 及 `.nya-finder--custom-toolbar` |
| 移动布局 | 默认居中，最大 416px 且限制 owner／视口；面板 border-box／自然高度，输入行 min-height 38px（上下各 4px 留白），单行框含边框 40px；结果栏 min-height 40px／上下 4px 留白，两侧与面板外边框对齐。三列 Grid：计数在左、中央 72×30px 拖动区上沿显示 32×4px 圆角横条、右侧溢出操作及关闭；计数省略，操作在自己的区域换行增高，不覆盖中央手柄。查找／替换输入 border-box 30px、上下 padding 4px、1px 边框、16px 字号／20px 行高、overflow auto／overscroll contain，空／单行内容在尺寸上可完整容纳，多行／长文本保留滚动。More 原位，替换动作仍在替换行 | `src/SearchBox.svelte`、`src/mobile-toolbar.ts`；jsdom 尺寸计算不证明真机空输入滚动或字体绘制 |
| 面板移动／贴边 | 桌面左侧装饰条直接拖动，命中区约 12px（主要向框外扩展，不覆盖箭头）；移动端中央顶部横条与结果／关闭一体，只拖动区 touch-action none，不拦截计数／关闭区域触摸。3px 位移后 opacity 0.8，无长按，位置不做过渡；候选主题色边框反馈；收起标记桌面 30×30px／移动 40×40px、16px 图标、无阴影。移动入口 aria-labelledby、不产生大片提示；二维拖动／单击展开，尊重 reduced-motion | `src/SearchBox.svelte`、`src/finder-position.ts`；真机中央命中／边缘系统手势／键盘避让待实测 |
| 收起入口主题与初始位置 | 收起态使用 `--background-secondary` 背景／`--background-modifier-border` 细边框／`--text-normal` 图标，8px 圆角、无面板阴影；内部按钮继承圆角，hover／active 使用主题交互背景，focus-visible 保留主题色焦点框。移动收起态不继承完整框居中 transform，默认按 `finderDockSide` 靠安全边界（缺省右侧，留白 8px）；布局提交后再次校正，无 transform／right 过渡干扰紧凑定位。手动停放不因后台刷新回边缘 | `src/SearchBox.svelte:showFloatingEntry()`／收起态 CSS、`src/finder-position.ts:measure()`；深浅主题实际对比度／移动端首次贴边需实机验收 |
| 移动长按范围 | 移动 `.nya-move-handle`／`.nya-dock-expand` 局部 `-webkit-touch-callout: none`／`user-select: none`，阻止菜单默认行为及冒泡，不添加新按钮；桌面收起菜单保留。查找／替换 textarea 不屏蔽 contextmenu 或选词，不作全局触摸菜单禁用 | `src/SearchBox.svelte:dockMenu()`／`dragToMove()`；自动事件回归不证明 iOS／Android callout 实际抑制 |
| 移动展开定位／过渡 | 移动完整框和收起态均无 right／transform 位置动画，仅 opacity：普通态 0.2s linear，拖动／收起态 0.12s ease。展开宽度沿用现有限制，满宽居中，较窄围绕标记并限制到安全边界；避免动画完成后 translate 补偿过期而右侧越界。桌面位置过渡保留；reduced-motion 用优先规则禁用过渡，包括更高 specificity 的移动／拖动态 | `src/SearchBox.svelte` 移动 CSS／reduced-motion、`src/finder-position.ts:update()`／`measure()`；`tests/search-box-dom.test.mjs` 的移动展开／过渡回归模拟中间坐标，非 Android 浏览器动画实测 |
| More | 右侧绝对定位的紧凑图标按钮组，无 180px 最小宽；横向自然宽度、4px padding、可换行，最大 300px 且受 owner／可见视口约束。按钮复用外部 24×24px／18px 图标及激活／禁用样式，无列表文字／勾号。收起且内部有模式开启时，右上角绝对定位的 5px 主题 `--interactive-accent` 圆点提示，触发器不使用模式激活蓝底／边框；展开隐藏圆点，仅用内边框反馈，收起按当前状态恢复。圆点无动画／点击区域，不改变几何；设置预览同步圆点。工具栏额外焦点框用 `:focus-visible` 的 2px outline，不再对所有 focus 绘制蓝色阴影；输入及其他 Finder 控件不变 | `src/Toolbar.svelte`、`src/styles/finder-primitives.scss`；真实鼠标／键盘 focus-visible、窄宽／移动／主题及悬浮提示待验收 |
| 全字匹配控件 | `WholeWord`／`whole-word` 图标，复用既有 18px 图标、按钮几何、激活／聚焦样式，More 内外均用 `aria-pressed`；新默认顺序为正则、大小写、全字匹配、上一项、下一项。设置支持默认开启和纯展示激活预览；不改变公开宽度变量 | `src/toolbar.ts`、`src/Toolbar.svelte`、`src/settings-tab.ts`、`src/ToolbarPreview.svelte`；窄分屏、移动端与宿主悬浮提示待实测 |
| 选区范围 | `TextSelect`／`text-select` 图标，默认在 More，可配置常驻／隐藏，无默认开启；阅读不展示。以按钮激活态表达，计数旁无文字标记；空／失效范围仍激活，操作按钮提示恢复方式；隐藏按钮不增加替代标记。正文 `.nya-text-finder-scope` 默认主题淡背景，可自定义及开启独立外轮廓，无下划线，不覆盖匹配颜色；保留既有公开 CSS 变量 | `src/search-scope.ts`、`src/scope-outline.ts`、`src/Toolbar.svelte`、`src/SearchBox.svelte`、`src/styles/index.scss`；主题对比及实机范围绘制待验收 |
| 查找状态 | 编辑／阅读均使用面板外部提示，空间不足时上翻；等待文案不拦截指针，取消／重试／同步重试操作可点击 | `src/SearchStatus.svelte:position()` 及样式 |
| 替换状态 | 候选计算显示尚未写入；提交后重算显示已完成、取消不撤销；失败文案区分提交前和提交后 | `src/SearchBox.svelte:replaceInWorker()`、`src/SearchStatus.svelte` |
| 历史 | 容器 70vh／padding 24px；列表内部滚动、查询两行截断、选中高亮；操作在 hover／focus-within 显示，无 hover 设备常显 | `src/HistoryModal.ts`、`src/HistoryModal.svelte`、`src/HistoryList.svelte` |
| 历史详情 | 响应式元数据 Grid；正文 pre-wrap、等宽字体、可选中、独立滚动 | `src/HistoryDetail.svelte` |
| 设置 | 原生 Obsidian 控件；分类顺序常规／查找／替换／搜索历史／外观，默认常规。常规页放自动悬浮入口、拖边自动收起及恢复位置；沿用原生开关／按钮，不增加提示容器或新装饰。分类 tabs、拖动半透明及插入线限定在 `.nya-settings` | `src/settings-tab.ts`、`src/styles/index.scss` |
| 设置分类交互 | Tab 最小 32px 高；悬停为主题 hover 背景／正文色，当前项为 2px 主题色下划线／主题色文字，按下为主题 active-hover 背景（缺失时回退 hover），键盘 focus-visible 保留 2px 焦点框；不添加悬浮容器标签、不改其他宿主 Tab | `src/styles/index.scss`；`tests/appearance.test.mjs`；真实主题与触屏反馈待验收 |
| 外观配置标题 | 颜色／搜索选区／搜索工具栏／替换工具栏四个分组独立折叠，默认全收起；分组底部间距 8px、标题无额外上下 margin，展开正文距标题 6px，标题及恢复图标仍有 32px 点击高度；标题前 16px 箭头，折叠时朝右，标题与恢复按钮分离；`undo-2` 回退图标紧邻标题，16px 图标／32px 点击区域，常显，提示“恢复默认设置”。内容 hidden 时 display none，无折叠动画；顶部预览不折叠。恢复直接执行，无确认框，统一 2 秒 Notice“已恢复默认设置”；容器通过 `aria-labelledby` 命名，避免 Obsidian 的 `aria-label` 自动提示覆盖整个区域 | `src/settings-tab.ts:section()`／`reset()`、`src/styles/index.scss`；`tests/main-settings.test.mjs`；宿主提示、触屏与布局待实测 |
| 工具栏配置块 | 各按钮使用主题次级背景、8px 圆角、10px 块间距，无列表分割线和阴影；左侧整高 32px 拖动区，上层图标／名称／排序，下层自定义位置下拉／默认开关；上下行 min-height 32px、行间 8px，统一左右边界及居中，360px 以下下层纵向排列；下拉用 sm／content：触发器 28px 高，宽度按最长选项及内边距／图标占位确定，不固定 96px；透明背景／主题细边框、5px 圆角，展开为主题主背景／主题色边框，不重复显示位置标签；“默认开启”的 Setting、文字区与控件区采用局部 flex 居中，名称 margin 清零／1.4 行高，保留宿主开关外观；不显示说明段落 | `src/settings-tab.ts`、`src/styles/index.scss`；`tests/appearance.test.mjs`；真实主题垂直对齐待验收 |
| 位置下拉列表 | owner Document body 中的 fixed 列表，不被配置滚动区裁切；默认与触发器同宽，仅超出视口时限制宽度，可上翻／内部滚动；8px 外圆角、主题细边框／主背景／轻阴影、4px 内边距；文字左侧起点与触发器相同，箭头／勾选共享图标占位；导航高亮用主题 hover 背景，当前项用主题色勾选标识，不使用固定蓝底白字 | `src/settings-select.ts`、`src/styles/index.scss`；`tests/settings-select.test.mjs`；宿主视口、主题、触屏与读屏行为待实测 |
| 可复用下拉尺寸 | size 支持 sm／md，分别为触发器 28／32px、选项最小 32／36px、左右内边距 10／12px、图标 14／16px；字号均沿用主题 UI small，不绑定固定宽度。width 支持 content（默认，所有选项叠放测 intrinsic 宽度，切换值不跳宽）／fill（100% 容器）；触发器与列表共享字体／字重／行高／字间距，每次展开复制触发器 computed 字体与局部尺寸 token 到 portal；内部尺寸变量不是公开 Style Settings 项 | `src/settings-select.ts:createSettingsSelect()`、`src/styles/index.scss`；`tests/settings-select.test.mjs`、`tests/appearance.test.mjs` |
| 工具栏预览 | 顶部固定展开两行面板，真实 Toolbar 图标／激活／More 图标；容器宽度不超过 480px 时计数另占一行，输入缩窄，不缩放按钮；纯展示、不聚焦／点击／悬停／选择，不灰化，历史禁用样式保留 | `src/ToolbarPreview.svelte`、`src/Toolbar.svelte` |
| 设置字体层级 | 工具栏配置名称／下拉／开关／恢复按钮及模拟输入统一 UI 字体／`--font-ui-small`；预览和栏目标题用 `--font-ui-medium`／半粗；空替换框 placeholder 继承模拟输入字号／行高，仅颜色用 `--text-faint`；不调整真实 Finder 输入字体 | `src/styles/index.scss`、`src/ToolbarPreview.svelte` |
| 匹配及选区综合样例 | 仅一个两行文本区域 `.nya-preview-text.nya-preview-scope`，上下 8px／左右 12px 内边距，正文用 `--font-text`／`--font-text-size`；固定英文三个 `text`，一个当前、两个普通，均在首尾不齐的跨行选区中，外侧保留未选文字。复用公开 CSS 类及变量；无交互、窄屏自然换行、不裁切或缩字，仅模拟编辑呈现，不代表阅读 Highlight API 全部效果 | `src/ToolbarPreview.svelte`、`src/styles/index.scss` |
| 外观页固定预览 | 仅外观页使用内部满高 flex 布局、外层禁止滚动（不依赖宿主设置根节点的 display）；分类导航和整个预览不收缩，下方配置区 `min-height: 0`／独立纵向滚动，支持键盘焦点；查找模拟输入固定展示聚焦边框，但不实际聚焦；不采用悬浮窗口覆盖，不改变其他分类滚动 | `src/settings-tab.ts`、`src/ToolbarPreview.svelte`、`src/styles/index.scss`；真实宿主低高度／移动键盘待验证 |
| 颜色配置 | 三个主题次级背景分组（面板／普通／当前），六项紧凑颜色行；28px 棋盘格色块按钮、104px 只读颜色值、单项恢复；UI 小字号，360px 以下颜色行分两行。点击色块打开 owner Document 的 248px 主题面板，vanilla-colorful 内建饱和度／色相／alpha，选择器 100% 宽／180px 高，保留库的 `:host` flex 纵向布局，不用外部 display 覆盖；带十六进制输入、取消／应用；草稿仅局部预览，无分散透明度滑块 | `src/settings-tab.ts:colors()`、`src/color-picker.ts`；`tests/color-picker.test.mjs` 的布局保留回归、`tests/main-settings.test.mjs`；真实宿主修复效果待验收 |

面板／历史／设置主要采用 Obsidian `--background-*`、`--text-*`、`--interactive-*` 和字体变量，没有独立深浅主题分支。仍有固定选项蓝色／白字、非空无结果红色、黑色阴影；不能据此声称所有主题对比度合格。

搜索选区外观补充：默认淡背景无边框；独立第四折叠组支持背景／边框 alpha、轮廓开关及 1–3px 粗细，单项及分组恢复作用域独立。正文 `.nya-scope-layer`／`.nya-scope-outline` 以矩形并集外边绘制，不给每个 mark 加边框，不拦截输入；设置增加 `.nya-preview-scope` 两行静态样例及相同测量算法。默认继承宿主背景／强调色，不固定新配色。空行／隐藏源码／不连续字符轮廓可能断开，不能用整行矩形填补；主题、折行、缩放、滚动、实时预览及移动设备实际绘制待验收。依据：`src/scope-outline.ts`、`src/search-scope.ts`、`src/ToolbarPreview.svelte`、`src/settings-tab.ts:scopeStyles()`。

外观行布局统一：颜色组 12px 内边距、Grid 8px 行距；颜色行／轮廓开关 min-height 32px、列距 12px，名称左对齐、操作右对齐，色块／104px 颜色值／恢复按钮纵向对齐且内部间距 8px；颜色值用 UI 字体和 tabular-nums。轮廓开关在依赖组之前，关闭 hidden 不占空间；依赖名称缩进 12px，窄宽回到同一左边界。原生 Setting 默认 margin／padding 在局部清除；360px 以下颜色行、轮廓开关及工具栏配置均采用上下布局，不影响其他设置页。轮廓采用 2px + 半线宽的外扩，紧间隙限制优先于净距，不增加留白设置项。几何／样式依据 `src/scope-outline.ts:paddedScopeOutlines()`、`src/styles/index.scss`；实际字体和主题对齐仍需实测。

本地化资源为英文／简体中文，历史长度与使用次数文案也通过翻译键显示。列表时间格式为 `YY-MM-DD HH:mm:ss`，详情为 `YYYY-MM-DD HH:mm:ss`，同时显示 moment 相对时间；合法的时间戳 0 不回退到其他字段。触屏／键盘可发现性仍需实测。依据：`src/HistoryList.svelte` 的格式化／元数据／操作样式、`src/HistoryDetail.svelte`、`src/i18n/index.ts`。

编辑高亮用 CodeMirror class，阅读高亮用 CSS Custom Highlight API；共享颜色变量，但阅读 API 不支持编辑 class 的全部边框／圆角效果。依据：`src/styles/index.scss`、`src/search-highlight.ts`、`src/reading-search.ts:updateRegistry()`。

## 应覆盖的截图分类

| 分类 | 主要状态 | 源码依据 |
| --- | --- | --- |
| 编辑查找 | 空查询、有结果、非空无结果；输入 focus；正则／大小写／全字匹配激活 | `src/SearchBox.svelte` |
| 编辑替换 | 展开、替换 focus、替换后当前项；计数从长变短后的行对齐 | `src/SearchBox.svelte:replaceOnce()`／`alignRows()` |
| 自定义工具栏 | 重排、More 收起圆点／展开隐藏／内部模式激活、鼠标无额外焦点框与键盘 focus-visible、历史禁用；模式隐藏不加替代标记 | `src/Toolbar.svelte`、`src/toolbar.ts` |
| 阅读查找 | 无替换入口；普通／当前高亮；跨格式／跨块结果；导航展开目标正文 | `src/reading-search.ts`、`src/reading-text.ts` |
| 阅读状态 | 等待标记、延迟提示、失败、超时、不支持；提示上翻及操作按钮 | `src/SearchStatus.svelte` |
| 历史列表 | 空态、普通／hover、部分选中／全选、长查询截断、内部滚动 | `src/HistoryList.svelte` |
| 历史详情 | 长多行正文、元数据、内部滚动、可选择文本 | `src/HistoryDetail.svelte` |
| 设置分类 | 五分类（常规在首位）、Tab focus、工具栏边界禁用／拖动插入标记 | `src/settings-tab.ts` |
| 视图环境 | 窄分屏、同文件双分屏、弹出窗口；各自高亮和面板 | `src/editor-extension.ts`、`src/reading-search.ts` |
| 移动布局 | 查找、展开替换、More、阅读错误、历史列表／详情 | `src/SearchBox.svelte` 的移动分支及历史组件 |

核心比较应覆盖默认浅／深主题；社区主题和 Android／iOS 只能按明确选择的目标记录，不假设全部支持。截图不能证明键盘、IME、隐藏焦点、异步取消或资源释放，需配合测试和真实应用验收。

## 基线记录规则与现有资产

每组真实基线记录：资产相对路径、源码 commit、Obsidian／系统版本、主题／CSS snippets、语言、视口／缩放、笔记样例、查询、相关设置及状态。历史截图固定时间数据，避免相对时间变化造成噪声；动画比较需说明捕获的是稳定状态还是过渡帧。

仓库现有资产为 [`screenshot/demo.gif`](../../screenshot/demo.gif)，Git 最近修改记录为 `5d5f0f6`（2024 年）。它是早期演示，不作为现行阅读、历史、自定义工具栏的完整基线。没有真实截图证据时，不填造资产路径或通过结论。

真实应用验证方法见 [testing](../testing.md#实际应用验收)。
