# Obsidian 文本查找器

[English](README.md) | [中文说明](README-zh_CN.md)

为 [Obsidian](https://obsidian.md) 当前笔记提供类似 VS Code 的查找窗口：**编辑模式**查找与替换 Markdown 源码，**阅读模式**查找渲染后的正文。

## 主要功能

- **查找与替换**：高亮结果、显示匹配数量、跳转上下项，编辑模式支持单次替换与全部替换。
- **灵活匹配**：支持正则表达式、区分大小写和全字匹配。
- **选区查找**：编辑与阅读模式均可限定在选中内容中搜索；编辑模式还支持多个选区及选区内替换。
- **历史与预设**：复用搜索记录，将常用查找／替换规则保存为命名预设。应用预设不会自动替换正文。
- **独立分屏**：每个笔记视图独立维护查找器和当前匹配项，同一文件的多个分屏也互不干扰。
- **工具栏与外观**：调整按钮顺序及显示位置，自定义匹配颜色和选区样式，拖动查找框，或开启悬浮搜索入口。

## 演示

![Text Finder 演示](screenshot/demo.gif)

*此为早期版本演示，当前界面已包含更多功能。*

## 安装

需要 Obsidian **1.6.0 或更新版本**。

### 安装方式 1：通过 Obsidian 插件市场安装

在 **设置 → 社区插件** 中搜索 **Text Finder**，安装并启用。

### 安装方式 2：使用 Better Manager 插件安装

安装并启用 [Better Manager](https://community.obsidian.md/plugins/better-plugins-manager)，打开插件管理器，找到从 GitHub 安装插件的入口，输入 `https://github.com/nyable/obsidian-text-finder`，完成安装后启用 **Text Finder**。

### 安装方式 3：使用 BRAT 插件安装

安装并启用 [BRAT](https://community.obsidian.md/plugins/obsidian42-brat)，执行其 **Add a beta plugin for testing** 命令，输入 `https://github.com/nyable/obsidian-text-finder`，完成安装后启用 **Text Finder**。

### 安装方式 4：手动安装

从[最新发布版本](https://github.com/nyable/obsidian-text-finder/releases/latest)下载 `main.js`、`styles.css` 和 `manifest.json`，放入 `<仓库>/.obsidian/plugins/text-finder/` 后启用插件。若使用自定义配置目录，请以该目录替代 `.obsidian`。

## 快速上手

1. 打开 Markdown 笔记，在命令面板执行 **Text Finder：在当前文件中：打开查找**。也可使用笔记右上角的 **更多选项 → Text Finder：打开查找**。
2. 输入查询，用上下项按钮或 Enter 跳转；按需开启正则、区分大小写或全字匹配。
3. 需要替换时，在编辑模式执行 **在当前文件中：打开查找与替换**。需要限定范围时，先选择正文，再执行 **在选定内容中打开查找**，然后输入查询。
4. 按 Escape 或点击关闭按钮关闭查找框。默认保留输入内容和匹配选项。

可在 **设置 → 快捷键** 中为命令分配快捷键。执行 **显示搜索历史** 复用查询，**将当前查找保存为预设** 保存规则，**应用查找／替换预设** 加载规则。

## 设置与外观

- **常规**：可开启打开笔记时显示悬浮搜索入口、拖到边缘时自动收起；两项默认关闭。
- **查找、替换、搜索历史**：调整查找行为、替换转义和历史偏好。
- **外观**：预览颜色与选区样式，排列工具栏按钮，选择常驻／更多／隐藏，并设置默认匹配选项。

桌面拖动左侧装饰条、移动端拖动顶部中央手柄即可移动查找框；需要时执行 **恢复查找框位置**。CSS 自定义请参阅[样式参考](docs/product/ui-baseline.md#样式来源与兼容接口)和 [Style Settings 示例](style-settings.css)。

## 注意事项

- 只搜索**当前笔记**，不搜索整个仓库。阅读模式只查找，不修改文件或切换到编辑模式。
- 编辑模式搜索 Markdown 源码，阅读模式搜索渲染正文，结果可能不同；嵌入笔记、公式、图表和部分插件生成内容不在搜索范围内。
- 阅读环境不兼容时回退 Obsidian 原生查找；选区查找不会静默降级为全文查找。

详细匹配与替换规则见[功能与限制](docs/product/features.md)，源码构建与维护说明见[开发文档](docs/README.md)。
