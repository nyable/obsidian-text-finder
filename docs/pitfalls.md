# 已验证的维护陷阱

只收录源码、测试或 Git diff 能确认且有重复维护价值的经验。历史修复不等于所有实机环境验收通过；一次性环境阻塞与临时任务不在此记录。

| 易错做法／原因 | 必须保留的不变量 | 源码与回归证据 |
| --- | --- | --- |
| 先小写化全文再求偏移；Unicode 转换可改变长度 | 在原文上匹配，保留 UTF-16 坐标 | `43f4de2`；`src/util/text-helper.ts:findTextMatches()`；`tests/text-helper.test.mjs` 的 Unicode 偏移测试 |
| 隐藏面板继续使用旧替换坐标；隐藏时不追踪正文 | 每次写入重新取得 owner 上下文并按当前原文重算 | `43f4de2`；`src/SearchBox.svelte:prepareReplacement()`；`tests/replacement.test.mjs` 的 hidden finder／删除／切文档测试 |
| 在匹配切片上重新执行正则；锚点／前后顾失去全文上下文 | 根据完整原文和原始 match 展开模板，全部变化来自一次快照，不递归展开结果 | `aa70692`；`src/util/text-helper.ts:expandReplacement()`；`tests/regex-replacement.test.mjs` |
| 使用全局活动编辑器；点击或异步过程可能改变活动视图 | Finder 绑定 owner；文档、文件、编辑器身份失效即拒绝旧结果或写入 | `d4f14be`；`src/editor-extension.ts:getEditorContext()`、`src/SearchBox.svelte:isCurrentContext()`；`tests/editor-isolation.test.mjs` |
| 只映射旧高亮坐标；正文变化可能改变正则前后顾语义 | 文档变化先清高亮，新结果必须绑定已提交的具体 CodeMirror doc | `d4f14be`；`src/search-highlight.ts:textMatchMarker`；`tests/search-highlight.test.mjs` |
| 历史按排序下标标识；使用统计会重排 | 精确文本身份、keyed DOM，删除不误伤其他选择 | `c9f79cc`；`src/HistoryModal.svelte:selectedTexts`、`src/HistoryList.svelte`；`tests/history-dom.test.mjs` 的排序与选择测试 |
| 复制开始就计数或完成后无条件新增；失败／晚完成会污染统计或复活删除项 | 成功后 existing-only 记录；失败不统计 | `0f79463`；`src/HistoryModal.svelte:copy`、`src/history.ts:record()`；`tests/history-dom.test.mjs` 的 clipboard 测试 |
| 保存可变对象并发写、等待保存再导航、读取失败写默认值 | 排队前独立快照、串行写入、UI 同步；读取失败禁止覆盖；保存失败不阻断后续任务 | `0f79463`；`src/main.ts`、`src/save-queue.ts`、`src/history.ts:commit()`；`tests/main-settings.test.mjs`、`tests/save-queue.test.mjs` |
| 假定内部 livePreview 偏好一定有值；undefined 被当作 false | 缺失／非布尔时不进行模式恢复写入 | `7a0f8fd`、`ad388ea`；`src/util/obsidian-internal.ts`；`tests/search-box-dom.test.mjs` 的关闭偏好测试 |
| 长期缓存 DOM Range；节点虚拟移出时 Range 会塌缩 | 保存节点＋数字端点，挂载完成后再创建 Range；虚拟移动只重绘 | `326f57b`；`src/reading-text.ts:ReadingEndpoint`、`src/reading-search.ts:paint()`／`scroll()`；`tests/reading-search.test.mjs` 的 detach／reattach 测试 |
| 后台刷新取消用户待定导航、旧渲染回调继续执行 | 请求绑定 owner／file／renderer／query；同查询刷新保留用户定位意图，过期回调无效 | `326f57b`；`src/reading-search.ts:search()`／`current()`；`tests/reading-search.test.mjs` 的 pending scroll／late callback 测试 |
| 只搜索当前 DOM，或只靠 DOM 变化等待渲染；误报全文或永久等待 | 完整分块就绪才发布；渲染回调＋有界检查；超时／异常明确失败且清理 | `326f57b`；`src/reading-search.ts:ready()`／`run()`／`fail()`；`tests/reading-search.test.mjs` 的 partial count／timeout 测试 |
| 替换行补偿测量其自身影响的行宽；形成宽度反馈 | 只测当前计数／操作控件，自定义／移动／阅读／折叠布局不留默认 spacer | `c4a5dc1`；`src/SearchBox.svelte:alignRows()`；`tests/search-box-dom.test.mjs` 的 spacer 测试 |
| 只用 keydown Enter 或只检查 isComposing；输入法候选会误触 | 多信号 composition 防护，结束后恢复普通快捷操作 | `13e8c2e`；`src/SearchBox.svelte:trackComposition()`／`isComposingInput()`；`tests/search-box-dom.test.mjs` 的 IME 测试 |
| 只隐藏透明度／指针事件；键盘或晚到回焦仍进入隐藏控件 | visibility／aria-hidden／tabindex 同步，blur＋隐藏焦点防护，关闭 More | `13e8c2e`；`src/SearchBox.svelte:syncFinderVisibility()`／`guardHiddenFocus()`、`src/Toolbar.svelte`；组件焦点测试 |
| 把 aria-label 只当作读屏名称，放在大块非操作容器上；Obsidian 会自动产生悬浮提示 | 容器用 aria-labelledby 引用标题／触发器，预览装饰图标 aria-hidden；真实操作与状态提示保留，不一刀切移除名称 | 用户反馈“外观／设置分类”区域提示；`src/settings-tab.ts`、`src/color-picker.ts`、`src/Toolbar.svelte`；`tests/main-settings.test.mjs` 的 container names、`tests/color-picker.test.mjs` 和 `tests/search-box-dom.test.mjs` 的菜单命名检查（结构回归，非宿主绘制验证） |
| 各替换入口各自导航；无写入或切文件后也前进 | 按钮／Enter／命令共享 `replaceOnce()`，成功且上下文有效才额外前进 | `13e8c2e`；`src/SearchBox.svelte:replaceOnce()`、`src/editor-extension.ts`；组件与编辑隔离测试 |
| 用真实 NUL 作转义哨兵；用户 NUL 被替换破坏 | 单次无哨兵解析，只识别支持的转义 | `13e8c2e`；`src/SearchBox.svelte:adjustReplaceText()`；`tests/replacement.test.mjs` 的 NUL／连续反斜杠测试 |
| 只测试 loadData／saveData 抛错，假定宿主 JSON 包装会传播异常 | 使用公开 adapter stat／read／write，解析失败禁止保存，写失败可见；不存在与权限失败分开 | `src/settings-storage.ts`；`tests/settings-storage.test.mjs`、`tests/main-settings.test.mjs` 的 malformed JSON／I/O 测试 |
| 单实例队列已串行就认为重载不会竞争；旧任务尚未进入宿主全局队列 | 同 App／路径共享跨模块读写队列，新实例先读取旧实例全部已接受写入 | `src/settings-storage.ts`；`tests/settings-storage.test.mjs` 的 new module instances、`tests/main-settings.test.mjs` 的 reload 测试 |
| 缓存历史排序下标；删除或缩容后索引越界 | 精确文本浏览身份，删除转存活邻近项，清空恢复暂存输入 | `src/history.ts:HistoryNavigation`；`tests/history.test.mjs`、`tests/search-box-dom.test.mjs` 的邻近项测试 |
| 为单次替换展开所有模板；前缀／后缀导致多余字符串工作 | 全文匹配保持语义，但只展开实际写入的目标 | `src/util/text-helper.ts:prepareReplacements()`；`tests/regex-replacement.test.mjs` 的 lazily expands 测试 |
| 将 setState Promise 返回当作定位成功；同数量替换在拒绝前已额外前进 | 正文提交不重试，异步定位成功且请求／上下文仍有效后才前进；同查询乱序也用代次区分 | `src/SearchBox.svelte:scrollToMatch()`／`replaceOnce()`；`tests/search-box-dom.test.mjs` 的 async replacement／out-of-order／mode rebuild 测试 |
| 用动画中的 getBoundingClientRect 基础位置计算独立 translate；right／transform 动画结束后补偿过期，纯位置变化不保证触发 ResizeObserver | 移动收起／展开均不动画 right／transform，tick 只等待 DOM 提交，不当作动画结束；保留透明度效果及最终宽度边界校正 | `src/SearchBox.svelte` 移动 CSS、`src/finder-position.ts:measure()`；`tests/search-box-dom.test.mjs` 的 `mobile marker expansion stays inside bounds after positional animations would have finished`（模拟中间坐标，修改前失败／修改后通过；非 Android 动画实测） |

使用这些经验时引用对应行为契约，而不是把历史实现原样复制回来。新的回归经验应说明具体症状、原因和可执行证据；尚未确认的风险放在兼容性验证边界，不伪装成历史缺陷。
