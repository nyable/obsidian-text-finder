# 测试与实机验收

命令均在仓库根目录执行。

## 自动检查

```sh
pnpm test
pnpm test:artifacts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:architecture
pnpm build
pnpm test:browser
git diff --check
```

`pnpm verify` 是本地统一质量入口，涵盖上述检查和产物校验。标准测试使用 Vitest 直接导入 TypeScript／Vue，位于 `tests/unit/`、`tests/component/`、`tests/integration/`；官方 Vue Vite 插件编译组件，Vue Test Utils 和 owner renderer 分别覆盖组件与跨 Document 场景。宿主渲染器与 Highlight API 使用显式替身，不等同于真实宿主。源码抽取加载器及旧组件 API 夹具已移除。生产 TypeScript 与新增 TypeScript 测试都纳入严格类型检查；既有 mjs 套件由 Vitest 执行，不宣称它们全部已类型化。

`vitest.config.mjs` 将并发限制为两个 worker，并显式保留 `isolate: true`，避免 DOM 全局对象和模块 mock 跨文件泄漏；不为提速关闭隔离或跳过套件。低内存环境使用 `pnpm test --maxWorkers=1`；目标回归使用 `pnpm exec vitest run <测试路径>`，再运行 `pnpm typecheck` 尽早发现测试自身的类型错误。交付前仍运行完整 `pnpm verify`。比较耗时时保持 Node、依赖、测试集合及缓存条件一致，串行执行对照命令，不与构建或其他测试同时运行；Vitest 导入阶段统计和 `/usr/bin/time` 的单进程峰值内存不能分别当作完整墙钟拆分或全部 worker 的总内存。

`tests/browser/reading.spec.mjs` 在 `pnpm test:browser` 中覆盖大型仍挂载的阅读代码块，检查轮廓路径及 Range 测量次数不随离屏行数全量展开；记录耗时但不以机器相关的毫秒阈值替代结构性回归。它不证明真实 Obsidian 虚拟化或移动设备性能。同步重试取消／超时／身份变化由 `reading-search.test.mjs` 覆盖，真实双语特殊字符输出由 `i18n-text.test.mjs` 覆盖。

`pnpm test:browser` 使用 Playwright Test（`playwright.config.mjs`、`tests/browser/finder.spec.mjs` 和 `harness.mjs`）编译生产组件，在真实 Chromium 运行 Finder Blob Worker 查找／替换、IME、第二 Document 和 live owner adopt／卸载检查。截图和 REPORT 默认写 `artifacts/browser/`，可用 TEXT_FINDER_ARTIFACTS 指定；失败 trace／diff 写 `artifacts/playwright/`。需要已安装的锁定 Playwright Chromium；模拟主题、iframe 与移动布局不等于 Obsidian／Android／iOS 验收。

`pnpm test:visual` 在 Linux 对 `tests/browser/baselines/chromium-linux/` 的 40 张可追溯已审查基线零像素容差比较，保留 expected／actual／diff，不自动更新。其中 24 张查找器／设置预览保持原图，历史／详情 8 张及新增预设 8 张经过单独审查授权；原 32 张及其报告保存在 baselines/archive。浏览器、字体、语言、时区、DPR 和主题夹具固定；更新须单独审查授权及差异，见 baselines/README。还可用 TEXT_FINDER_VISUAL_BASELINE 指向保留的外部 REPORT 做哈希核对；输入与输出目录必须不同。不得用当前输出冒充原基线，也不将像素比较当作全部操作等价。

`tests/browser/visual-contracts.mjs` 是 smoke／严格比较共用的场景清单；严格比较在构建及截图前核对全部主题／布局的基线文件集合、provenance 条目、来源报告与 SHA-256。遗漏、重复、孤立资产或哈希不符明确失败，不跳过无基线场景、不自动生成 expected。`tests/unit/visual-contracts.test.mjs` 覆盖完整集合、新增预设缺图及来源不符等异常；新增场景须同时提交获批截图和来源。现存原基线不是后续改版的自动批准，未完成审查时门禁应保持失败。

已获批准后显式执行 `--update-snapshots=all`／`changed`，才可跳过更新前预检并创建 expected；随后更新 provenance，再用默认禁止更新模式复验。不得把更新命令成功写成严格比较通过。

