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

Style Settings 配置文件是独立示例，不是插件自动注册的设置页：`style-settings.css` 没有作为 esbuild 入口导入。

## 当前布局与主题事实

| 区域 | 源码事实 | 依据 |
| --- | --- | --- |
| 桌面 Finder | 绝对定位 top 88px／right 48px；展开 72px、折叠 38px；4px 圆角、阴影、边框；隐藏 transform／opacity 动画，同时同步 visibility | `src/SearchBox.svelte` 的 `.nya-finder`／`syncFinderVisibility()` |
| 输入与按钮 | 输入高 28px、桌面最小宽 177px；图标 18px；工具栏按钮 24×24px、margin 2px、padding 4px | `src/SearchBox.svelte`、`src/Toolbar.svelte` |
| 默认／自定义布局 | 默认替换行测量当前计数和操作区做补偿；自定义工具栏用 Grid，阅读／移动／折叠不使用默认补偿 | `src/SearchBox.svelte:alignRows()` 及 `.nya-finder--custom-toolbar` |
| 移动布局 | 居中，最大 416px；输入最小宽 100px；计数和关闭浮置上方；单独的操作区布局 | `src/SearchBox.svelte` 的 `.is-mobile` 样式 |
| More | 右侧绝对定位，最小宽 180px、最大受视口限制；菜单与选项状态样式 | `src/Toolbar.svelte` |
| 查找状态 | 编辑／阅读均使用面板外部提示，空间不足时上翻；等待文案不拦截指针，取消／重试／同步重试操作可点击 | `src/SearchStatus.svelte:position()` 及样式 |
| 替换状态 | 候选计算显示尚未写入；提交后重算显示已完成、取消不撤销；失败文案区分提交前和提交后 | `src/SearchBox.svelte:replaceInWorker()`、`src/SearchStatus.svelte` |
| 历史 | 容器 70vh／padding 24px；列表内部滚动、查询两行截断、选中高亮；操作在 hover／focus-within 显示，无 hover 设备常显 | `src/HistoryModal.ts`、`src/HistoryModal.svelte`、`src/HistoryList.svelte` |
| 历史详情 | 响应式元数据 Grid；正文 pre-wrap、等宽字体、可选中、独立滚动 | `src/HistoryDetail.svelte` |
| 设置 | 原生 Obsidian 控件；分类 tabs、拖动半透明及插入线限定在 `.nya-settings` | `src/settings-tab.ts`、`src/styles/index.scss` |
| 设置分类交互 | Tab 最小 32px 高；悬停为主题 hover 背景／正文色，当前项为 2px 主题色下划线／主题色文字，按下为主题 active-hover 背景（缺失时回退 hover），键盘 focus-visible 保留 2px 焦点框；不添加悬浮容器标签、不改其他宿主 Tab | `src/styles/index.scss`；`tests/appearance.test.mjs`；真实主题与触屏反馈待验收 |
| 外观配置标题 | 三个分组独立折叠，默认全收起；分组底部间距 8px、标题无额外上下 margin，展开正文距标题 6px，标题及恢复图标仍有 32px 点击高度；标题前 16px 箭头，折叠时朝右，标题与恢复按钮分离；`undo-2` 回退图标紧邻标题，16px 图标／32px 点击区域，常显，提示“恢复默认设置”。内容 hidden 时 display none，无折叠动画；顶部预览不折叠。恢复直接执行，无确认框，统一 2 秒 Notice“已恢复默认设置”；容器通过 `aria-labelledby` 命名，避免 Obsidian 的 `aria-label` 自动提示覆盖整个区域 | `src/settings-tab.ts:section()`／`reset()`、`src/styles/index.scss`；`tests/main-settings.test.mjs`；宿主提示、触屏与布局待实测 |
| 工具栏配置块 | 各按钮使用主题次级背景、8px 圆角、10px 块间距，无列表分割线和阴影；左侧整高 32px 拖动区，上层图标／名称／排序，下层自定义位置下拉／默认开关；标准两行约 76px 高，320px 以下下层纵向排列；下拉用 sm／content：触发器 28px 高，宽度按最长选项及内边距／图标占位确定，不固定 96px；透明背景／主题细边框、5px 圆角，展开为主题主背景／主题色边框，不重复显示位置标签；“默认开启”的 Setting、文字区与控件区采用局部 flex 居中，名称 margin 清零／1.4 行高，保留宿主开关外观；不显示说明段落 | `src/settings-tab.ts`、`src/styles/index.scss`；`tests/appearance.test.mjs`；真实主题垂直对齐待验收 |
| 位置下拉列表 | owner Document body 中的 fixed 列表，不被配置滚动区裁切；默认与触发器同宽，仅超出视口时限制宽度，可上翻／内部滚动；8px 外圆角、主题细边框／主背景／轻阴影、4px 内边距；文字左侧起点与触发器相同，箭头／勾选共享图标占位；导航高亮用主题 hover 背景，当前项用主题色勾选标识，不使用固定蓝底白字 | `src/settings-select.ts`、`src/styles/index.scss`；`tests/settings-select.test.mjs`；宿主视口、主题、触屏与读屏行为待实测 |
| 可复用下拉尺寸 | size 支持 sm／md，分别为触发器 28／32px、选项最小 32／36px、左右内边距 10／12px、图标 14／16px；字号均沿用主题 UI small，不绑定固定宽度。width 支持 content（默认，所有选项叠放测 intrinsic 宽度，切换值不跳宽）／fill（100% 容器）；触发器与列表共享字体／字重／行高／字间距，每次展开复制触发器 computed 字体与局部尺寸 token 到 portal；内部尺寸变量不是公开 Style Settings 项 | `src/settings-select.ts:createSettingsSelect()`、`src/styles/index.scss`；`tests/settings-select.test.mjs`、`tests/appearance.test.mjs` |
| 工具栏预览 | 顶部固定展开两行面板，真实 Toolbar 图标／激活／More 图标；容器宽度不超过 480px 时计数另占一行，输入缩窄，不缩放按钮；纯展示、不聚焦／点击／悬停／选择，不灰化，历史禁用样式保留 | `src/ToolbarPreview.svelte`、`src/Toolbar.svelte` |
| 设置字体层级 | 工具栏配置名称／下拉／开关／恢复按钮及模拟输入统一 UI 字体／`--font-ui-small`；预览和栏目标题用 `--font-ui-medium`／半粗；空替换框 placeholder 继承模拟输入字号／行高，仅颜色用 `--text-faint`；不调整真实 Finder 输入字体 | `src/styles/index.scss`、`src/ToolbarPreview.svelte` |
| 匹配样例 | 预览下方内容自适应高度、上下 6px／左右 12px 内边距，正文用 `--font-text`／`--font-text-size`；固定英文三个 `text`，第一个当前高亮、其余普通高亮，复用公开 CSS 类及变量；无交互、窄屏自然换行、不裁切，仅模拟编辑高亮，不代表阅读 Highlight API 全部效果 | `src/ToolbarPreview.svelte`、`src/styles/index.scss` |
| 外观页固定预览 | 仅外观页使用内部满高 flex 布局、外层禁止滚动（不依赖宿主设置根节点的 display）；分类导航和整个预览不收缩，下方配置区 `min-height: 0`／独立纵向滚动，支持键盘焦点；查找模拟输入固定展示聚焦边框，但不实际聚焦；不采用悬浮窗口覆盖，不改变其他分类滚动 | `src/settings-tab.ts`、`src/ToolbarPreview.svelte`、`src/styles/index.scss`；真实宿主低高度／移动键盘待验证 |
| 颜色配置 | 三个主题次级背景分组（面板／普通／当前），六项紧凑颜色行；28px 棋盘格色块按钮、104px 只读颜色值、单项恢复；UI 小字号，360px 以下颜色行分两行。点击色块打开 owner Document 的 248px 主题面板，vanilla-colorful 内建饱和度／色相／alpha，选择器 100% 宽／180px 高，保留库的 `:host` flex 纵向布局，不用外部 display 覆盖；带十六进制输入、取消／应用；草稿仅局部预览，无分散透明度滑块 | `src/settings-tab.ts:colors()`、`src/color-picker.ts`；`tests/color-picker.test.mjs` 的布局保留回归、`tests/main-settings.test.mjs`；真实宿主修复效果待验收 |

