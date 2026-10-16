# Finder 局部边界

- application 仅接收 FinderHost／EditorPort／PresentationPort；不要传插件、MarkdownView、Window 或 DOM refs。
- QueryLane 的接受身份与导航意图独立于面板可见性。关闭、收起、同查询刷新和替换提交中的通知含义不同，先核对 interactions。
- 替换必须 prepare→身份校验→单次 commit→rematch；提交后定位失败不能重放写入。同步兼容与 Worker 必须共用算法。
- UI 使用浅响应式和显式 FinderCommands；不要暴露整个 session，不代理原始宿主实例。移动 Toolbar 节点在 Vue patch 前归还。
- 变更至少跑纯端口／replacement 回归和真实 finder-panel；焦点、节点／布局变更再跑 Playwright 与严格视觉。jsdom 不代替实机。