`pnpm test:artifacts` 在独立 Node 进程运行 `tests/vite-build.test.mjs`，通过正式配置内存构建，避免 Vitest 模块 mock 影响产物。检查安装文件集合、宿主 external、无拆分资产、Vue scoped CSS、CommonJS 直接导出插件类及产物初始化、Finder 查找／全部替换／关闭／卸载；另检查内嵌输入 watch 和大段静态 HTML／SVG／MathML 模板不生成 `createStaticVNode`。宿主仍是替身，同步兼容不能证明 Obsidian 真机通过。`tests/integration/owner-renderer.test.ts` 检查无全局 Document 的 realm、独立 app 标签、更新、幂等卸载和拒绝静态 HTML VNode；`tests/component/owner-template.test.ts` 使用浏览器编译路径检查模板在 adopt 后创建 owner HTML／SVG／MathML 节点及用户 HTML 作为文本。

构建路径回归使用 `path.win32.resolve()` 模拟 Vite 在 Windows 处理库入口后的反斜杠 ID，覆盖盘符、中文／空格、UNC、POSIX 及空源码。它检查虚拟入口 resolveId／load 的规范化，不等于 Windows 原生构建；改动构建入口时仍须在 Windows 原生 Node 下运行 `node --test tests/vite-build.test.mjs` 和 `pnpm build`，不能只凭 WSL 通过推定 Windows 通过。

## 主要覆盖

- 提交与生命周期边界：`finder-editor.test.ts` 覆盖全拒绝、同值接受、部分过滤／改写后的失败结果、未知数量及禁止重放；`layout-migration.test.ts` 覆盖工具栏／行对齐／状态浮层 adopt 后的 Window、viewport 和 Observer 清理／重建；`search-library.test.ts` 覆盖预设初始订阅失败时立即释放历史订阅；`main-settings.test.mjs` 覆盖松手坐标与最后 move 不同及同 Document 双实例标签引用。这些模拟检查不替代 Obsidian popout、触屏拖动和悬浮提示实机验收。

- 审计边界回归：`regex-replacement.test.mjs` 的嵌套美元模板对照原生语义；`presets.test.ts`／`search-library.test.ts` 的同毫秒并发编辑冲突、排序后保存和另存保留；历史／预设故障订阅不阻断其他回调及保存；`search-highlight.test.mjs` 的高密度当前项切换保留无关装饰；`settings-storage.test.mjs` 的慢写入合并、读取封存屏障及跨重载；`finder-panel.test.mjs` 的全局转义变化立即取消及改回不复活；`main-settings.test.mjs` 的双 Document 预览独立。浏览器 TypeScript 入口同样纳入 `tsconfig.test.json`，翻译静态调用按源码目录自动发现，不维护文件白名单。

- 笔记菜单：`finder-menus.test.mjs` 覆盖 more-options 来源过滤／所属视图／去重、普通设置与范围／收起保留、选择快照、丢焦、正文／renderer／file／Document 过期拒绝、旧原生偏好不再路由及不兼容时 owner 填词、复制／链接保留及卸载监听清理；真实组件测试覆盖明确填词清旧范围／失效保护、贴边展开，以及捕获范围不被后来的选择替换。可选 `node tools/diagnostics/menu-host-check.mjs /path/to/obsidian.asar` 只读提取真实事件菜单方法，不启动宿主、不写 Vault，不等于 GUI 或移动端验收。

菜单实机验收：编辑／阅读右上角“更多选项”各有一个打开入口，文件管理器／链接文件菜单不误加；正文选择右键两个操作含义清晰，无选择／Finder 输入选择不误加。检查选区填词设置、已有范围、旧原生偏好 true／false 升级后统一插件查找及不兼容回退、菜单丢焦、重复文本、多范围、同文件双分屏、弹窗和菜单打开后换文件；阅读链接复制／打开与纯正文复制保留，不出现双菜单。移动端需另外验证长按选词及系统菜单，不将桌面模拟测试当作触屏通过。

- 阅读范围／换行：`reading-scope.test.mjs` 覆盖实际重复文本位置、跨行内元素／元素端点、折叠空白内收、排除端点拒绝、多范围间隙、全文正则上下文、空查询、虚拟同节点保留与替换节点失效、file/source/renderer 变化、主题重索引、API 暂失和 Worker 错误不扩大范围、候选丢焦／反选、break 来源／纯换行导航及独立覆盖层。`reading-commands.test.mjs` 覆盖显式阅读命令不走原生全文；`finder-panel.test.mjs` 覆盖真实 Finder 的范围启用、More 激活／失效、查询保留和关闭清理。几何、宿主渲染器与 Highlight 多为替身，不能替代下述实机检查。

- 设置精简与迁移：`history-contracts.test.mjs`／`main-settings.test.mjs` 覆盖旧阅读原生偏好 true／false 清理、其他设置及精确历史保留、迁移保存一次及重载幂等；真实设置 DOM 不显示旧开关或跨视图恢复按钮。阅读命令／菜单／悬浮入口统一使用插件，不支持仍提示并降级；当前视图恢复命令、桌面右键和 Home 的既有回归继续保留。实机核对升级后的设置页、阅读入口及恢复操作，不以 jsdom 代替宿主验收。

