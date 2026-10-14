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
- 全字匹配默认分隔符、中文／全角标点／NBSP、下划线／数字、匹配首尾标点、组合字符／emoji／UTF-16、短语／多行及正则模板；正式 Worker 与同步兼容结果差分、单次／全部替换和提交后计数。真实组件覆盖常驻／More 状态、默认初始化／保留／清空、旧工具栏迁移、设置预览／恢复，以及切换时编辑／阅读迟到结果和替换候选失效。入口：`text-helper.test.mjs`、`match-engine.test.mjs`、`reading-search.test.mjs`、`search-box-dom.test.mjs`、`toolbar.test.mjs`、`main-settings.test.mjs`。
- 索引跳过显式排除子树的样式读取，只在 display:none 检查折叠例外；不跨索引缓存样式。查询／选项／虚拟挂载复用索引，正文及主题失效重新读取。
- 虚拟化移出／挂回、离屏挂载后定位、跨块结果。
- 渲染等待、保留用户导航意图、超时、异常及重试。
- 隐藏文本、折叠正文、行尾空白和空表格单元格。
- 视图隔离、模式／文件切换、窗口迁移及资源释放。
- 编辑模式查找与替换、正则模板、历史统计、迁移和保存队列回归。
- 输入法组合输入期间的 Enter／NumpadEnter 与上下键不触发导航、替换或历史操作。
- 单次替换的按钮、Enter 与命令入口一致性，以及隐藏面板焦点和重新打开后的选中状态。
- 替换转义的真实 NUL、连续反斜杠、未知转义与设置开关边界。
- 统一关闭入口、清空两种输入、隐藏 Escape、模式异常与保留正则／大小写／全字匹配偏好。
- 临时移动与贴边：`finder-position.test.mjs` 覆盖 3px 直接启动、Pointer Capture／取消释放、绘制帧合并与无逐事件布局读取、左右候选确认／撤回／替换阻止、满宽避让、标记二维停留／吸附和资源释放；`search-box-dom.test.mjs` 覆盖装饰条无 tooltip 标签、箭头不承担拖动、30px／40px 标记单击／拖动区分、80% 反馈和原查询／高亮／焦点安全。`mobile-toolbar.test.mjs` 继续覆盖常驻溢出回流／More 原位。模拟不证明宿主实际跟手、触屏或安全区。
- 移动行高／手柄：真实组件的 `real mobile branch uses equal row heights, centered top grip and original collapse arrow` 覆盖 40px 基础外高、Grid 中央手柄及无提示标签；`mobile inputs override host padding and line height without hiding multi-line content` 用模拟宿主 textarea 样式检查 border-box 30px／20px 行高／4px padding 可容纳单行及保留多行输入；`mobile center grip drags directly and cancels without making counters or close draggable` 检查直接拖动／取消／计数关闭隔离和顶部栏高度 footprint。jsdom 不测真实 scrollHeight／字体排版或系统边缘手势，不可宣称实机空输入滚动已消失。
- 默认悬浮入口：`floating-entry.test.mjs` 覆盖默认懒创建、启用后已有笔记／同文件双分屏、新文件／视图、关闭后普通激活不重现、关闭设置不隐藏及销毁清理。真实 `search-box-dom.test.mjs` 覆盖被动入口／后台刷新／位置恢复不匹配不抢焦点、点击展开不滚动、原生委托、替换 UI 命令展开／输入保留／聚焦和迟到焦点失效；`reading-commands.test.mjs` 覆盖小图标切换不是关闭、选区不覆盖及阅读降级。`main-settings.test.mjs`／`toolbar.test.mjs` 覆盖五分类、设置归属和布尔迁移。
- 收起主题／初始贴边：`search-box-dom.test.mjs` 的 `compact entry uses quiet theme surfaces, rounded interactions and unchanged accessible controls` 检查主题变量、8px 圆角、交互规则及无 tooltip 名称；`mobile automatic entry corrects post-layout edge geometry and preserves manual parking through refresh` 用延迟紧凑布局模拟左右侧及手动停放，`queued automatic entry placement cannot override close, expansion, file changes or destruction` 检查过期意图。`finder-position.test.mjs` 的 `automatic compact positioning waits for measurable layout and follows safe viewport edges` 覆盖隐藏 owner／零尺寸节点恢复、VisualViewport／安全区及手动位置保留。jsdom 不证明实际主题对比度、CSS 过渡或后台标签挂载，真机验收仍必需。
- 移动展开越界：`search-box-dom.test.mjs` 的 `mobile marker expansion stays inside bounds after positional animations would have finished` 根据实际编译 CSS 是否允许 right／transform 动画来模拟基础坐标变化，覆盖左右来源、中间／边缘停放、连续收起展开、满宽／较窄及延迟内容尺寸，校验不经额外 resize 就保持边界、纵向位置和不聚焦输入；`mobile position transitions are disabled without changing desktop transitions or reduced-motion rules` 检查移动 opacity、桌面位置过渡及 reduced-motion 优先禁用规则。修改前模拟可复现动画结束后越界，修改后通过；jsdom 不运行真实 CSS 动画，Android 实际绘制仍须验收。
- 移动长按：`search-box-dom.test.mjs` 的 `mobile long press blocks menu and release expansion while held dragging and short taps still work` 覆盖有／无 contextmenu 的长按、默认行为／冒泡阻止、拖动／取消／短按展开及输入菜单隔离；`desktop compact context menu retains close and reset actions` 校验桌面菜单操作。`finder-position.test.mjs` 的 `optional held-click suppression leaves short taps and keyboard activation intact and expires` 覆盖键盘不吞、desktop 不变、取消、抑制过期和销毁清理；模拟时钟不等待真实长按，不证明宿主系统 callout／实际 touch click 顺序。
- 移动手势隔离：`finder-position.test.mjs` 的 `mobile pointer ownership captures on down and bypasses ancestor swipe handlers even without capture` 模拟会阻止冒泡的宿主祖先监听，覆盖 capture 可用／抛错／缺失及真实取消回滚；`mobile capture-phase listeners and early pointer capture are released on every teardown path` 覆盖监听 capture 参数匹配及生命周期释放。真实组件的 `mobile compact gesture isolates host pointer and touch swipes without blocking other touches or taps` 检查宿主滑动隔离、Pointer／Touch 不重复移动、未参与手指及输入不屏蔽、短按保留与隐藏清理；`mobile touch guards release on destruction and owner blur without leaking document listeners` 检查 touch 释放。这些是模拟 DOM 事件，不证明 Android WebView 的 capture／click 或 Obsidian 更早阶段手势已实机通过。
- 快捷键展开聚焦：`search-box-dom.test.mjs` 的 `empty-query compact command expansion focuses only after layout with preventScroll and no ancestor panning` 用模拟几何／焦点滚动检查展开 DOM、位置和替换行先于聚焦提交，无查询中间焦点；`compact query focus is invalidated by close, re-collapse, owner changes or destruction` 覆盖迟到请求，`non-compact query opening keeps immediate focus without scrolling and still navigates real matches` 区分焦点滚动与正文导航。jsdom 不实现真实焦点滚动，不能据此宣称宿主 header 横滑已实机消失；需复测空查询的显示／切换查找和替换命令、左右停放／窄分屏／移动软键盘。
- 历史项重排／删除／裁剪后的邻近项浏览；跨模块实例存储队列、损坏 JSON 和 I/O 失败；迟到布局初始化。
- 异步模式切换拒绝、乱序完成、编辑器重建与关闭／查询变化／卸载后的迟到定位；替换正文只提交一次。
- `consistency.test.mjs` 检查版本、翻译键、设置／命令文档及 CSS 示例默认值；CI 核对构建 manifest 与源文件一致。
- 外观位置下拉的鼠标／键盘临时导航与单次提交、同值不保存、标题引用、owner Document、视口上翻、旧选项失效与监听释放；切页／隐藏／折叠／重排／恢复／卸载关闭，与调色草稿互斥。sm／md 与 content／fill 组合、触发器和列表同宽／视口限制、全选项测量占位以及每次打开同步主题字体有结构及模拟几何回归。入口为 `settings-select.test.mjs`、`main-settings.test.mjs`；`appearance.test.mjs` 检查共享尺寸／字体／文字起点样式和默认开启居中规则，不代替宿主视觉／触屏／读屏验收。

