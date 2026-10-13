# Obsidian 文本查找器

[English](README.md)  
[中文说明](README-zh_CN.md)

这是一个用于 Obsidian 的插件（https://obsidian.md）。  
提供类似于 VSCode 的搜索窗口：编辑模式支持查找与替换，阅读模式支持查找所呈现的正文。

## 功能

在 **编辑模式** 下搜索或替换当前 Markdown 文件的文本，在 **阅读模式** 下搜索当前笔记的阅读正文。

-   在当前文件中搜索/替换
-   高亮匹配文本
-   显示匹配数量
-   支持正则表达式
-   支持区分大小写
-   输入历史

## To Do

-   [ ] 在选取范围内搜索/替换


## 截图

![Text Finder](https://github.com/nyable/obsidian-text-finder/blob/master/screenshot/demo.gif?raw=true)

# 如何使用

## 安装

### 社区插件

-   在社区插件市场中搜索"text finder"并安装。
-   在 Obsidian 设置中启用插件。

### 使用 BRAT 安装

-   [安装 BRAT 插件](https://obsidian.md/plugins?id=obsidian42-brat)。
-   执行命令 `Obsidian42 - BRAT: Add a beta plugin for testing`。
-   粘贴此存储库的 URL 并确认。
-   在 Obsidian 设置中启用插件。

### 从 Release 安装

-   在 [最新发布版本](https://github.com/nyable/obsidian-text-finder/releases/latest) 中下载 `main.js`、`styles.css`、`manifest.json`。
-   将 `main.js`、`styles.css`、`manifest.json` 复制到你的 vault 的 `VaultFolder/.obsidian/plugins/text-finder/` 中。
-   在 Obsidian 设置中启用插件。

## 基本使用

-   在 Obsidian 的快捷键设置中，为 Text Finder 命令分配快捷键。
-   在当前笔记执行“在当前文件中：打开查找”，输入文本，用上下项按钮或 Enter 跳转匹配。
-   编辑模式下可执行“在当前文件中：打开查找与替换”。按 Escape 或关闭按钮隐藏窗口。
-   各关闭命令行为一致。默认保留输入及正则／大小写选项；“清空查找和替换文本”同时清空两个输入框，不重置选项。窗口隐藏后 Escape 不再影响查找器。

## 阅读模式查找

-   在阅读模式执行“打开查找”，支持大小写敏感、正则、高亮和匹配导航，不支持替换。
-   搜索阅读正文，不包含隐藏的 Markdown 标记；嵌入笔记及部分插件生成的内容暂不支持。
-   升级后如仍使用原生查找，请关闭“阅读模式下使用 Obsidian 搜索”设置。

## 正则表达式替换

查找、替换候选及替换后重算优先在 Worker 中计算；等待时可关闭查找器来终止。Worker 启动不可用会提示并回退同步兼容模式；执行中故障不会自动重跑，可重试或明确选择同步重试。同步模式的复杂正则可能阻塞界面。**正文写入仍为同步事务，全部替换可一次撤销；提交后取消不会撤销正文，失败重试不会重复已完成的替换。** 阅读 DOM 索引、结果处理及绘制仍在主线程。不限制现有正则语法或匹配数量。

开启正则表达式模式后，可以在替换文本中引用捕获组。例如，查找 `(foo)(bar)`，
替换为 `$2-$1`，结果为 `bar-foo`。

-   使用 `$1`、`$2` 等引用捕获组，`$<name>` 引用命名组，`$&` 引用匹配文本，`$$` 插入美元符号。
-   启用转义字符设置时，正则替换中的 `\n`、`\t` 分别转换为换行和制表符；`\\` 插入字面量反斜杠。
-   普通文本模式下，替换内容按字面量处理，不展开美元符号模板或反斜杠转义。
-   当前查找与替换仍排除零宽匹配，例如单独使用 `^`。

## 分屏使用

-   每个查找器只操作其打开时所属的 Markdown 视图。分屏视图（包括同一文件的两个视图）分别维护当前匹配项。
-   在该视图打开另一文件时，保留查询文本并更新结果。
-   修改正文后更新匹配，不自动改变阅读位置；替换仅适用于编辑模式。

## 搜索历史

-   通过“显示搜索历史”命令查看、复用、复制或删除查询，搜索框中可用上下键切换历史。
-   保留查询中的首尾空格、换行和制表符。同一查询连续导航只计一次使用。
-   正在浏览的历史项被删除后，转到下一个仍存在的邻近项，末尾则转到前一项；历史清空后恢复浏览前的输入。
-   最多保存 1–200 条，可按创建时间、最近使用时间或使用次数排序；降低上限会移除低优先级记录。
-   禁用历史后保留已有记录，但停止记录新查询、统计使用情况和上下键历史导航。
-   保存或读取失败时会显示提示。请按提示处理；未保存的修改可能在退出后丢失。

## 外观设置

- 在“外观”设置页的独立按钮配置块中调整顺序及常驻／更多／隐藏，顶部完整预览固定可见，下方配置独立滚动；预览固定展开查找和替换两行，不支持任何操作。
- 颜色、搜索栏按钮、替换栏按钮分组可独立折叠，默认全部折叠。分组标题旁的回退图标提示“恢复默认设置”；点击直接恢复对应分组，颜色单项恢复仅影响该项，无确认弹窗，完成后统一提示“已恢复默认设置”。
- 预览查找框使用固定示例词 `text`，替换框保持空白；下方英文样例展示当前匹配及其他匹配的高亮样式，跟随现有高亮颜色与 CSS 自定义。
- 可设置聚焦边框、左侧装饰条、普通／当前匹配的背景和文字颜色。点击色块打开颜色与透明度选择面板，调色仅预览；点击“应用”才生效并保存，取消或离开设置会丢弃草稿。未自定义项目继续继承现有 CSS；单项或颜色分组恢复移除覆盖，不改变工具栏配置。
- 在正则表达式、区分大小写对应项中设置“默认开启”。仅作用于各 Markdown 视图新建的查找器；已有查找器以及关闭重开、切换文件／模式时保留手动选择。
- “恢复默认设置”只作用于所在栏：搜索栏恢复按钮布局并关闭两个默认开关，替换栏恢复按钮布局；不改变已有查找器的选项。隐藏按钮不会关闭对应模式。

## 自定义样式

使用 [CSS 代码片段](https://help.obsidian.md/Extending+Obsidian/CSS+snippets)或[Style Settings Plugin](https://github.com/mgmeyers/obsidian-style-settings)来自定义样式。

[示例的 Style Settings 配置文件](./style-settings.css).

使用示例时，将该文件保存为 Vault 的 CSS 代码片段并启用，然后打开 Style Settings 插件设置。仅安装 Style Settings 不会自动注册此示例。

以下是部分 CSS 片段示例。

### 匹配颜色（编辑与阅读模式）

```css
body {
	--nya-match-bgColor: #ea5c0054;
	--nya-match-color: inherit;
	--nya-match-curbgColor: #ffcc00;
	--nya-match-curColor: #000000;
}
```

### 匹配高亮与当前项（编辑模式）

```css
.nya-text-finder-match {
	border-radius: 2px;
	box-shadow: 0 0 0 1px rgb(60, 115, 75);
	background-color: inherit;
	color: inherit;
}

.nya-text-finder-match-current {
	box-shadow: 0 0 0 1px rgb(187, 187, 187);
	background-color: rgba(255, 170, 0, 0.8);
	color: black;
}
```

### 修改位置

左上角

```css
.nya-finder {
	right: unset !important;
	left: 376px;
}
```

右下角

```css
.nya-finder {
	top: unset !important;
	bottom: 72px;
}
```

左下角

```css
.nya-finder {
	top: unset !important;
	right: unset !important;
	left: 376px;
	bottom: 72px;
}
```

### 更改聚焦时的边框颜色

```css
body {
	--nya-focus-border-color: #39c5bb;
}
```

### 更改折叠按钮的颜色

```css
.nya-toggle {
	border-left: 3px solid red !important;
}
```

## 开发文档

源码构建、设计说明、测试与验收请参阅 [开发文档](docs/README.md)。