- 选区外观：`scope-outline.test.mjs` 验证矩形并集外轮廓、语法／高亮片段去内缝、跨行阶梯／bidi 空隙、多范围隔离、折行模拟重测、owner 创建／滚动基准、样式监听迁移清理、预览 ResizeObserver 清理及真实 CodeMirror mark／layer 生命周期。`appearance.test.mjs` 验证设置严格迁移、默认关闭、alpha／粗细跨 Document 注入及恢复继承；`main-settings.test.mjs` 验证独立分组、草稿局部预览／应用、开关／粗细持久化、单次分组恢复不改其他组和旧控件拒绝保存。几何多为替身，不证明真实宿主轮廓绘制。
- 空白几何：`editor-whitespace.test.mjs` 覆盖真实换行／连续换行／跨行匹配、当前项颜色、EOF／软折行不造标记、文档失效／隐藏清理、可见区限制／折叠替换块拒绝、RTL／滚动缩放／双视图及旧 layer 缺失降级；覆盖同范围空行／空格 Tab 连接、独立范围／bidi 拒绝、缩进阶梯及长连接不压平文字。真实 CodeMirror 验证 layer 注册／销毁，CSS 检查无交互和伪元素，不等于宿主绘制或剪贴板实测。
- 外观整理：真实设置测试检查轮廓开关在依赖项前、默认隐藏／开启显示、关闭保留颜色／粗细并关闭 picker/select 和回焦、隐藏控件拒绝打开面板；单个两行文本预览同时含三处匹配和跨行范围。编译 CSS 验证 32px 基础行高、8px 行距、列对齐、局部原生 Setting 重置及统一 360px 响应式。几何测试覆盖 1–3px 线宽下左右内缘贴近字符边界／上下 2px 净距、跨折行单词中间起止、紧间隙分轴限扩／不连片及预览线宽更新重测；不能证明实际宿主视觉效果。

- 精确选区：`search-scope.test.mjs` 检查跨行精确边界、选择候选与导航隔离、边界插入／完整替换／删除／撤销、跨边界失效、多范围空隙及完整原文正则上下文；`match-engine.test.mjs` 对照正式 Worker／启动降级的范围查找与替换，并拒绝范围外回包。真实 `finder-panel.test.mjs` 检查命令／More／隐藏状态、导航不缩范围、长度变化后重算、空范围与隐藏写入保护、文件／State／窗口失效及旧异步候选。模拟不证明真实宿主选词、绘制或撤销栈。
- More 图标按钮组：`finder-panel.test.mjs` 检查与外部同几何、无菜单文字／勾号、容器有效标签引用、模式连续切换保留焦点、方向键／原生 Tab／Escape、仅内部模式的收起圆点（展开隐藏，关闭全部不恢复）及无模式式激活蓝底／边框、空／失效范围仍受限制、计数无额外标记与范围无下划线。编译 CSS 检查 focus-visible outline／无通用 focus 阴影、圆点主题色／绝对定位／无动画。`main-settings.test.mjs` 检查纯展示预览同步圆点且不增加监听；jsdom 不证明真实浏览器 focus-visible 判定、提示、换行排版或主题对比度。

