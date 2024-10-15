# Obsidian 文本查找器

[English](README.md)
[中文说明](README-zh_CN.md)

这是一个用于 Obsidian 的插件（https://obsidian.md）。  
在编辑模式下提供类似于 VSCode 的搜索/替换窗口。

**注意：** Obsidian API 仍处于早期 alpha 阶段，可能随时发生变化！

## 功能

在 **编辑模式** 下搜索或替换当前 Markdown 文件的文本。

-   高亮匹配的文本。
-   显示匹配项的总数和当前项。
-   支持正则表达式。
-   支持区分大小写。

## 截图

![Text Finder](https://github.com/nyable/obsidian-text-finder/blob/master/screenshot/demo.gif?raw=true)

# 如何使用

## 安装

### 使用 BRAT 安装

-   [安装 BRAT 插件](https://obsidian.md/plugins?id=obsidian42-brat)
-   执行命令 `Obsidian42 - BRAT: Add a beta plugin for testing`
-   粘贴此存储库的 URL 并确认
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

## 自定义样式

使用 [CSS 代码片段](https://help.obsidian.md/Extending+Obsidian/CSS+snippets) 来自定义样式。  
以下是部分示例。

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
