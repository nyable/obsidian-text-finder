# 宿主适配边界

- 私有形状及必要类型断言局限适配器，先能力检测，缺失走原有拒绝／降级语义，不借活动视图补目标。
- CodeMirror／Obsidian 由宿主提供，不打包第二实例。所有写入以本次原始文档／owner 身份再次校验。
- Worker 只在 ready 后提交；启动失败才自动同步兼容，执行故障不重放。释放线程、Blob URL 与 owner Window 监听。
- settings-storage 的共享 realm 队列跨模块重载，关闭只拒绝新请求；读取失败不得覆盖磁盘。保留 DTO 与数据路径。
- platform 不挂载 Vue 页面，装配留在 app；新跨层依赖必须能通过架构反例和实际边界检查。