- 阅读文本、跨格式匹配、离屏计数、大小写、正则和高亮端点。
- 全字匹配默认分隔符、中文／全角标点／NBSP、下划线／数字、匹配首尾标点、组合字符／emoji／UTF-16、短语／多行及正则模板；正式 Worker 与同步兼容结果差分、单次／全部替换和提交后计数。真实组件覆盖常驻／More 状态、默认初始化／保留／清空、旧工具栏迁移、设置预览／恢复，以及切换时编辑／阅读迟到结果和替换候选失效。入口：`text-matching.test.mjs`、`match-engine.test.mjs`、`reading-search.test.mjs`、`finder-panel.test.mjs`、`toolbar-contracts.test.mjs`、`main-settings.test.mjs`。
- 索引跳过显式排除子树的样式读取，只在 display:none 检查折叠例外；不跨索引缓存样式。查询／选项／虚拟挂载复用索引，正文及主题失效重新读取。
- 虚拟化移出／挂回、离屏挂载后定位、跨块结果。
- 渲染等待、保留用户导航意图、超时、异常及重试。
- 隐藏文本、折叠正文、行尾空白和空表格单元格。
- 视图隔离、模式／文件切换、窗口迁移及资源释放。
- 编辑模式查找与替换、正则模板、历史统计、迁移和保存队列回归。
- 输入法组合输入期间的 Enter／NumpadEnter 与上下键不触发导航、替换或历史操作。
- 单次替换的按钮、Enter 与命令入口一致性，以及隐藏面板焦点和重新打开后的选中状态。
- 替换转义的真实 NUL、连续反斜杠、未知转义与设置开关边界。
- 预设只填充 Finder，旧 `interpretEscapes` 不覆盖全局设置；全局开关后续变化仍影响替换并使待提交候选失效。入口：`finder-session.test.ts` 的 `ignores legacy preset escapes`、`finder-panel.test.mjs` 的 `global escape changes cancel pending replacements`。`search-library.test.ts` 与浏览器 harness 覆盖编辑页仅保留两项其他设置、常显短说明及有效 aria-describedby，不替代 Obsidian 实机悬浮提示验收。
- 统一关闭入口、清空查找和替换文本、隐藏 Escape、模式异常与保留匹配选项偏好。
- 临时移动与贴边：`finder-position.test.mjs` 覆盖 3px 直接启动、Pointer Capture／取消释放、绘制帧合并与无逐事件布局读取、左右候选确认／撤回／替换阻止、满宽避让、标记二维停留／吸附和资源释放；`finder-panel.test.mjs` 覆盖装饰条无 tooltip 标签、箭头不承担拖动、30px／40px 标记单击／拖动区分、80% 反馈和原查询／高亮／焦点安全。`mobile-toolbar.test.mjs` 继续覆盖常驻溢出回流／More 原位。模拟不证明宿主实际跟手、触屏或安全区。
- 移动行高／手柄：真实组件的 `real mobile branch uses equal row heights, centered top grip and original collapse arrow` 覆盖 40px 基础外高、Grid 中央手柄及无提示标签；`mobile inputs override host padding and line height without hiding multi-line content` 用模拟宿主 textarea 样式检查 border-box 30px／20px 行高／4px padding 可容纳单行及保留多行输入；`mobile center grip drags directly and cancels without making counters or close draggable` 检查直接拖动／取消／计数关闭隔离和顶部栏高度 footprint。jsdom 不测真实 scrollHeight／字体排版或系统边缘手势，不可宣称实机空输入滚动已消失。
- 默认悬浮入口：`floating-entry.test.mjs` 覆盖默认懒创建、启用后已有笔记／同文件双分屏、新文件／视图、关闭后普通激活不重现、关闭设置不隐藏及销毁清理。真实 `finder-panel.test.mjs` 覆盖被动入口／后台刷新／位置恢复不匹配不抢焦点、点击展开不滚动、原生委托、替换 UI 命令展开／输入保留／聚焦和迟到焦点失效；`reading-commands.test.mjs` 覆盖小图标切换不是关闭、选区不覆盖及阅读降级。`main-settings.test.mjs`／`toolbar-contracts.test.mjs` 覆盖五分类、设置归属和布尔迁移。
- 收起主题／初始贴边：`finder-panel.test.mjs` 的 `compact entry uses quiet theme surfaces, rounded interactions and unchanged accessible controls` 检查主题变量、8px 圆角、交互规则及无 tooltip 名称；`mobile automatic entry corrects post-layout edge geometry and preserves manual parking through refresh` 用延迟紧凑布局模拟左右侧及手动停放，`queued automatic entry placement cannot override close, expansion, file changes or destruction` 检查过期意图。`finder-position.test.mjs` 的 `automatic compact positioning waits for measurable layout and follows safe viewport edges` 覆盖隐藏 owner／零尺寸节点恢复、VisualViewport／安全区及手动位置保留。jsdom 不证明实际主题对比度、CSS 过渡或后台标签挂载，真机验收仍必需。
- 移动展开越界：`finder-panel.test.mjs` 的 `mobile marker expansion stays inside bounds after positional animations would have finished` 根据实际编译 CSS 是否允许 right／transform 动画来模拟基础坐标变化，覆盖左右来源、中间／边缘停放、连续收起展开、满宽／较窄及延迟内容尺寸，校验不经额外 resize 就保持边界、纵向位置和不聚焦输入；`mobile position transitions are disabled without changing desktop transitions or reduced-motion rules` 检查移动 opacity、桌面位置过渡及 reduced-motion 优先禁用规则。修改前模拟可复现动画结束后越界，修改后通过；jsdom 不运行真实 CSS 动画，Android 实际绘制仍须验收。
- 移动长按：`finder-panel.test.mjs` 的 `mobile long press blocks menu and release expansion while held dragging and short taps still work` 覆盖有／无 contextmenu 的长按、默认行为／冒泡阻止、拖动／取消／短按展开及输入菜单隔离；`desktop compact context menu retains close and reset actions` 校验桌面菜单操作。`finder-position.test.mjs` 的 `optional held-click suppression leaves short taps and keyboard activation intact and expires` 覆盖键盘不吞、desktop 不变、取消、抑制过期和销毁清理；模拟时钟不等待真实长按，不证明宿主系统 callout／实际 touch click 顺序。
- 移动手势隔离：`finder-position.test.mjs` 的 `mobile pointer ownership captures on down and bypasses ancestor swipe handlers even without capture` 模拟会阻止冒泡的宿主祖先监听，覆盖 capture 可用／抛错／缺失及真实取消回滚；`mobile capture-phase listeners and early pointer capture are released on every teardown path` 覆盖监听 capture 参数匹配及生命周期释放。真实组件的 `mobile compact gesture isolates host pointer and touch swipes without blocking other touches or taps` 检查宿主滑动隔离、Pointer／Touch 不重复移动、未参与手指及输入不屏蔽、短按保留与隐藏清理；`mobile touch guards release on destruction and owner blur without leaking document listeners` 检查 touch 释放。这些是模拟 DOM 事件，不证明 Android WebView 的 capture／click 或 Obsidian 更早阶段手势已实机通过。
- 快捷键展开聚焦：`finder-panel.test.mjs` 的 `empty-query compact command expansion focuses only after layout with preventScroll and no ancestor panning` 用模拟几何／焦点滚动检查展开 DOM、位置和替换行先于聚焦提交，无查询中间焦点；`compact query focus is invalidated by close, re-collapse, owner changes or destruction` 覆盖迟到请求，`non-compact query opening keeps immediate focus without scrolling and still navigates real matches` 区分焦点滚动与正文导航。jsdom 不实现真实焦点滚动，不能据此宣称宿主 header 横滑已实机消失；需复测空查询的显示／切换查找和替换命令、左右停放／窄分屏／移动软键盘。
- 历史项重排／删除／裁剪后的邻近项浏览；跨模块实例存储队列、损坏 JSON 和 I/O 失败；迟到布局初始化。
- 异步模式切换拒绝、乱序完成、编辑器重建与关闭／查询变化／卸载后的迟到定位；替换正文只提交一次。
- `consistency.test.mjs` 检查版本、翻译键、设置／命令文档及 CSS 示例默认值；CI 核对构建 manifest 与源文件一致。
- 外观位置下拉的鼠标／键盘临时导航与单次提交、同值不保存、标题引用、owner Document、视口上翻、旧选项失效与监听释放；切页／隐藏／折叠／重排／恢复／卸载关闭，与调色草稿互斥。sm／md 与 content／fill 组合、触发器和列表同宽／视口限制、全选项测量占位以及每次打开同步主题字体有结构及模拟几何回归。入口为 `settings-select.test.mjs`、`main-settings.test.mjs`；`appearance.test.mjs` 检查共享尺寸／字体／文字起点样式和默认开启居中规则，不代替宿主视觉／触屏／读屏验收。

