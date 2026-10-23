# 已验证的维护陷阱

只收录源码、测试或 Git diff 能确认且有重复维护价值的经验。历史修复不等于所有实机环境验收通过；一次性环境阻塞与临时任务不在此记录。

提交引用保留原始修复证据；源码与测试路径指向当前实现，不要求读者还原旧目录。

| 易错做法／原因 | 必须保留的不变量 | 源码与回归证据 |
| --- | --- | --- |
| 虚拟入口仅在配置时规范化，resolveId／load 直接比较字符串；Vite 的 path.resolve 在 Windows 还原反斜杠，导致 UNRESOLVED_ENTRY | 虚拟入口及两个 hook 的 ID 使用同一规范化规则，不创建磁盘占位文件 | `tools/vite-build.mjs:embeddedEntry()`；`tests/vite-build.test.mjs` 的 Windows separators／POSIX paths 测试，覆盖盘符、中文／空格及 UNC；Windows 原生构建可复现修复前失败、修复后通过 |
| 只检查 ownerDocument 就断言跨窗口节点正确；默认 Vue DOM renderer 缓存初始化 Document | 创建节点显式绑定 owner Document，并单独检查所属 Window 构造器身份；根挂载不增加影响几何的 wrapper | `src/shared/ui/mount-view.ts`；`tests/integration/owner-renderer.test.ts` 的 realm／无 wrapper／多 app 隔离；`tests/browser/harness.mjs` 的 iframe 与 adopt 检查，非宿主弹窗验收 |
| 先小写化全文再求偏移；Unicode 转换可改变长度 | 在原文上匹配，保留 UTF-16 坐标 | `43f4de2`；`src/core/search/text-matching.ts:findTextMatches()`；`tests/unit/text-matching.test.mjs` 的 Unicode 偏移 |
| 隐藏面板继续使用旧替换坐标；隐藏时不追踪正文 | 每次写入重新取得 owner 上下文并按当前原文重算 | `43f4de2`；`src/features/finder/application/finder-session.ts:replaceMatches()`、`replacement-operation.ts:runReplacement()`；`tests/integration/replacement.test.mjs` 的 hidden finder／删除／切文档 |
| 在匹配切片上重新执行正则；锚点／前后顾失去全文上下文 | 根据完整原文和原始 match 展开模板，全部变化来自一次快照，不递归展开结果 | `aa70692`；`src/core/search/text-matching.ts:expandReplacement()`；`tests/unit/regex-replacement.test.mjs` |
| 使用全局活动编辑器；点击或异步过程可能改变活动视图 | Finder 绑定 owner；文档、文件、编辑器身份失效即拒绝旧结果或写入 | `d4f14be`；`src/app/workspace-runtime.ts:getEditorContext()`、`src/features/finder/application/finder-session.ts:isCurrentContext()`；`tests/integration/editor-isolation.test.mjs` |
| 只映射旧高亮坐标；正文变化可能改变正则前后顾语义 | 文档变化先清高亮，新结果绑定具体 CodeMirror doc | `d4f14be`；`src/platform/codemirror/search-highlight.ts:textMatchMarker`；`tests/integration/search-highlight.test.mjs` |
| 历史按排序下标标识；使用统计会重排 | 精确文本身份、keyed DOM，删除不误伤其他选择 | `c9f79cc`；`src/features/history/ui/HistoryPanel.vue:selectedTexts`、`HistoryList.vue`；`tests/component/history-panel.test.mjs` 的排序与选择 |
| 复制时更新使用统计；异步完成可能污染计数或复活删除项 | 复制只输出精确文本，成功／失败均不更新时间／次数或保存；销毁后不显示迟到错误 | `src/features/history/ui/HistoryPanel.vue:copy()`；[历史交互](product/interactions.md#历史交互)；`tests/component/history-panel.test.mjs` 的 clipboard |
| 保存可变对象并发写、等待保存再导航、读取失败写默认值 | 排队前独立快照、串行写入、UI 同步；读取失败禁止覆盖；保存失败不阻断后续任务 | `0f79463`；`src/app/create-plugin-runtime.ts`、`src/platform/obsidian/settings-storage.ts`；`tests/integration/main-settings.test.mjs`、`settings-storage.test.mjs` |
| 假定内部 livePreview 偏好一定有值；undefined 被当作 false | 缺失／非布尔时不进行模式恢复写入 | `7a0f8fd`、`ad388ea`；`src/platform/obsidian/live-preview.ts`；`tests/component/finder-panel.test.mjs` 的关闭偏好 |
| 长期缓存 DOM Range；节点虚拟移出时 Range 会塌缩 | 保存节点＋数字端点，挂载后再创建 Range；虚拟移动只重绘 | `326f57b`；`src/features/reading/dom/reading-text.ts:ReadingEndpoint`、`reading-search.ts:paint()`／`scroll()`；`tests/integration/reading-search.test.mjs` 的 detach／reattach |
| 后台刷新取消用户待定导航、旧渲染回调继续执行 | 请求绑定 owner／file／renderer／query；同查询刷新保留定位意图，过期回调无效 | `326f57b`；`src/features/reading/dom/reading-search.ts:search()`／`current()`；`tests/integration/reading-search.test.mjs` 的 pending scroll／late callback |
| 只搜索当前 DOM，或只靠 DOM 变化等待渲染；误报全文或永久等待 | 完整分块就绪才发布；渲染回调＋有界检查；超时／异常明确失败且清理 | `326f57b`；`src/features/reading/dom/reading-search.ts:ready()`／`run()`／`fail()`；`tests/integration/reading-search.test.mjs` 的 partial count／timeout |
| 替换行补偿测量其自身影响的行宽；形成宽度反馈 | 只测当前计数／操作控件，自定义／移动／阅读／折叠不留默认 spacer | `c4a5dc1`；`src/features/finder/interaction/row-alignment.ts`；`tests/component/finder-panel.test.mjs` 的 spacer |
| 只用 keydown Enter 或只检查 isComposing；输入法候选会误触 | 多信号 composition 防护，结束后恢复普通快捷操作 | `13e8c2e`；`src/features/finder/interaction/composition-input.ts`、`input-shortcuts.ts`；`tests/component/finder-panel.test.mjs` 的 IME |
| 只隐藏透明度／指针事件；键盘或晚到回焦仍进入隐藏控件 | visibility／aria-hidden／tabindex 同步，blur＋隐藏焦点防护，关闭 More | `13e8c2e`；`src/features/finder/interaction/panel-presentation.ts`、`src/features/finder/ui/FinderToolbar.vue`；组件焦点测试 |
| 把 aria-label 只当作读屏名称，放在非操作容器上；Obsidian 自动产生悬浮提示 | 容器用 aria-labelledby；预览装饰图标 aria-hidden；真实操作与状态提示保留名称 | 用户反馈；`src/features/settings/ui/settings-view.ts`、`color-picker.ts`、`src/features/finder/ui/FinderToolbar.vue`；`tests/integration/main-settings.test.mjs`、`tests/component/color-picker.test.mjs`、`finder-panel.test.mjs` 的命名检查（非宿主绘制） |
| 各替换入口各自导航；无写入或切文件后也前进 | 按钮／Enter／命令共享 replaceOnce，成功且上下文有效才额外前进 | `13e8c2e`；`src/features/finder/application/finder-session.ts:replaceOnce()`、`src/app/workspace-commands.ts`；组件与编辑隔离测试 |
| 用真实 NUL 作转义哨兵；用户 NUL 被破坏 | 单次无哨兵解析，只识别支持的转义 | `13e8c2e`；`src/features/finder/model/query-identity.ts:decodeReplacementEscapes()`；`tests/integration/replacement.test.mjs` 的 NUL／连续反斜杠 |
| 假定宿主 loadData／saveData 的 JSON 包装会传播异常 | 公开 adapter stat／read／write；解析失败禁止保存，写失败可见；不存在与权限失败分开 | `src/platform/obsidian/settings-storage.ts`；`tests/integration/settings-storage.test.mjs`、`main-settings.test.mjs` 的 malformed JSON／I/O |
| 单实例队列已串行就认为重载不会竞争 | 同 App／路径共享跨模块读写队列，新实例先读取旧实例全部已接受写入 | `src/platform/obsidian/settings-storage.ts`；`tests/integration/settings-storage.test.mjs` 的 new module instances、`main-settings.test.mjs` 的 reload |
| 缓存历史排序下标；删除或缩容后索引越界 | 精确文本浏览身份，删除转存活邻近项，清空恢复暂存输入 | `src/features/history/model/history.ts:HistoryNavigation`；`tests/unit/history-contracts.test.mjs`、`tests/component/finder-panel.test.mjs` 的邻近项 |
| 为单次替换展开所有模板；前缀／后缀造成多余字符串工作 | 全文匹配保持语义，只展开写入目标 | `src/core/search/text-matching.ts:prepareReplacements()`；`tests/unit/regex-replacement.test.mjs` 的 lazily expands |
| 将 setState Promise 返回当作定位成功；拒绝前已额外前进 | 提交不重试，异步定位成功且请求／身份有效后才前进；同查询乱序也用代次区分 | `src/features/finder/application/finder-session.ts:scrollToMatch()`／`replaceOnce()`；`tests/component/finder-panel.test.mjs` 的 async replacement／out-of-order／mode rebuild |
| 用动画中基础坐标计算独立 translate；动画结束后补偿过期，桌面关闭重开后即使等超过一秒仍可能在按下时上跳一个面板高度 | 桌面／移动收起、展开及重开不动画 right／transform，tick 只等待 DOM 提交；保留 opacity 和宽度校正，按下／阈值前松开不主动纠正位置 | `src/features/finder/ui/FinderPanel.vue`、`src/features/finder/interaction/finder-position.ts:measureGeometry()`；`tests/component/finder-panel.test.mjs` 的 mobile marker expansion、`tests/browser/drag.spec.mjs` 的手动位置重开回归（Chromium，非宿主／Android 验收） |

使用这些经验时引用对应行为契约，而不是把历史实现原样复制回来。新的回归经验应说明具体症状、原因和可执行证据；尚未确认的风险放在兼容性验证边界，不伪装成历史缺陷。
