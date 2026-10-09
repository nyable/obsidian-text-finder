# Obsidian 文本查找器

[English](README.md)  
[中文说明](README-zh_CN.md)

这是一个用于 Obsidian 的插件（https://obsidian.md）。  
在编辑模式下提供类似于 VSCode 的搜索/替换窗口。

**注意：** Obsidian API 仍处于早期 alpha 阶段，可能随时发生变化！

## 功能

在 **编辑模式** 下搜索或替换当前 Markdown 文件的文本。

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

### 从源代码安装

-   克隆此仓库。
-   使用 `npm i` 或 `yarn` 安装依赖。
-   使用 `npm run build` 在 `./dist` 中构建文件。
-   将 `main.js`、`styles.css`、`manifest.json` 复制到你的 vault 的 `VaultFolder/.obsidian/plugins/text-finder/` 中。
-   在 Obsidian 设置中启用插件。

### 从 Release 安装

-   在 [最新发布版本](https://github.com/nyable/obsidian-text-finder/releases/latest) 中下载 `main.js`、`styles.css`、`manifest.json`。
-   将 `main.js`、`styles.css`、`manifest.json` 复制到你的 vault 的 `VaultFolder/.obsidian/plugins/text-finder/` 中。
-   在 Obsidian 设置中启用插件。

## 设置

-   在设置页面为对应的命令设置快捷键。

## 正则表达式替换

开启正则表达式模式后，可以在替换文本中引用捕获组。例如，查找 `(foo)(bar)`，
替换为 `$2-$1`，结果为 `bar-foo`。

-   查找与替换使用相同的大小写选项和多行锚点（`^`、`$`）。前瞻和后顾基于完整的当前文档匹配。
-   替换模板遵循 JavaScript 规则：`$1`–`$99`、`$<name>`、`$&`（匹配文本）、`$$`（字面量美元符号）、`` $` ``（匹配之前的文本）和 `$'`（匹配之后的文本）。
-   启用转义字符设置时，正则替换中的 `\n`、`\t` 分别转换为换行和制表符；`\\` 插入字面量反斜杠。
-   普通文本模式下，替换内容按字面量处理，不展开美元符号模板或反斜杠转义。
-   当前查找与替换仍排除零宽匹配，例如单独使用 `^`。

## 自定义样式

使用 [CSS 代码片段](https://help.obsidian.md/Extending+Obsidian/CSS+snippets)或[Style Settings Plugin](https://github.com/mgmeyers/obsidian-style-settings)来自定义样式。

[示例的 Style Settings 配置文件](./style-settings.css).

以下是部分 CSS 片段示例。

### 匹配高亮与当前项

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