相关测试保留在 [`tests/integration/`](../tests/integration/) 的 `reading-search.test.mjs`、`reading-commands.test.mjs` 和 [`tests/component/`](../tests/component/) 的 `finder-panel.test.mjs`。覆盖情况以测试及运行结果为准，不在文档中固定测试总数。

### 统一五 Tab 设置覆盖

`main-settings.test.mjs` 检查新／旧宿主均打开同一五 Tab、无自定义声明式定义、页面浏览不读盘／保存、全部基础项保留、历史输入 IME／非法值、控制器副作用／损坏数据写保护、弹层互斥、owner 标签引用及 hide／pagehide 后旧外观节点拒绝。`tests/browser/settings.spec.mjs` 使用公开宿主壳／控件替身挂载生产 `SettingTab`，在真实浏览器检查新／旧分派一致、默认分类／折叠、固定预览与配置滚动、颜色应用、选区开关、位置菜单、切 Tab 和卸载；包含在 `pnpm test:browser` 的 production Finder 过滤中。不再测试已放弃的全局设置搜索；模拟宿主不等于 Obsidian 1.13+ 主窗口／弹窗／移动实机通过，严格截图基线不自动更新。

## 逻辑性能诊断

```sh
pnpm diagnostic reading
pnpm diagnostic search
pnpm diagnostic index HEAD
```

脚本用 100／1,000／5,000 个分块与递增匹配数量，输出首次索引时间、导航中位时间及绘制 Range 数量。它不属于自动正确性测试套件，也不提供固定性能门槛。

jsdom 数据只反映当前机器上的逻辑开销，不能证明 Chromium 绘制、滚动或移动端性能。避免和完整测试／构建同时运行以减少测量噪声。不要使用可能发生灾难性回溯的正则进行日常库压力测试。

