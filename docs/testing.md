# 测试与实机验收

命令均在仓库根目录执行。

## 自动检查

```sh
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

测试使用 Node.js test runner；部分 TypeScript/Svelte 操作经 `tests/source-loader.mjs` 加载，DOM 交互使用 jsdom，部分测试编译实际 Svelte 组件。测试中的 Obsidian 渲染器与 Highlight API 使用替身，不等同于真实宿主。

## 主要覆盖

- 阅读文本、跨格式匹配、离屏计数、大小写、正则和高亮端点。
- 虚拟化移出／挂回、离屏挂载后定位、跨块结果。
- 渲染等待、保留用户导航意图、超时、异常及重试。
- 隐藏文本、折叠正文、行尾空白和空表格单元格。
- 视图隔离、模式／文件切换、窗口迁移及资源释放。
- 编辑模式查找与替换、正则模板、历史统计、迁移和保存队列回归。
- 输入法组合输入期间的 Enter／NumpadEnter 与上下键不触发导航、替换或历史操作。
- 单次替换的按钮、Enter 与命令入口一致性，以及隐藏面板焦点和重新打开后的选中状态。
- 替换转义的真实 NUL、连续反斜杠、未知转义与设置开关边界。
- 统一关闭入口、清空两种输入、隐藏 Escape、模式异常与保留正则／大小写偏好。
- 历史项重排／删除／裁剪后的邻近项浏览；跨模块实例存储队列、损坏 JSON 和 I/O 失败；迟到布局初始化。
- 异步模式切换拒绝、乱序完成、编辑器重建与关闭／查询变化／卸载后的迟到定位；替换正文只提交一次。
- `consistency.test.mjs` 检查版本、翻译键、设置／命令文档及 CSS 示例默认值；CI 核对构建 manifest 与源文件一致。

相关测试保留在 [`tests/`](../tests/)，例如 `reading-search.test.mjs`、`reading-commands.test.mjs` 和 `search-box-dom.test.mjs`。当前覆盖情况以测试文件和运行结果为准，不在文档中固定测试总数。

## 逻辑性能诊断

```sh
node tests/reading-benchmark.mjs
node --expose-gc tests/search-benchmark.mjs
```

脚本用 100／1,000／5,000 个分块与递增匹配数量，输出首次索引时间、导航中位时间及绘制 Range 数量。它不属于自动正确性测试套件，也不提供固定性能门槛。

jsdom 数据只反映当前机器上的逻辑开销，不能证明 Chromium 绘制、滚动或移动端性能。避免和完整测试／构建同时运行以减少测量噪声。不要使用可能发生灾难性回溯的正则进行日常库压力测试。

`search-benchmark.mjs` 分别记录索引、正则、端点映射、Range、观察器、高亮与挂载定位的独占逻辑时间，覆盖无／低／高匹配密度、上下文正则、查询变化及正文变化；编辑部分只测匹配与单次／全部模板展开，不包含 CodeMirror 事务。heap delta 不是峰值内存，`otherMs` 包含未单独计时的分块和结果整理。

## 可选宿主方法验证

```sh
node tests/host-contract-check.mjs /path/to/obsidian.asar
```

脚本只读提取指定安装包中的存储、队列、布局和卸载方法，在内存文件系统和 UI 服务边界运行当前插件源码，输出 app.js 校验值与验证范围。宿主代码未打包进仓库，不在普通 CI 强制依赖本机安装；方法形状变化时显式失败。该验证不是完整 Obsidian GUI、移动存储或真实磁盘验收。

## 实际应用验收

以下是可重复执行的方法，不是通过记录或任务进度。自动测试不能代替真实 Obsidian 的布局、Highlight 绘制、私有接口滚动和平台验收；验证能力边界见 [compatibility](compatibility.md#验证能力)。

### 准备与结果口径

- 使用临时测试库，安装构建的 `dist/main.js`、`dist/styles.css`、`dist/manifest.json`，不覆盖日常库的数据。
- 阅读查找关闭“阅读模式下使用 Obsidian 搜索”；复制 [测试笔记](../tests/fixtures/reading-search.md)，在尾部前加入长正文制造离屏分块。
- 记录源码 commit、产物来源、Obsidian／系统版本、主题／snippets、语言、缩放、重现步骤及实际结果。未执行与失败要区分，不由本方法表推定通过。
- 具体结果留在 OpenCode 会话或有明确版本／环境的验收记录中，不在本文件维护勾选进度。
- 关闭契约已有源码及自动回归，见 [关闭契约](product/interactions.md#已批准的关闭契约)；仍需按真实宿主记录验收结果。

### 编辑与输入场景

| 场景 | 操作与预期 |
| --- | --- |
| IME | 中文输入法在查找／替换框确认候选词：Enter 不导航／替换，上下键不浏览历史；组合结束后普通 Enter 恢复操作 |
| 单次替换入口 | 对 `cat cat` 执行 `cat → cat!`，分别用按钮、Enter 和命令；文本、当前匹配及滚动位置一致 |
| 隐藏与重新打开 | 关闭后 Tab／Shift+Tab 不进入隐藏控件，More 关闭；重新打开聚焦并选中查询。覆盖编辑／阅读、展开／折叠及目标移动平台 |
| 文档安全 | 同文件双分屏独立当前项；改正文、撤销／重做、换文件／模式后不使用旧坐标；后台重算不主动滚动 |
| 关闭语义 | 各用户关闭入口一致；清空开关清两种输入但保留选项；隐藏后 Escape 无副作用；缺失／非布尔／抛错 livePreview 偏好不写模式 |

行为依据：`src/SearchBox.svelte`、`src/editor-extension.ts`；自动回归参见 `tests/search-box-dom.test.mjs`、`tests/editor-isolation.test.mjs`、`tests/replacement.test.mjs`。

### 阅读场景

| 场景 | 操作与预期 |
| --- | --- |
| 离屏全文 | 首次打开长文、未滚动到底，搜索 `tail-only-cat` 得到完整数量并直接定位，不发布视口局部数量 |
| 虚拟化与导航 | 搜索 `cat`，反复滚动首尾／连续前后导航；离屏挂回后仍有高亮，数量、当前项和定位一致 |
| 格式与边界 | `hello world` 跨行内格式／代码着色节点匹配；大小写、正则前后顾／锚点／跨块符合 [正文规则](product/features.md#阅读模式正文)；不改写正文文本，不影响链接或复制 |
| 空白与空单元格 | 行尾可折叠空白不制造匹配；连续硬换行保留；三个表格单元格中间为空仍有两个制表符 |
| 隐藏与折叠 | 明确 CSS 隐藏内容排除；折叠列表／Callout 的支持正文可搜索，导航展开必要祖先。标题／details 按真实宿主结构单独检查，不扩大既定支持范围 |
| 重渲染 | 等待中的用户定位不被后台刷新取消；后台重算不主动滚动 |
| 超时／异常 | 渲染超过默认 5 秒显示超时；定位／Highlight 失败显示错误而非无结果；恢复后重试可用，无残留高亮 |
| 原生入口 | 原生偏好保留；不支持或用户主动降级时关闭插件面板，不同时留下两套可见查找面板 |

依据：`src/reading-text.ts`、`src/reading-search.ts`、`src/SearchStatus.svelte`；自动回归参见 `tests/reading-search.test.mjs`、`tests/reading-commands.test.mjs`。

### 环境、生命周期与性能

- 同文件双分屏独立导航；正常关闭一个视图不清另一个的阅读高亮。
- 弹出窗口和窗口迁移后，高亮、模式观察器及 Escape 使用所属 Document 并正常工作。
- 反复打开／关闭 Finder 和标签页、卸载插件后核对监听、Observer、计时器和高亮释放；历史 Modal 卸载清理单独验证，不能由 Finder 清理推定。
- 默认浅／深主题、明确选择的社区主题和目标 Android／iOS 分别记录结果；特别检查离屏节点依赖祖先／相邻选择器的 computed style、触屏操作可发现性和焦点。
- 使用 100／1,000／5,000 分块及不同匹配密度观察首次索引、连续输入、导航和滚动体验；逻辑基准不能代替这些实机测量。不要用危险正则做压力测试，渲染超时无法中断同步回溯。
- 公式、图表、嵌入和任意第三方动态输出不承诺全文兼容。截图范围与记录格式见 [ui-baseline](product/ui-baseline.md)。