相关测试保留在 [`tests/`](../tests/)，例如 `reading-search.test.mjs`、`reading-commands.test.mjs` 和 `search-box-dom.test.mjs`。当前覆盖情况以测试文件和运行结果为准，不在文档中固定测试总数。

## 逻辑性能诊断

```sh
node tests/reading-benchmark.mjs
node --expose-gc tests/search-benchmark.mjs
node tests/reading-index-benchmark.mjs HEAD
```

脚本用 100／1,000／5,000 个分块与递增匹配数量，输出首次索引时间、导航中位时间及绘制 Range 数量。它不属于自动正确性测试套件，也不提供固定性能门槛。

jsdom 数据只反映当前机器上的逻辑开销，不能证明 Chromium 绘制、滚动或移动端性能。避免和完整测试／构建同时运行以减少测量噪声。不要使用可能发生灾难性回溯的正则进行日常库压力测试。

`search-benchmark.mjs` 分别记录索引、正则、端点映射、Range、观察器、高亮与挂载定位的独占逻辑时间，覆盖无／低／高匹配密度、上下文正则、查询变化及正文变化；编辑部分只测匹配与单次／全部模板展开，不包含 CodeMirror 事务。heap delta 不是峰值内存，`otherMs` 包含未单独计时的分块和结果整理。