`search-benchmark.mjs` 记录阅读控制器公开阶段的独占逻辑时间，覆盖无／低／高匹配密度、上下文正则、查询变化及正文变化；不注入另一套源码依赖图，索引／正则／端点映射留在 otherMs。编辑部分只测匹配与单次／全部模板展开，不含 CodeMirror 事务。heap delta 不是峰值内存。

`pnpm diagnostic index [基线Git引用] [分块数] [inline|excluded|formatted] [样本数]` 对同一 DOM 交替运行基线与当前索引，先预热，再记录中位耗时；默认覆盖三种正文、三种规模，每项 3 个样本。单独插桩记录 computed style、selector 和 childNodes 调用，残余时间包含遍历、文本／span 整理及拼接；插桩时间不混入无插桩中位耗时。指定基线时逐项断言全文、span 坐标和 DOM 节点身份一致。基线通过 git show 只读获取，不更改工作区；完整矩阵可能需要数分钟。可以用 `pnpm diagnostic index HEAD 100 formatted 9` 复测小文档噪声，不将单次耗时当作性能承诺。

## 可选宿主方法验证

```sh
node tools/diagnostics/host-contract-check.mjs /path/to/obsidian.asar
```

脚本只读提取指定安装包中的存储、队列、布局和卸载方法，在内存文件系统和 UI 服务边界运行当前插件源码，输出 app.js 校验值与验证范围。宿主代码未打包进仓库，不在普通 CI 强制依赖本机安装；方法形状变化时显式失败。该验证不是完整 Obsidian GUI、移动存储或真实磁盘验收。

## 隔离 Worker 实验（非生产功能）

```sh
pnpm exec vitest run tests/integration/worker-experiment.test.mjs
pnpm diagnostic worker
node tools/diagnostics/worker-experiment-browser-build.mjs
```

- Node 实验经生产内嵌 Vite 构建复用 `src/core/search/text-matching.ts`，Worker 内使用相同原生 RegExp 和模板实现，不维护另一套匹配算法。普通回归覆盖完整原文、flags、捕获、前后顾、UTF-16、零宽排除、无效正则、字面量和单次／全部替换的传输一致性。
- test-only 请求携带 owner／file／documentVersion／queryVersion／lifecycle 标签；替换或取消待定任务会终止旧 Worker，旧连接／请求 ID／快照的回包不能发布。标签只是协议实验，不能替代实际 Editor、CodeMirror doc 和文件身份校验。
- benchmark 分别测冷启动、小／大正文、无／密集匹配、单次后缀模板和线性全部替换，比较对象数组复制与 Float64 坐标缓冲区转移。报告计算、往返和主线程还原对象的时间；往返减计算包含排队、调度、消息和复制，不是纯传输时间。parent heap delta 不是 Worker 堆或峰值内存。
- 浏览器构建在 `/tmp/opencode/text-finder-worker-browser/index.html` 生成自包含实验页，点击安全按钮运行差分。它使用 Blob URL Worker 并在终止时释放 URL；只有在实际浏览器执行后才有浏览器证据。独立页面通过也不能证明 Obsidian CSP、移动 WebView、owner 生命周期或替换事务集成兼容。

危险正则只允许显式运行隔离脚本，不纳入常规回归或索引压力测试：

```sh
node tools/diagnostics/worker-experiment-cancel.mjs --dangerous
```

该脚本仅在 Node Worker 内执行故意构造的回溯输入，检查主线程计时器仍响应、显式终止、重建和实验 watchdog。浏览器页另有明确 opt-in 按钮，同样不做危险输入的同步比较。脚本中的 watchdog 时长只是实验安全措施，不是插件执行超时或新增产品限制。Worker 移出正则也不移出 DOM 索引、端点映射或高亮绘制；本实验未接入生产。

## Obsidian 独立只读 Worker 探针

生产查找的自动验证另见 `tests/integration/match-engine.test.mjs` 与 `tests/component/finder-panel.test.mjs`：运行正式 bundle／Worker 源码，覆盖语义差分、启动降级／执行失败、旧请求、同查询导航、文档／文件／编辑器身份和阅读端点失效；Node-backed 浏览器替身不能证明真实宿主 CSP。

生产产物只需既有 `main.js`／`styles.css`／`manifest.json`，Worker 字符串嵌入 main。实际验收须使用临时库中的正式插件入口，而非只读探针：先做字面量／正则／大小写、连续输入与 Enter、编辑／阅读切换、同文件双分屏、关闭／重开、卸载／重载及弹窗迁移。第一阶段查找已收到用户检查成功反馈；第二阶段异步替换待实机验收。危险查找／替换测试需要明确 opt-in，不能由安全测试通过自动推出通过。

