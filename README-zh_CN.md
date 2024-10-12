# Obsidian 文本查找器

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

# 如何使用

## 安装

### 从源代码安装

-   克隆此仓库。
-   使用 `npm i` 或 `yarn` 安装依赖。
-   使用 `npm run build` 在 `./dist` 中构建文件。
-   将 `main.js`、`styles.css`、`manifest.json` 复制到你的 vault 的 `VaultFolder/.obsidian/plugins/obsidian-text-finder/` 中。
-   在 Obsidian 设置中启用插件。

### 从 Release 安装

-   在 [最新发布版本](https://github.com/nyable/obsidian-text-finder/releases/latest) 中下载 `main.js`、`styles.css`、`manifest.json`。
-   将 `main.js`、`styles.css`、`manifest.json` 复制到你的 vault 的 `VaultFolder/.obsidian/plugins/obsidian-text-finder/` 中。
-   在 Obsidian 设置中启用插件。

## 设置

-   在设置页面为对应的命令设置快捷键。

## 自定义样式

使用 [CSS 代码片段](https://help.obsidian.md/Extending+Obsidian/CSS+snippets) 来重写类，自定义匹配高亮和当前项的样式。  
例如：

```css
.nya-text-finder-match {
	border-radius: 2px;
	box-shadow: 0 0 0 1px #5fb4b4;
	background-color: inherit;
	color: inherit;
}

.nya-text-finder-match-current {
	background-color: #fac761;
	color: black;
}
```