`reading-index-benchmark.mjs [基线Git引用] [分块数] [inline|excluded|formatted] [样本数]` 对同一 DOM 交替运行基线与当前索引，先预热，再记录中位耗时；默认覆盖三种正文、三种规模，每项 3 个样本。单独插桩记录 computed style、selector 和 childNodes 调用，残余时间包含遍历、文本／span 整理及拼接；插桩时间不混入无插桩中位耗时。指定基线时逐项断言全文、span 坐标和 DOM 节点身份一致。基线通过 git show 只读获取，不更改工作区；完整矩阵可能需要数分钟。可以用 `node tests/reading-index-benchmark.mjs HEAD 100 formatted 9` 复测小文档噪声，不将单次耗时当作性能承诺。

## 可选宿主方法验证

```sh
node tests/host-contract-check.mjs /path/to/obsidian.asar
```

脚本只读提取指定安装包中的存储、队列、布局和卸载方法，在内存文件系统和 UI 服务边界运行当前插件源码，输出 app.js 校验值与验证范围。宿主代码未打包进仓库，不在普通 CI 强制依赖本机安装；方法形状变化时显式失败。该验证不是完整 Obsidian GUI、移动存储或真实磁盘验收。

## 隔离 Worker 实验（非生产功能）

```sh
node --test tests/worker-experiment.test.mjs
node --expose-gc tests/worker-experiment-benchmark.mjs
node tests/worker-experiment-browser-build.mjs
```