异步替换自动测试覆盖 552 次正式 Worker 候选语义比较、单次后缀按需展开、失败／候选校验，实际组件的单次／全部提交、提交中重入事件、重算／模式定位、关闭／文件／doc／查询／输入失效、失败重试及同文件双 owner。CodeMirror 逆 changes 验证一次事务的 undo／redo 文本，不代替宿主真实撤销栈。实际安全样本：单次 `cat → cat!` 的额外前进；全部 `cat → dog` 一次撤销；捕获／命名组／前后顾、前缀／后缀及转义开关；提交前取消不改正文、提交后关闭不回滚且不迟到定位。先测试普通正文，不要求直接在正式入口输入危险模式。

```sh
node tools/diagnostics/worker-probe-build.mjs
pnpm exec vitest run tests/integration/worker-probe.test.mjs tests/integration/worker-probe-dom.test.mjs
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
- 复制 [测试笔记](../tests/fixtures/reading-search.md)，在尾部前加入长正文制造离屏分块；阅读正常入口使用插件，不支持时按既有策略降级，不再有旧原生偏好开关。
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
| 默认悬浮入口／命令展开 | 常规页默认关闭；开启及重载后已有笔记显示小图标、不搜索不抢焦点、不闪出软键盘；同文件双分屏／新笔记各自入口；关闭后切回不重现、换笔记可显示；查找快捷键展开并聚焦查询、替换栏命令展开并聚焦替换输入；图标点击不唤起键盘，阅读统一插件查找，不兼容回退保留。关闭设置不强制隐藏，恢复位置不激活被动入口 |
| 收起入口主题／初始边缘 | 深浅主题下核对次级背景／正文色图标／8px 圆角，hover／按下不露方角、键盘焦点可辨且没有多余悬浮文字；移动端开启自动入口并重载，新旧笔记首次靠安全边界而非居中，左右历史偏好与 8px 留白有效，不依赖拖边自动收起；后台标签先隐藏再显示、横竖屏与软键盘变化正确约束；手动拖到中间后切标签不被强制拉回，点击／快捷键展开不回退已有聚焦修正 |
| 移动图标展开边界 | 从左右来源把小图标拖到中间附近及两侧边缘后轻点展开，刚展开和等待至少 0.3 秒后完整框均在 owner／可见视口内，不先正常再向右漂移；满宽居中、较窄围绕图标并约束边界，纵向尽量保留原位置，点击不唤起键盘。连续收起／展开、横竖屏、查找／替换命令展开、软键盘出现后再次核对；桌面位置动画和系统 reduced-motion 偏好仍正常 |
| 移动长按与菜单 | 收起入口按住不动后松手不弹关闭／恢复菜单、不误展开；按住后拖动及直接拖动都能移动，取消回滚，后续短按能展开且不弹软键盘；完整框中央手柄长按无菜单；查找／替换输入长按选词、复制粘贴仍正常；桌面右键关闭／恢复菜单正常。分别核对 iOS／Android 真实事件及 callout，不以 jsdom 通过代替 |
| Android 收起图标手势所有权 | 从左右停放位置快速／缓慢横向、纵向及斜向拖动小图标，不打开文件目录／大纲、不停原地；按住后拖、移出图标区域仍跟随，系统取消回滚且下次拖动可用；轻点可展开，正文横滑仍能打开侧栏，输入选词／复制粘贴正常。完整框中央手柄同样不抢宿主侧栏；横竖屏／软键盘及切标签后复测。记录 Android／WebView／Obsidian 版本，若仍冲突收集 pointercancel／lostpointercapture 与宿主 capture 阶段事件，不推定自动回归等于修复验收 |
| 全字匹配 | 对 `cat cat2 cat_name xcat cat-dog` 查找 `cat`，关闭为 5 项、开启为 2 项；开启后全部替换只改两项并可一次撤销。覆盖正则捕获、快速切换、More、默认开启／恢复、关闭重开和双分屏；另查 `中文`／`中文内容` 及 `C++`／`C++17` 的既定边界、窄宽与移动布局和实际提示范围 |
| 精确选区 | 在 `cat A cat`／`cat B cat` 两行中只选中第一行末尾和第二行开头的两个 `cat`，执行选区命令后输入 `cat`：仅两项，编辑全部替换不改另两个。覆盖先普通打开再从 More 开启、反向／多选区、导航不缩范围、边界插入／删除／撤销／长度变化替换、关闭后隐藏替换不写入、明确普通重开恢复全文、同文件双分屏、模式切换及弹窗迁移失效。检查无计数旁文字／无下划线，选区按钮激活／失效提示及 More 收起圆点；阅读范围用正文坐标且不提供替换 |
| More 图标面板 | 多个模式设为 More，检查与外部同图标按钮、紧凑横排／窄宽换行，无文字列表／勾号；连续切换不收起不抢查询焦点。收起且内部有模式开启才显示右上角强调色圆点，展开隐藏，关闭全部后不恢复；触发器始终无模式激活蓝底／边框，外部／隐藏模式与普通动作不产生圆点。展开反馈独立、Escape 只收面板、Tab 不困焦、外部点击关闭；鼠标／触屏不留额外蓝色焦点框，键盘方向键／Tab 有 focus-visible 提示。桌面／移动、视图底部上翻及设置预览同步，实际提示只覆盖操作控件 |
| 关闭语义 | 各用户关闭入口一致；清空开关清两种输入但保留选项；隐藏后 Escape 无副作用；缺失／非布尔／抛错 livePreview 偏好不写模式 |
| 选区外观 | 外观 → 搜索选区：默认背景随主题、边框关闭。选择背景／边框 alpha、应用／取消／单项恢复、开关及 1–3px、分组恢复；确认不改匹配色／工具栏／实际范围。检查单行／跨行首尾不齐／自动折行／长文滚动／缩放／语法及匹配拆分／多选区间隙／空行／RTL，轮廓不退化为整块大矩形、不遮文字、不拦选词点击；源码／实时预览、分屏／窗口迁移／卸载重载、主题与移动真机分别验收 |
| 空行与换行展示 | 选择 `abc\n\ndef` 及多个空行／仅空格 Tab 空白行，开启轮廓：同范围可见空行连接、不扩编辑器整行；引用／列表缩进和首尾不重叠时为窄阶梯，折叠源码、独立选区、bidi 不强连。正则搜索 `\n`、`\n\n`、`abc\n\ndef`：已匹配换行显示 `↵`，当前／普通颜色随导航切换，连续换行属于一项仍只计一项；无末尾换行的 EOF 和软折行无标记。覆盖源码／实时预览、末行实际换行、编辑／替换／撤销／关闭后清理、复制不带额外符号、长行视口边缘、滚动缩放、分屏／弹窗及移动主题；阅读不新增源码标记 |

行为依据：`src/features/finder/application/finder-session.ts`、`src/features/finder/ui/FinderPanel.vue`、`src/app/workspace-runtime.ts`；自动回归参见 `tests/component/finder-panel.test.mjs`、`tests/integration/editor-isolation.test.mjs`、`replacement.test.mjs`。

### 阅读场景

新增阅读范围实机入口：首次未打开 Finder 时选择正文，通过快捷键／命令面板启用；另测 Finder 已开后从 More 启用、输入聚焦不丢候选、反选、重复文本、跨粗体／链接及代码块、空查询和关闭重开。源文字或节点重建后保持零结果限制，重选或关闭开关才恢复；普通查找统一使用插件并保留不兼容降级，显式范围不原生全文降级。验证 `\n`／`\n\n` 对 `<br>`、pre 及段落边界的计数／定位，保护边界／末尾合成符不造结果；滚动先隐藏旧覆盖层、主题／字体／图片加载和裁切祖先重测、复制无额外字符、同文件双分屏／弹窗迁移与卸载资源清理。记录真实 Obsidian／主题／平台，不以模拟通过代替。

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
| 原生入口 | 旧原生偏好已清理，正常使用插件；不支持或用户在错误状态主动降级时关闭插件面板，不同时留下两套可见查找面板 |

依据：`src/features/reading/dom/reading-text.ts`、`reading-search.ts`、`src/features/finder/ui/SearchStatus.vue`；自动回归参见 `tests/integration/reading-search.test.mjs`、`reading-commands.test.mjs`。

### 环境、生命周期与性能

- 同文件双分屏独立导航；正常关闭一个视图不清另一个的阅读高亮。
- 弹出窗口和窗口迁移后，高亮、模式观察器及 Escape 使用所属 Document 并正常工作。
- 反复打开／关闭 Finder 和标签页、卸载插件后核对监听、Observer、计时器和高亮释放；历史 Modal 卸载清理单独验证，不能由 Finder 清理推定。
- 默认浅／深主题、明确选择的社区主题和目标 Android／iOS 分别记录结果；特别检查离屏节点依赖祖先／相邻选择器的 computed style、触屏操作可发现性和焦点。
- 使用 100／1,000／5,000 分块及不同匹配密度观察首次索引、连续输入、导航和滚动体验；逻辑基准不能代替这些实机测量。不要用危险正则做压力测试，渲染超时无法中断同步回溯。
- 公式、图表、嵌入和任意第三方动态输出不承诺全文兼容。截图范围与记录格式见 [ui-baseline](product/ui-baseline.md)。