面板／历史／设置主要采用 Obsidian `--background-*`、`--text-*`、`--interactive-*` 和字体变量，没有独立深浅主题分支。仍有固定选项蓝色／白字、非空无结果红色、黑色阴影；不能据此声称所有主题对比度合格。

本地化资源为英文／简体中文，历史长度与使用次数文案也通过翻译键显示。列表时间格式为 `YY-MM-DD HH:mm:ss`，详情为 `YYYY-MM-DD HH:mm:ss`，同时显示 moment 相对时间；合法的时间戳 0 不回退到其他字段。触屏／键盘可发现性仍需实测。依据：`src/HistoryList.svelte` 的格式化／元数据／操作样式、`src/HistoryDetail.svelte`、`src/i18n/index.ts`。

编辑高亮用 CodeMirror class，阅读高亮用 CSS Custom Highlight API；共享颜色变量，但阅读 API 不支持编辑 class 的全部边框／圆角效果。依据：`src/styles/index.scss`、`src/search-highlight.ts`、`src/reading-search.ts:updateRegistry()`。

## 应覆盖的截图分类

| 分类 | 主要状态 | 源码依据 |
| --- | --- | --- |
| 编辑查找 | 空查询、有结果、非空无结果；输入 focus；正则／大小写激活 | `src/SearchBox.svelte` |
| 编辑替换 | 展开、替换 focus、替换后当前项；计数从长变短后的行对齐 | `src/SearchBox.svelte:replaceOnce()`／`alignRows()` |
| 自定义工具栏 | 重排、More 展开／勾选、历史禁用；隐藏操作后固定入口仍存在 | `src/Toolbar.svelte`、`src/toolbar.ts` |
| 阅读查找 | 无替换入口；普通／当前高亮；跨格式／跨块结果；导航展开目标正文 | `src/reading-search.ts`、`src/reading-text.ts` |
| 阅读状态 | 等待标记、延迟提示、失败、超时、不支持；提示上翻及操作按钮 | `src/SearchStatus.svelte` |
| 历史列表 | 空态、普通／hover、部分选中／全选、长查询截断、内部滚动 | `src/HistoryList.svelte` |
| 历史详情 | 长多行正文、元数据、内部滚动、可选择文本 | `src/HistoryDetail.svelte` |
| 设置分类 | 四分类、Tab focus、工具栏边界禁用／拖动插入标记 | `src/settings-tab.ts` |
| 视图环境 | 窄分屏、同文件双分屏、弹出窗口；各自高亮和面板 | `src/editor-extension.ts`、`src/reading-search.ts` |
| 移动布局 | 查找、展开替换、More、阅读错误、历史列表／详情 | `src/SearchBox.svelte` 的移动分支及历史组件 |

核心比较应覆盖默认浅／深主题；社区主题和 Android／iOS 只能按明确选择的目标记录，不假设全部支持。截图不能证明键盘、IME、隐藏焦点、异步取消或资源释放，需配合测试和真实应用验收。

## 基线记录规则与现有资产

每组真实基线记录：资产相对路径、源码 commit、Obsidian／系统版本、主题／CSS snippets、语言、视口／缩放、笔记样例、查询、相关设置及状态。历史截图固定时间数据，避免相对时间变化造成噪声；动画比较需说明捕获的是稳定状态还是过渡帧。

仓库现有资产为 [`screenshot/demo.gif`](../../screenshot/demo.gif)，Git 最近修改记录为 `5d5f0f6`（2024 年）。它是早期演示，不作为现行阅读、历史、自定义工具栏的完整基线。没有真实截图证据时，不填造资产路径或通过结论。

真实应用验证方法见 [testing](../testing.md#实际应用验收)。