- Node 实验直接编译 `src/util/text-helper.ts`，Worker 内复用原生 RegExp 和现有模板实现，不维护另一套匹配算法。普通回归覆盖完整原文、flags、捕获、前后顾、UTF-16、零宽排除、无效正则、字面量和单次／全部替换的传输一致性。
- test-only 请求携带 owner／file／documentVersion／queryVersion／lifecycle 标签；替换或取消待定任务会终止旧 Worker，旧连接／请求 ID／快照的回包不能发布。标签只是协议实验，不能替代实际 Editor、CodeMirror doc 和文件身份校验。
- benchmark 分别测冷启动、小／大正文、无／密集匹配、单次后缀模板和线性全部替换，比较对象数组复制与 Float64 坐标缓冲区转移。报告计算、往返和主线程还原对象的时间；往返减计算包含排队、调度、消息和复制，不是纯传输时间。parent heap delta 不是 Worker 堆或峰值内存。
- 浏览器构建在 `/tmp/opencode/text-finder-worker-browser/index.html` 生成自包含实验页，点击安全按钮运行差分。它使用 Blob URL Worker 并在终止时释放 URL；只有在实际浏览器执行后才有浏览器证据。独立页面通过也不能证明 Obsidian CSP、移动 WebView、owner 生命周期或替换事务集成兼容。

危险正则只允许显式运行隔离脚本，不纳入常规回归或索引压力测试：

```sh
node tests/worker-experiment-cancel.mjs --dangerous
```

该脚本仅在 Node Worker 内执行故意构造的回溯输入，检查主线程计时器仍响应、显式终止、重建和实验 watchdog。浏览器页另有明确 opt-in 按钮，同样不做危险输入的同步比较。脚本中的 watchdog 时长只是实验安全措施，不是插件执行超时或新增产品限制。Worker 移出正则也不移出 DOM 索引、端点映射或高亮绘制；本实验未接入生产。

## Obsidian 独立只读 Worker 探针

生产查找的自动验证另见 `tests/match-engine.test.mjs` 与 `tests/search-box-dom.test.mjs`：运行正式 bundle／Worker 源码，覆盖语义差分、启动降级／执行失败、旧请求、同查询导航、文档／文件／编辑器身份和阅读端点失效；Node-backed 浏览器替身不能证明真实宿主 CSP。

生产产物只需既有 `main.js`／`styles.css`／`manifest.json`，Worker 字符串嵌入 main。实际验收须使用临时库中的正式插件入口，而非只读探针：先做字面量／正则／大小写、连续输入与 Enter、编辑／阅读切换、同文件双分屏、关闭／重开、卸载／重载及弹窗迁移。第一阶段查找已收到用户检查成功反馈；第二阶段异步替换待实机验收。危险查找／替换测试需要明确 opt-in，不能由安全测试通过自动推出通过。

异步替换自动测试覆盖 552 次正式 Worker 候选语义比较、单次后缀按需展开、失败／候选校验，实际组件的单次／全部提交、提交中重入事件、重算／模式定位、关闭／文件／doc／查询／输入失效、失败重试及同文件双 owner。CodeMirror 逆 changes 验证一次事务的 undo／redo 文本，不代替宿主真实撤销栈。实际安全样本：单次 `cat → cat!` 的额外前进；全部 `cat → dog` 一次撤销；捕获／命名组／前后顾、前缀／后缀及转义开关；提交前取消不改正文、提交后关闭不回滚且不迟到定位。先测试普通正文，不要求直接在正式入口输入危险模式。

```sh
node tests/worker-probe-build.mjs
node --test tests/worker-probe.test.mjs tests/worker-probe-dom.test.mjs
```

构建输出 `/tmp/opencode/text-finder-worker-probe/text-finder-worker-probe/`，包含 `main.js`、独立 `manifest.json` 和 `BUILD.json`。插件 ID 为 `text-finder-worker-probe`，不覆盖正式插件；构建不自动安装或启用。BUILD 的源码和产物校验值用于标识未提交实验代码，不能只用基础 commit 代表整个产物。

### 安装和首次运行

