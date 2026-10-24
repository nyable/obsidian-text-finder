# 视觉约束与截图基线

本文件区分源码中的视觉事实和真实截图证据。截图分类用于确定比较范围，不是采集任务进度。交互语义见 [interactions](interactions.md)。

Finder 模板／CSS 在 `src/features/finder/ui/FinderPanel.vue`，交互效果在 `src/features/finder/interaction/`。内部重构不授权改变外观。当前历史标题／统计／日期由 Vue 模板直接输出；`src/shared/ui/TextRun.ts` 尚未被业务组件使用，不能把该闲置组件当作视觉等价的实现证据。视觉变化以实际模板、共享样式及严格截图比较核对。

## 样式来源与兼容接口

笔记菜单使用宿主 Menu／MenuItem 的原生样式，不新增 CSS、容器 aria-label 或重复 title 提示。右上角一个带 Text Finder 前缀的查找项（find 分组），正文选择两个带前缀的操作（selection 分组）；阅读纯正文另保留 clipboard 分组的复制选中文字，链接继续复用宿主原项。实际排序、菜单合并、边缘提示及移动长按菜单须实机验收；`tests/integration/finder-menus.test.mjs` 只能证明项目语义和事件路由。

- 全局变量、编辑高亮、阅读 `::highlight`、设置样式来自 `src/styles/index.scss`，构建为 `dist/styles.css`。
- Vue scoped CSS／SCSS 与全局样式统一输出到 `dist/styles.css`，由 Obsidian 加载，不再运行 Svelte 样式注入。公开类／变量保持，移动祖先选择器和主题覆盖须保持原行为。框架 scope ID 属于内部实现。
- 固定布局／状态样式使用 CSS：Modal content 的 flex／溢出／padding 由 `.nya-library-host` 定义，Finder 隐藏／收起由既有状态类控制，阅读 overlay 用 `nya-reading-overlay--hidden`，安全区探针用 `nya-safe-area-probe`。动态位置、尺寸、裁切和颜色仍按 owner 测量写入；`inert`／aria-hidden／焦点防护继续独立同步。收起隐藏规则位于 desktop／custom／mobile display 声明之后，保持全部布局一致。
- `src/features/settings/ui/ToolbarPreview.vue` 与真实 Finder／Toolbar 通过 `src/styles/finder-primitives.scss` 共享面板、输入、按钮、计数和焦点样式，容器定位与窄宽布局独立。
- `src/features/settings/ui/appearance-styles.ts:AppearanceStyles` 为显式自定义颜色及已开启的选区边框粗细生成按 Document 管理的 `body` 变量覆盖（`!important`）；默认没有覆盖样式，恢复时移除对应声明，卸载／窗口关闭移除插件样式，不改写宿主 inline style。更具体或 inline 的 `!important` 用户规则仍可能优先，不能承诺覆盖任意 CSS。
- 公开 CSS 类包括 `.nya-finder`（面板位置）、`.nya-toggle`（替换行折叠箭头）、`.nya-dragger`（左侧装饰条／桌面拖动入口）、`.nya-text-finder-match` 和 `.nya-text-finder-match-current`（编辑匹配高亮）。README 只链接本节，不再展开 CSS 示例；删除首页示例不改变这些兼容接口。
- **兼容性推断：**公开类／变量是用户 CSS 接口，须保留名称与作用；框架自动生成的 scope ID 不视为公开接口。改变 CSS 注入／作用域时须核对级联和宿主窗口，不只复制全局 SCSS。

依据：`src/styles/index.scss`、`src/features/finder/ui/FinderPanel.vue` 及其他 Vue SFC 的 `<style>`、`vite.config.mjs`、`tools/vite-build.mjs`、`style-settings.css`。

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

### CSS 自定义

