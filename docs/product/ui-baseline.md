# 视觉约束与截图基线

本文件区分源码中的视觉事实和真实截图证据。截图分类用于确定比较范围，不是采集任务进度。交互语义见 [interactions](interactions.md)。

## 样式来源与兼容接口

- 全局变量、编辑高亮、阅读 `::highlight`、设置样式来自 `src/styles/index.scss`，构建为 `dist/styles.css`。
- 六个 Svelte 组件有自己的 scoped CSS／SCSS；`esbuild.config.mjs` 使用 `css: "injected"`，组件样式不全部存在于全局样式产物中。
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
| 历史 | 容器 70vh／padding 24px；列表内部滚动、查询两行截断、选中高亮；操作在 hover／focus-within 显示，无 hover 设备常显 | `src/HistoryModal.ts`、`src/HistoryModal.svelte`、`src/HistoryList.svelte` |
| 历史详情 | 响应式元数据 Grid；正文 pre-wrap、等宽字体、可选中、独立滚动 | `src/HistoryDetail.svelte` |
| 设置 | 原生 Obsidian 控件；分类 tabs、拖动半透明及插入线限定在 `.nya-settings` | `src/settings-tab.ts`、`src/styles/index.scss` |

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