1. 使用临时测试 Vault，将输出目录复制到该库配置目录的 `plugins/text-finder-worker-probe/`。不要使用日常库；自定义配置目录不能默认写成 `.obsidian`。
2. 在 Obsidian 社区插件设置重新加载列表并启用 **Text Finder Worker Probe**。它不联网、不持久化设置、不扫描 Vault，不执行 Editor／CodeMirror 写入、选区、滚动或高亮。
3. 打开编辑模式 Markdown 笔记，执行命令 **Text Finder Worker Probe: Open read-only Worker probe**；面板独立打开并绑定原 Markdown owner。若没有绑定，激活目标 Markdown 再执行 **Bind active editor to Worker probe**，最后返回探针。
4. 点击 **安全语义验证（368 次）**，贴回完整 JSON。期望 `passed: true` 和资源计数归零；无效 `[` 正则的捕获诊断是预期输出，不应通过吞掉所有日志伪装通过。

### owner 和生命周期验证

- 在绑定笔记写入简单样本 `cat cat`，点击 **只读 owner 快照（延迟 3 秒）** 并等待：应 `completed`／`published: true`，数量 2。只发布计数和字符数，不输出正文或给编辑器提交变化；这不是阅读正文索引验证。
- 再次启动任务，在 3 秒内编辑正文、在同一 owner 换文件、切阅读模式、关闭 owner、修改探针查询或重新绑定；应取消并 `published: false`，原因分别反映 document／file／mode／owner／query 变化。任务只使用字面量查询，不允许将危险正则输入这个框。
- 切到另一个活动视图本身不应把结果送给它。对同文件双分屏分别开探针并绑定，各自的任务必须独立；同一文件路径／文本不替代对象身份检查。
- 任务中关闭探针或卸载插件，开发者控制台应打印 **Text Finder Worker probe cleanup**，Worker、URL、会话监听／计时器归零，迟到结果不再更新界面。重新启用插件再运行安全验证，确认恢复可用。
- 在弹出窗口重复安全验证与只读快照；任务中迁移 owner／探针窗口或关闭窗口。窗口变化应取消旧代次，重新绑定后可以再运行。探针使用实际 owner Window 创建 Worker；不能由 jsdom 或主窗口通过推定迁移通过。

### 隔离取消和性能

- 勾选明确 opt-in 后点击 **隔离危险正则取消／重启**。危险输入只在 Worker 内执行，期望 `cancelled: true`、`restartSuccessful: true` 及计时器响应。实验时限不是产品执行限制。
- 性能按钮仅用合成安全正文，记录冷启动、无／密集匹配、对象／缓冲区、单次后缀／线性全部替换候选的计算、往返和解码中位时间；不实际替换，不包含 DOM／高亮／撤销成本。不要与其他压力测试同时运行。
- 结果文本框可选择并手动复制，含 owner 路径和环境信息，贴回前可脱敏。清理计数只表示探针持有的资源，不是底层线程／内存泄漏的完整证明。移动设备须单独记录实测；`isDesktopOnly: false` 仅允许安装，不是移动兼容承诺。