优先使用插件“外观”设置；进一步自定义可使用 [Obsidian CSS 代码片段](https://help.obsidian.md/Extending+Obsidian/CSS+snippets)。例如，下列变量同时影响编辑与阅读匹配颜色，装饰条使用独立变量，不通过给折叠箭头添加边框来改色：

```css
body {
	--nya-match-bgColor: #ea5c0054;
	--nya-match-color: inherit;
	--nya-match-curbgColor: #ffcc00;
	--nya-match-curColor: #000000;
	--nya-dragger-color: #39c5bb;
}
```

编辑高亮类还可设置边框／圆角，但阅读 Custom Highlight API 不支持全部相同效果。显式外观颜色会以 `!important` 覆盖变量；若要重新继承片段／主题，先恢复对应颜色设置。面板位置优先通过拖动调整，避免固定像素定位与移动端／分屏约束冲突。

[Style Settings 配置文件](../../style-settings.css)是独立示例，不是插件自动注册的设置页：`style-settings.css` 没有作为构建入口导入。使用时将该文件保存为 Vault 的 CSS 代码片段并启用，再打开 [Style Settings 插件](https://github.com/mgmeyers/obsidian-style-settings)；仅安装该插件不会自动注册此示例。

## 当前布局与主题事实

**设置统一布局：**按用户批准，所有支持版本均使用下表的五分类、固定预览和默认折叠布局，不再维护 1.13+ 声明式分组／外观子页或全局设置搜索逐项索引。移除仅服务声明式行的局部 CSS，其余设置与 Finder 公开样式保持。模拟截图不证明新版宿主视觉通过。依据：`src/app/settings-tab.ts`、`src/features/settings/ui/settings-view.ts`、`src/styles/index.scss`。

| 区域 | 源码事实 | 依据 |
| --- | --- | --- |
| 桌面 Finder | 绝对定位 top 88px／right 48px；展开 72px、折叠 38px；4px 圆角、阴影、边框；隐藏同步 transform／visibility／opacity，但仅 opacity 过渡，避免重开时采样动画坐标导致按下跳位 | `src/features/finder/ui/FinderPanel.vue`、`interaction/panel-presentation.ts`、`tests/browser/drag.spec.mjs` |
| 输入与按钮 | 桌面输入高 28px，移动输入 30px；可收缩以适配 owner 可见宽度；图标 18px；工具栏按钮 24×24px、margin 2px、padding 4px | `src/features/finder/ui/FinderPanel.vue`、`FinderToolbar.vue` |
| 移动替换行箭头 | `.nya-toggle` 用 auto 高度／align-self stretch 随单行／双行面板纵向拉伸，上下各留 2px，不依赖自然高度父容器的百分比高度；保留 16px 宽度、18px 图标、原操作名称及桌面尺寸 | `src/features/finder/ui/FinderPanel.vue`；`tests/component/finder-panel.test.mjs` 的 `real mobile branch uses equal row heights, centered top grip and original collapse arrow`、`tests/browser/harness.mjs` 的 production mobile replace arrow 检查；真实移动宿主触摸及主题仍需验收 |
| 默认／自定义布局 | 默认替换行测量当前计数和操作区做补偿；自定义工具栏用 Grid，阅读／移动／折叠不使用默认补偿 | `src/features/finder/interaction/row-alignment.ts` 及 `.nya-finder--custom-toolbar` |
| 移动布局 | 默认居中，最大 416px 且限制 owner／视口；面板 border-box／自然高度，输入行 min-height 38px（上下各 4px 留白），单行框含边框 40px；结果栏 min-height 40px／上下 4px 留白，两侧与面板外边框对齐。三列 Grid：计数在左、中央 72×30px 拖动区上沿显示 32×4px 圆角横条、右侧溢出操作及关闭；计数省略，操作在自己的区域换行增高，不覆盖中央手柄。查找／替换输入 border-box 30px、上下 padding 4px、1px 边框、16px 字号／20px 行高、overflow auto／overscroll contain，空／单行内容在尺寸上可完整容纳，多行／长文本保留滚动。More 原位，替换动作仍在替换行 | `src/features/finder/ui/FinderPanel.vue`、`src/features/finder/interaction/mobile-toolbar.ts`；jsdom 尺寸计算不证明真机空输入滚动或字体绘制 |
| 面板移动／贴边 | 桌面左侧装饰条直接拖动，命中区约 12px（主要向框外扩展，不覆盖箭头）；移动端中央顶部横条与结果／关闭一体，只拖动区 touch-action none，不拦截计数／关闭区域触摸。3px 位移后 opacity 0.8，无长按，位置不做过渡；候选主题色边框反馈；收起标记桌面 30×30px／移动 40×40px、16px 图标、无阴影。移动入口 aria-labelledby、不产生大片提示；二维拖动／单击展开，尊重 reduced-motion | `src/features/finder/ui/FinderPanel.vue`、`src/features/finder/interaction/finder-position.ts`；真机中央命中／边缘系统手势／键盘避让待实测 |
| 收起入口主题与初始位置 | 收起态使用 `--background-secondary` 背景／`--background-modifier-border` 细边框／`--text-normal` 图标，8px 圆角、无面板阴影；内部按钮继承圆角，hover／active 使用主题交互背景，focus-visible 保留主题色焦点框。移动收起态不继承完整框居中 transform，默认按 `finderDockSide` 靠安全边界（缺省右侧，留白 8px）；布局提交后再次校正，无 transform／right 过渡干扰紧凑定位。手动停放不因后台刷新回边缘 | `src/features/finder/application/finder-session.ts:showFloatingEntry()`、`ui/FinderPanel.vue`、`interaction/finder-position.ts:measure()`；深浅主题实际对比度／移动端首次贴边需实机验收 |
| 移动长按范围 | 移动 `.nya-move-handle`／`.nya-dock-expand` 局部 `-webkit-touch-callout: none`／`user-select: none`，阻止菜单默认行为及冒泡，不添加新按钮；桌面收起菜单保留。查找／替换 textarea 不屏蔽 contextmenu 或选词，不作全局触摸菜单禁用 | `src/features/finder/interaction/panel-presentation.ts:dockMenu()`、`drag-handle.ts`；自动事件回归不证明 iOS／Android callout 实际抑制 |
| 展开定位／过渡与拖动焦点 | 桌面及移动完整框和收起态均无 right／transform 位置动画，仅 opacity：普通态 0.2s linear，拖动／收起态 0.12s ease。展开宽度沿用现有限制，满宽居中，较窄围绕标记并限制到安全边界；避免动画完成后 translate 补偿过期。鼠标按下拖动柄不主动聚焦、不新增主题色轮廓；键盘进入仍显示原有 focus-visible 轮廓。reduced-motion 用优先规则禁用过渡，包括更高 specificity 的移动／拖动态 | `src/features/finder/ui/FinderPanel.vue`／reduced-motion、`interaction/finder-position.ts:update()`／`measureGeometry()`、`drag-handle.ts`；`tests/component/finder-panel.test.mjs`、`tests/browser/drag.spec.mjs`，非宿主／Android 验收 |
| More | 右侧绝对定位的紧凑图标按钮组，无 180px 最小宽；横向自然宽度、4px padding、可换行，最大 300px 且受 owner／可见视口约束。按钮复用外部 24×24px／18px 图标及激活／禁用样式，无列表文字／勾号。收起且内部有模式开启时，右上角绝对定位的 5px 主题 `--interactive-accent` 圆点提示，触发器不使用模式激活蓝底／边框；展开隐藏圆点，仅用内边框反馈，收起按当前状态恢复。圆点无动画／点击区域，不改变几何；设置预览同步圆点。工具栏额外焦点框用 `:focus-visible` 的 2px outline，不再对所有 focus 绘制蓝色阴影；输入及其他 Finder 控件不变 | `src/features/finder/ui/FinderToolbar.vue`、`src/styles/finder-primitives.scss`；真实鼠标／键盘 focus-visible、窄宽／移动／主题及悬浮提示待验收 |
| 全字匹配控件 | `WholeWord`／`whole-word` 图标，复用既有 18px 图标、按钮几何、激活／聚焦样式，More 内外均用 `aria-pressed`；默认顺序为正则、大小写、全字匹配、上一项、下一项。设置支持默认开启和纯展示激活预览；不改变公开宽度变量 | `src/features/finder/model/toolbar.ts`、`ui/FinderToolbar.vue`、`src/features/settings/ui/settings-view.ts`、`ToolbarPreview.vue`；窄分屏、移动端与宿主悬浮提示待实测 |
| 选区范围 | `TextSelect`／`text-select` 图标，默认在 More，可配置常驻／隐藏，无默认开启；编辑／阅读均可用。以按钮激活态表达，计数旁无文字标记；同模式空／失效范围仍激活，操作按钮提示恢复方式；编辑／阅读互切自动关闭此按钮、清旧范围及其 More 指示，不改变其他选项；隐藏按钮不增加替代标记。正文 `.nya-text-finder-scope` 默认主题淡背景，可自定义及开启独立外轮廓，无下划线，不覆盖匹配颜色；保留既有公开 CSS 变量 | `src/platform/codemirror/search-scope.ts`、`src/features/finder/application/search-scope.ts`、`src/shared/geometry/scope-outline.ts`、`src/features/finder/ui/FinderToolbar.vue`、`FinderPanel.vue`、`src/styles/index.scss`；主题对比及实机范围绘制待验收 |
| 查找状态 | 编辑／阅读均使用面板外部提示，空间不足时上翻；等待文案不拦截指针，取消／重试／同步重试操作可点击 | `src/features/finder/ui/SearchStatus.vue:position()` 及样式 |
| 替换状态 | 候选计算显示尚未写入；提交后重算显示已完成、取消不撤销；失败文案区分提交前和提交后 | `src/features/finder/application/finder-session.ts:replaceMatches()`、`ui/SearchStatus.vue` |
| 历史／预设弹窗 | 宿主 Modal 限定 640px 及可用视口宽高；外壳目标高度 560px，按 owner visualViewport／动态视口减 80px 限制（窄屏减 64px），不随内容量变化，不设高度动画；20px 留白（窄屏 16px）。列表去掉可见标题及其占位行，保留唯一读屏文本用于分类命名；Tab 与插件设置共用 compact-tabs 样式（32px／触屏或窄屏 36px，左右 12px／上下 5px 内边距，4px 间距，5px 圆角 hover，独立下划线）。分类、筛选、等高工具条固定，中间列表 flex 填满并独立滚动，分类各自保留滚动位置。新建加号与计数在预设工具条内左对齐，历史不显示。列表底部不设常驻说明或空占位栏；删除撤销为弹窗内短暂浮层，不挤压列表。常显复选框，无管理模式，无大片 aria-label 提示；编辑／详情的内部标题不受影响 | `src/app/history-modal.ts`、`src/features/history/ui/HistoryPanel.vue`、`HistoryList.vue`、`HistorySelectionBar.vue`、`src/styles/search-library.scss`、`src/styles/_compact-tabs.scss` |
| 历史详情 | 顶部固定紧凑双列统计（次数、长度、创建和最后使用完整时间），下方淡分隔线；中间等宽 pre-wrap 完整原文可选中、独立滚动，底部文字操作固定，低高度也不改为整页滚动。复制／保存预设为轻填充细边框，删除为主题错误色文字及边框（保留 mod-warning），hover 有主题反馈；复用保留主操作。返回恢复列表上下文 | `src/features/history/ui/HistoryDetail.vue`、`src/styles/search-library.scss`；组件结构与浏览器普通／400px 高度滚动回归 |
| 历史列表反馈／统计 | 整行 hover／selected 统一主题背景，查询按钮、复选框及行内操作不叠 hover 底色或阴影，图标保留颜色反馈、各控件保留键盘焦点和独立操作。外层三列 Grid，查询下方独立统计行横跨查询和操作列，次数／UTF-16 长度／相对时间作为一组右对齐到操作列右边缘，不压窄查询。三项同字号（主题 smaller，缺失时比正文小 1px，最小 10px）、同次级文字色、正常字重，无徽章／加粗；不显示时间字段前缀，读屏专用文字保留含义，查询按钮以唯一 aria-describedby 引用整组统计。横向间距 10px、换行间距 3px，窄屏 flex-wrap 仍右对齐，时间可内部换行，不挤出列边界；原文两行预览不变 | `src/features/history/ui/HistoryList.vue`、`src/styles/search-library.scss`；`tests/component/history-panel.test.mjs`、`tests/browser/harness.mjs` |
| 预设列表 | 卡片常态透明、与弹窗同底色，淡边界与 12px 间隔，无上浮／重阴影；摘要外壳背景和边框透明，保留几何，不再叠独立面板，只为查找／替换值框保留主题次级轻底色。左侧拖动区贯穿卡片内高且不越出自身列，抓取指针／无悬浮文字提示，读屏名称引用唯一隐藏文本。中心顶部为名称、下方为 Finder 风格配置摘要，右侧竖排编辑／删除；整卡 hover／键盘 focus-visible 覆盖统一背景及边界，中间按钮透明／无独立 hover 内框，不新增持久选中状态。应用区及真实操作按钮使用手形指针，操作目标不合并。FinderRecipeFrame 共用 Finder 表现原语与三个静态匹配图标，不受真实工具栏配置影响，不放导航／替换／历史／More／选区。随保存折叠状态显示查找／替换行；两值区共享列宽，固定 28px 单行，显示首行、超长省略，多行在右端显示换行图标及实际行数，首行空白不跳过；读屏及应用仍用精确全文。空替换显示为空，不塞解释文案；窄容器匹配图标另起一行，不横向挤出 | `src/features/finder/ui/FinderRecipeFrame.vue`、`src/features/presets/ui/PresetList.vue`、`src/styles/search-library.scss` |
| 预设编辑 | 与列表预览分开设计：名称、独立匹配图标区域、查找 textarea、替换 textarea、底部独立其他设置区域。两个 textarea 均固定 4 行（1.5 行高＋上下内边距），禁止 resize，超出内容内部滚动；输入保留空白／换行。折叠配置不隐藏编辑输入框，不包含替换时仍可编辑草稿但不保存其值。其他设置仅包含替换、应用后收起，每项下方常显次级文字短说明并以 aria-describedby 关联；转义统一跟随全局设置，无预设开关。编辑底部为保存／取消／另存为预设；另存切换为同壳命名步骤（预填／全选、名称下重名提示），底部改为创建预设／返回编辑；不新增嵌套弹窗，配置草稿保留。字段滚动、操作固定，保留低高度整页滚动降级 | `src/features/presets/ui/PresetEditor.vue`、`src/shared/ui/MatchOptions.vue`、`src/styles/search-library.scss` |
| 设置 | 原生 Obsidian 控件；分类顺序常规／查找／替换／搜索历史／外观，默认常规。常规页仅放自动悬浮入口、拖边自动收起，移除恢复位置按钮；查找页不再显示阅读原生查找开关。沿用原生开关，不增加提示容器或新装饰。分类 tabs、拖动半透明及插入线限定在 `.nya-settings` | `src/features/settings/ui/settings-view.ts`、`src/styles/index.scss` |
| 设置分类交互 | 与历史／预设分类共用局部 compact-tabs mixin：最小 32px 高、触屏或 480px 以下 36px；上下 5px／左右 12px 内边距、4px 间距、5px 圆角。悬停为主题 hover 背景／正文色，当前项为独立 2px 主题色下划线／主题色文字，按下为主题 active-hover 背景（缺失时回退 hover），键盘 focus-visible 保留 2px 焦点框；分类条仅允许横向滚动，显式隐藏 Y 轴溢出，下划线位于底部 4px 留白内，不形成纵向溢出或被裁切；设置分类距内容 12px。不添加悬浮容器标签、不改其他宿主 Tab | `src/styles/_compact-tabs.scss`、`src/styles/index.scss`、`src/styles/search-library.scss`；`tests/unit/appearance.test.mjs`、`tests/browser/compact-tabs.mjs`、`tests/browser/settings.spec.mjs`、`tests/browser/harness.mjs`；真实主题与触屏反馈待验收 |
| 外观配置标题 | 颜色／搜索选区／搜索工具栏／替换工具栏四个分组独立折叠，默认全收起；分组底部间距 8px、标题无额外上下 margin，展开正文距标题 6px，标题及恢复图标仍有 32px 点击高度；标题前 16px 箭头，折叠时朝右，标题与恢复按钮分离；`undo-2` 回退图标紧邻标题，16px 图标／32px 点击区域，常显，提示“恢复默认设置”。内容 hidden 时 display none，无折叠动画；顶部预览不折叠。恢复直接执行，无确认框，统一 2 秒 Notice“已恢复默认设置”；容器通过 `aria-labelledby` 命名，避免 Obsidian 的 `aria-label` 自动提示覆盖整个区域 | `src/features/settings/ui/settings-view.ts:section()`／`reset()`、`src/styles/index.scss`；`tests/integration/main-settings.test.mjs`；宿主提示、触屏与布局待实测 |
| 工具栏配置块 | 各按钮使用主题次级背景、8px 圆角、10px 块间距，无列表分割线和阴影；左侧整高 32px 拖动区，上层图标／名称／排序，下层自定义位置下拉／默认开关；上下行 min-height 32px、行间 8px，统一左右边界及居中，360px 以下下层纵向排列；下拉用 sm／content：触发器 28px 高，宽度按最长选项及内边距／图标占位确定，不固定 96px；透明背景／主题细边框、5px 圆角，展开为主题主背景／主题色边框，不重复显示位置标签；“默认开启”的 Setting、文字区与控件区采用局部 flex 居中，名称 margin 清零／1.4 行高，保留宿主开关外观；不显示说明段落 | `src/features/settings/ui/settings-view.ts`、`src/styles/index.scss`；`tests/unit/appearance.test.mjs`；真实主题垂直对齐待验收 |
| 位置下拉列表 | owner Document body 中的 fixed 列表，不被配置滚动区裁切；默认与触发器同宽，仅超出视口时限制宽度，可上翻／内部滚动；8px 外圆角、主题细边框／主背景／轻阴影、4px 内边距；文字左侧起点与触发器相同，箭头／勾选共享图标占位；导航高亮用主题 hover 背景，当前项用主题色勾选标识，不使用固定蓝底白字 | `src/features/settings/ui/settings-select.ts`、`src/styles/index.scss`；`tests/component/settings-select.test.mjs`；宿主视口、主题、触屏与读屏行为待实测 |
| 可复用下拉尺寸 | size 支持 sm／md，分别为触发器 28／32px、选项最小 32／36px、左右内边距 10／12px、图标 14／16px；字号均沿用主题 UI small，不绑定固定宽度。width 支持 content（默认，所有选项叠放测 intrinsic 宽度，切换值不跳宽）／fill（100% 容器）；触发器与列表共享字体／字重／行高／字间距，每次展开复制触发器 computed 字体与局部尺寸 token 到 portal；内部尺寸变量不是公开 Style Settings 项 | `src/features/settings/ui/settings-select.ts:createSettingsSelect()`、`src/styles/index.scss`；`tests/component/settings-select.test.mjs`、`tests/unit/appearance.test.mjs` |
| 工具栏预览 | 顶部固定展开两行面板，真实 Toolbar 图标／激活／More 图标；容器宽度不超过 480px 时计数另占一行，输入缩窄，不缩放按钮；纯展示、不聚焦／点击／悬停／选择，不灰化，历史禁用样式保留 | `src/features/settings/ui/ToolbarPreview.vue`、`src/features/finder/ui/FinderToolbar.vue` |
| 设置字体层级 | 工具栏配置名称／下拉／开关／恢复按钮及模拟输入统一 UI 字体／`--font-ui-small`；预览和栏目标题用 `--font-ui-medium`／半粗；空替换框 placeholder 继承模拟输入字号／行高，仅颜色用 `--text-faint`；不调整真实 Finder 输入字体 | `src/styles/index.scss`、`src/features/settings/ui/ToolbarPreview.vue` |
| 匹配及选区综合样例 | 仅一个两行文本区域 `.nya-preview-text.nya-preview-scope`，上下 8px／左右 12px 内边距，正文用 `--font-text`／`--font-text-size`；固定英文三个 `text`，一个当前、两个普通，均在首尾不齐的跨行选区中，外侧保留未选文字。复用公开 CSS 类及变量；无交互、窄屏自然换行、不裁切或缩字，仅模拟编辑呈现，不代表阅读 Highlight API 全部效果 | `src/features/settings/ui/ToolbarPreview.vue`、`src/styles/index.scss` |
| 外观页固定预览 | 仅外观页使用内部满高 flex 布局、外层禁止滚动（不依赖宿主设置根节点的 display）；分类导航和整个预览不收缩，下方配置区 `min-height: 0`／独立纵向滚动，支持键盘焦点；查找模拟输入固定展示聚焦边框，但不实际聚焦；不采用悬浮窗口覆盖，不改变其他分类滚动 | `src/features/settings/ui/settings-view.ts`、`ToolbarPreview.vue`、`src/styles/index.scss`；真实宿主低高度／移动键盘待验证 |
| 颜色配置 | 三个主题次级背景分组（面板／普通／当前），六项紧凑颜色行；28px 棋盘格色块按钮、104px 只读颜色值、单项恢复；UI 小字号，360px 以下颜色行分两行。点击色块打开 owner Document 的 248px 主题面板，vanilla-colorful 内建饱和度／色相／alpha，选择器 100% 宽／180px 高，保留库的 `:host` flex 纵向布局，不用外部 display 覆盖；带十六进制输入、取消／应用；草稿仅局部预览，无分散透明度滑块 | `src/features/settings/ui/settings-view.ts:colors()`、`color-picker.ts`；`tests/component/color-picker.test.mjs` 的布局保留回归、`tests/integration/main-settings.test.mjs`；真实宿主修复效果待验收 |

面板／历史／设置主要采用 Obsidian `--background-*`、`--text-*`、`--interactive-*` 和字体变量，没有独立深浅主题分支。仍有固定选项蓝色／白字、非空无结果红色、黑色阴影；不能据此声称所有主题对比度合格。

搜索选区外观补充：默认淡背景无边框；独立的“搜索选区”折叠组支持背景／边框 alpha、轮廓开关及 1–3px 粗细，单项及分组恢复作用域独立。正文 `.nya-scope-layer`／`.nya-scope-outline` 以矩形并集外边绘制，不给每个 mark 加边框，不拦截输入；设置增加 `.nya-preview-scope` 两行静态样例及相同测量算法。默认继承宿主背景／强调色，不固定新配色。同范围完整选中且可见的普通空白行按上下文字共同宽度连接，无重叠时经实际插入点形成窄阶梯；不填满整行或改变背景。隐藏／折叠源码、歧义 bidi 片段与独立选区仍可断开；主题、折行、缩放、滚动、实时预览及移动设备实际绘制待验收。依据：`src/platform/codemirror/scope-geometry.ts`、`search-scope.ts`、`src/shared/geometry/scope-outline.ts`、`src/features/settings/ui/ToolbarPreview.vue`、`settings-view.ts:scopeStyles()`。

换行匹配：编辑模式 `.nya-newline-layer` 的 `.nya-newline-match` 用 `::before` 显示小型 `↵`（RTL 镜像），置于真实换行的测量行尾，复用普通／当前匹配类和颜色；大小按测得字符宽度及行高约束。仅绘制已匹配换行，不标软折行或无换行的文末；连续换行每个位置可见，计数按原匹配。marker 不占布局、不插入 DOM 文本、无交互／焦点／额外提示，aria-hidden；阅读和现有两行设置样例不增源码标记。行尾裁切、深浅主题对比度及引用／列表／实时预览需实测。依据：`src/platform/codemirror/search-highlight.ts:newlineMatchLayer`、`src/styles/index.scss`、`tests/integration/editor-whitespace.test.mjs`。

外观行布局统一：颜色组 12px 内边距、Grid 8px 行距；颜色行／轮廓开关 min-height 32px、列距 12px，名称左对齐、操作右对齐，色块／104px 颜色值／恢复按钮纵向对齐且内部间距 8px；颜色值用 UI 字体和 tabular-nums。轮廓开关在依赖组之前，关闭 hidden 不占空间；依赖名称缩进 12px，窄宽回到同一左边界。原生 Setting 默认 margin／padding 在局部清除；360px 以下颜色行、轮廓开关及工具栏配置均采用上下布局，不影响其他设置页。轮廓左右仅半线宽外扩（内缘贴近测得字符边界），上下仍 2px + 半线宽外扩；紧间隙沿分离轴限制，水平方向收紧不取消上下净距，不增加留白设置项。正文／设置预览共用几何，不改跨行阶梯及空行连接语义。几何／样式依据 `src/shared/geometry/scope-outline.ts:paddedScopeOutlines()`、`src/styles/index.scss`；实际字体和主题对齐仍需实测。

本地化资源为英文／简体中文，历史长度与使用次数文案通过翻译键显示。列表集中显示次数、长度及无可见字段前缀的 moment 相对时间；创建排序取创建时间，其他排序取最后使用，以读屏文本区分含义，不增加悬浮提示。详情顶部固定完整时间 `YYYY-MM-DD HH:mm:ss`、次数及长度。长度沿用原文 `.length`（UTF-16，包含空白和换行），合法的时间戳 0 不回退到其他字段。触屏／键盘可发现性仍需实测。依据：`src/features/history/ui/HistoryList.vue`、`HistoryDetail.vue`、`src/platform/obsidian/date-format.ts`、`src/i18n/index.ts`。

编辑高亮用 CodeMirror class，阅读高亮用 CSS Custom Highlight API；共享颜色变量，但阅读 API 不支持编辑 class 的全部边框／圆角效果。阅读新增 `::highlight(nya-reading-scope)`（低优先级背景）和 `.nya-reading-overlay`（owner body 独立 fixed、非交互、读屏隐藏、按 owner／裁切祖先限制）；SVG 轮廓复用左右半线宽／上下 2px 净距，换行复用 `↵` 普通／当前颜色。只画挂载正文，不包裹节点，不把段落空隙补成大矩形；几何缺失时不猜测，滚动先隐藏旧位置再重测。阅读工具栏也显示范围按钮及 More 激活／失效反馈，不新增状态栏。依据：`src/styles/index.scss`、`src/platform/codemirror/search-highlight.ts`、`src/features/reading/dom/reading-search.ts:updateRegistry()`、`reading-overlay.ts`；实际叠层、裁切、主题、RTL、分屏和移动待实机验收。

## 应覆盖的截图分类

历史／预设弹窗的文字输入使用主题次级背景的轻填充，不照搬宿主表单边框；默认透明 1px 边框仅保留几何，6px 圆角及 8×12px 内边距。悬停用一圈内侧细线，聚焦只用 1px 强调色 inset 线，局部覆盖宿主 focus border／外发光／outline，不叠双框；按钮与复选框仍保留键盘外框，强制颜色模式为文本框恢复系统色边框及 focus-visible 轮廓。作用域仅 `.nya-library`，不改真实 Finder／设置页。依据：`src/styles/search-library.scss`；浏览器回归 `tests/browser/harness.mjs` 检查覆盖模拟宿主的聚焦规则。

弹窗次要文字操作（返回、取消、返回编辑、继续编辑等）显式使用主题次级背景、1px 主题边框、5px 圆角及 5×12px 内边距，hover 加强边框和背景，与页面区分；删除／丢弃以主题错误色文字和边框标明危险操作。仅通过局部专用类覆盖，不影响图标、分类 Tab、主操作及真实 Finder。组件回归覆盖类名和文字操作，浏览器覆盖主题反馈、固定详情滚动及键盘焦点；真实 Obsidian 主题对比度仍待验收。

历史列表统计在主题 smaller 字号（缺失时正文小 1px）的基础上统一再减 1px，最小 10px；三项字号、字重、颜色保持一致。历史和预设列表的删除图标使用局部 `nya-library-delete-icon` 类，常态为主题 `--text-error`，hover／键盘 focus-visible 保持危险色并将 SVG 描边加粗到 2.5，不叠第二层悬停背景；键盘焦点外框和操作名称保留。依据：`HistoryList.vue`、`PresetList.vue`、`search-library.scss`；组件和浏览器回归覆盖名称、危险色、描边及焦点。

| 分类 | 主要状态 | 源码依据 |
| --- | --- | --- |
| 编辑查找 | 空查询、有结果、非空无结果；输入 focus；正则／大小写／全字匹配激活 | `src/features/finder/ui/FinderPanel.vue` |
| 编辑替换 | 展开、替换 focus、替换后当前项；计数从长变短后的行对齐 | Finder `application/finder-session.ts`、`interaction/row-alignment.ts` |
| 自定义工具栏 | 重排、More 收起圆点／展开隐藏／内部模式激活、鼠标无额外焦点框与键盘 focus-visible、历史禁用；模式隐藏不加替代标记 | Finder `ui/FinderToolbar.vue`、`model/toolbar.ts` |
| 阅读查找 | 无替换入口；普通／当前高亮；跨格式／跨块结果；导航展开目标正文 | `src/features/reading/dom/reading-search.ts`、`reading-text.ts` |
| 阅读状态 | 等待标记、延迟提示、失败、超时、不支持；提示上翻及操作按钮 | `src/features/finder/ui/SearchStatus.vue` |
| 历史列表 | 空态、普通／hover、部分选中／全选、长查询截断、内部滚动 | `src/features/history/ui/HistoryList.vue` |
| 历史详情 | 长多行正文、元数据、内部滚动、可选择文本 | `src/features/history/ui/HistoryDetail.vue` |
| 预设 | 列表、仅查找／空替换、编辑草稿、未保存确认、删除撤销、筛选无结果 | `src/features/history/ui/HistoryPanel.vue`、`src/features/presets/ui/PresetEditor.vue` |
| 设置分类 | 五分类（常规在首位）、Tab focus、工具栏边界禁用／拖动插入标记 | `src/features/settings/ui/settings-view.ts` |
| 视图环境 | 窄分屏、同文件双分屏、弹出窗口；各自高亮和面板 | `src/app/workspace-runtime.ts`、`src/features/reading/dom/reading-search.ts` |
| 移动布局 | 查找、展开替换、More、阅读错误、历史列表／详情 | `src/features/finder/ui/FinderPanel.vue` 的移动分支及历史组件 |

核心比较应覆盖默认浅／深主题；社区主题和 Android／iOS 只能按明确选择的目标记录，不假设全部支持。截图不能证明键盘、IME、隐藏焦点、异步取消或资源释放，需配合测试和真实应用验收。

## 基线记录规则与现有资产

每组真实基线记录：资产相对路径、源码 commit、Obsidian／系统版本、主题／CSS snippets、语言、视口／缩放、笔记样例、查询、相关设置及状态。历史截图固定时间数据，避免相对时间变化造成噪声；动画比较需说明捕获的是稳定状态还是过渡帧。

仓库现有资产为 [`screenshot/demo.gif`](../../screenshot/demo.gif)，Git 最近修改记录为 `5d5f0f6`（2024 年）。它是早期演示，不作为现行阅读、历史、自定义工具栏的完整基线。没有真实截图证据时，不填造资产路径或通过结论。

自动化模拟基线另位于 `tests/browser/baselines/chromium-linux/`：40 张已审查截图，含 24 张保留的查找器／设置预览原图，以及经用户单独批准的历史／详情更新 8 张、预设列表／编辑器新增 8 张。原 32 张及原报告完整保留在 `tests/browser/baselines/archive/6823057/chromium-linux/`；当前 provenance 按图关联原／新来源报告，并记录图片及报告的 SHA-256。场景清单由 `tests/browser/visual-contracts.mjs` 共用，缺图／来源或哈希不符直接失败。`pnpm test:visual` 在固定 Linux Chromium 环境作零像素容差比较，失败保留 expected／actual／diff，不自动接受；模拟主题截图仍不等于真实 Obsidian 截图。

真实应用验证方法见 [testing](../testing.md#实际应用验收)。