自动测试运行实际探针 bundle／DOM，但 Obsidian API 是替身，浏览器 Worker 是 Node-backed 测试替身。真实 Worker 创建、CSP、窗口迁移及宿主卸载结果必须按上述步骤执行，不能把构建成功当作宿主通过。

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
| 移动／贴边 | 装饰条直接拖动无长按／折叠提示，箭头只折叠替换行；拖动透明度和捕获跟随、Escape／失焦回滚；30px／40px 标记二维拖动不展开、可停正文空白并换边吸附、单击展开不唤起键盘；配置默认关闭／满宽上下移动不收起。More 原位、常驻溢出回流／排序隐藏无重复；另测软键盘、横竖屏、分屏、窗口迁移和替换计算不能收起 |
| 默认悬浮入口／命令展开 | 常规页默认关闭；开启及重载后已有笔记显示小图标、不搜索不抢焦点、不闪出软键盘；同文件双分屏／新笔记各自入口；关闭后切回不重现、换笔记可显示；查找快捷键展开并聚焦查询、替换栏命令展开并聚焦替换输入；图标点击不唤起键盘，阅读原生偏好／不兼容回退不变。关闭设置不强制隐藏，恢复位置不激活被动入口 |
| 收起入口主题／初始边缘 | 深浅主题下核对次级背景／正文色图标／8px 圆角，hover／按下不露方角、键盘焦点可辨且没有多余悬浮文字；移动端开启自动入口并重载，新旧笔记首次靠安全边界而非居中，左右历史偏好与 8px 留白有效，不依赖拖边自动收起；后台标签先隐藏再显示、横竖屏与软键盘变化正确约束；手动拖到中间后切标签不被强制拉回，点击／快捷键展开不回退已有聚焦修正 |
| 移动图标展开边界 | 从左右来源把小图标拖到中间附近及两侧边缘后轻点展开，刚展开和等待至少 0.3 秒后完整框均在 owner／可见视口内，不先正常再向右漂移；满宽居中、较窄围绕图标并约束边界，纵向尽量保留原位置，点击不唤起键盘。连续收起／展开、横竖屏、查找／替换命令展开、软键盘出现后再次核对；桌面位置动画和系统 reduced-motion 偏好仍正常 |
| 移动长按与菜单 | 收起入口按住不动后松手不弹关闭／恢复菜单、不误展开；按住后拖动及直接拖动都能移动，取消回滚，后续短按能展开且不弹软键盘；完整框中央手柄长按无菜单；查找／替换输入长按选词、复制粘贴仍正常；桌面右键关闭／恢复菜单正常。分别核对 iOS／Android 真实事件及 callout，不以 jsdom 通过代替 |
| Android 收起图标手势所有权 | 从左右停放位置快速／缓慢横向、纵向及斜向拖动小图标，不打开文件目录／大纲、不停原地；按住后拖、移出图标区域仍跟随，系统取消回滚且下次拖动可用；轻点可展开，正文横滑仍能打开侧栏，输入选词／复制粘贴正常。完整框中央手柄同样不抢宿主侧栏；横竖屏／软键盘及切标签后复测。记录 Android／WebView／Obsidian 版本，若仍冲突收集 pointercancel／lostpointercapture 与宿主 capture 阶段事件，不推定自动回归等于修复验收 |
| 全字匹配 | 对 `cat cat2 cat_name xcat cat-dog` 查找 `cat`，关闭为 5 项、开启为 2 项；开启后全部替换只改两项并可一次撤销。覆盖正则捕获、快速切换、More、默认开启／恢复、关闭重开和双分屏；另查 `中文`／`中文内容` 及 `C++`／`C++17` 的既定边界、窄宽与移动布局和实际提示范围 |
| 关闭语义 | 各用户关闭入口一致；清空开关清两种输入但保留选项；隐藏后 Escape 无副作用；缺失／非布尔／抛错 livePreview 偏好不写模式 |

行为依据：`src/SearchBox.svelte`、`src/editor-extension.ts`；自动回归参见 `tests/search-box-dom.test.mjs`、`tests/editor-isolation.test.mjs`、`tests/replacement.test.mjs`。

### 阅读场景

| 场景 | 操作与预期 |
| --- | --- |
| 离屏全文 | 首次打开长文、未滚动到底，搜索 `tail-only-cat` 得到完整数量并直接定位，不发布视口局部数量 |
| 虚拟化与导航 | 搜索 `cat`，反复滚动首尾／连续前后导航；离屏挂回后仍有高亮，数量、当前项和定位一致 |
| 格式与边界 | `hello world` 跨行内格式／代码着色节点匹配；大小写、正则前后顾／锚点／跨块符合 [正文规则](product/features.md#阅读模式正文)；不改写正文文本，不影响链接或复制 |
| 全字逻辑正文 | `ca**t**` 可作为完整 `cat` 命中，`cat**2**` 不命中；切换全字选项刷新全文数量，跨格式及离屏导航／高亮一致，阅读不提供替换或写文件 |
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
