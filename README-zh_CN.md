# Obsidian 文本查找器

[English](README.md)  
[中文说明](README-zh_CN.md)

这是一个用于 Obsidian 的插件（https://obsidian.md）。  
提供类似于 VSCode 的搜索窗口：编辑模式支持查找与替换，阅读模式支持查找所呈现的正文。

**注意：** Obsidian API 仍处于早期 alpha 阶段，可能随时发生变化！

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

### 从源代码安装

-   克隆此仓库。
-   使用 Node.js 24.21.0（见 `.node-version`）和 pnpm 12.3.4（见 `package.json` 的 `packageManager`）。按 pnpm 的[安装指南](https://pnpm.io/installation)安装包管理器。
-   使用 `pnpm install --frozen-lockfile` 安装锁文件中的依赖版本。
-   使用 `pnpm test` 执行回归测试，使用 `pnpm typecheck` 检查 TypeScript 和 Svelte 组件。
-   使用 `pnpm build` 在 `./dist` 中构建文件。
-   将 `main.js`、`styles.css`、`manifest.json` 复制到你的 vault 的 `VaultFolder/.obsidian/plugins/text-finder/` 中。
-   在 Obsidian 设置中启用插件。

修改依赖时，必须使用 pnpm 更新并提交 `pnpm-lock.yaml`。CI 使用
`--frozen-lockfile` 安装依赖，执行测试、TypeScript/Svelte 检查和插件构建。
本仓库不使用 npm 或 Yarn 安装依赖。

### 从 Release 安装

-   在 [最新发布版本](https://github.com/nyable/obsidian-text-finder/releases/latest) 中下载 `main.js`、`styles.css`、`manifest.json`。
-   将 `main.js`、`styles.css`、`manifest.json` 复制到你的 vault 的 `VaultFolder/.obsidian/plugins/text-finder/` 中。
-   在 Obsidian 设置中启用插件。

## 设置

-   在设置页面为对应的命令设置快捷键。

## 阅读模式查找

-   执行“在当前文件中：打开查找”，使用与编辑模式相同的面板、大小写与正则开关、历史和匹配导航；阅读模式不提供替换，不修改文件，也不切换编辑模式。
-   **升级用户请先关闭设置中的“阅读模式下使用 Obsidian 搜索”。** 已有设置保留；新安装默认使用插件的阅读查找。开启该设置则“打开／切换查找”继续调用原生查找。
-   搜索标题、段落、列表、引用、Callout、表格、普通代码块和链接显示文本。行内格式不打断匹配，例如 `hello **world**` 可匹配 `hello world`；隐藏的链接地址和 Markdown 标记不参与搜索。因此切换编辑／阅读模式后结果数量可能不同。
-   段落／块边界和 `<br>` 使用换行，表格单元格使用制表符。普通 HTML 空白折叠为一个空格，代码块保留原始空白；视觉自动换行不算文本换行。只匹配合成分隔符而没有实际正文字符的结果不会计数。继续排除零宽正则匹配。
-   完整阅读渲染结束后才发布匹配数量，包含被视图虚拟化移出页面的正文块；等待期间显示渲染提示，不以当前屏幕内的局部结果冒充全文结果。折叠正文参与搜索，导航时展开目标所在的必要区域，不自动恢复折叠。
-   首期排除笔记嵌入正文、属性界面、公式、图表、Dataview／DataviewJS 结果和阅读控件。其他第三方动态输出不承诺兼容；CSS 伪元素文字、图片、Canvas／iframe 内部内容不参与搜索。
-   阅读查找需要系统支持 CSS Custom Highlight API，并依赖经过形状检查的 Obsidian 私有阅读分块接口（已对照 1.14.4 的实现，仍需实际应用验收）。不兼容时“打开／切换查找”提示并回退原生查找；这不代表旧版／移动端已全部验证。
-   阅读高亮沿用 `--nya-match-*` 颜色变量，可使用 `::highlight(nya-reading-matches)` 和 `::highlight(nya-reading-current)` 定制颜色。编辑模式的 class 样式不会自动应用到阅读高亮，圆角和边框等效果受 Highlight API 限制。

## 正则表达式替换

开启正则表达式模式后，可以在替换文本中引用捕获组。例如，查找 `(foo)(bar)`，
替换为 `$2-$1`，结果为 `bar-foo`。

-   查找与替换使用相同的大小写选项和多行锚点（`^`、`$`）。前瞻和后顾基于完整的当前文档匹配。
-   替换模板遵循 JavaScript 规则：`$1`–`$99`、`$<name>`、`$&`（匹配文本）、`$$`（字面量美元符号）、`` $` ``（匹配之前的文本）和 `$'`（匹配之后的文本）。
-   启用转义字符设置时，正则替换中的 `\n`、`\t` 分别转换为换行和制表符；`\\` 插入字面量反斜杠。
-   普通文本模式下，替换内容按字面量处理，不展开美元符号模板或反斜杠转义。
-   当前查找与替换仍排除零宽匹配，例如单独使用 `^`。

## 编辑器隔离

-   每个查找器只操作其打开时所属的 Markdown 视图。分屏视图（包括同一文件的两个视图）分别维护当前匹配项。
-   在该视图打开另一文件时，保留查询文本并重算匹配；导航和替换不复用其他文档的坐标。
-   编辑正文时立即清除旧高亮，再重算匹配，且不自动滚动。历史保存不会延迟匹配导航。
-   查找器隐藏时仍可执行替换命令，写入前会重新匹配。已经关闭或处于阅读模式的视图不作为替换目标。

## 搜索历史

-   历史保存精确查询，包括首尾空格、换行和制表符。允许纯空白查询，不记录空字符串；旧记录中已经被裁掉的空白无法恢复。
-   同一查询连续导航只增加一次使用次数，后续只更新最近使用时间。查询从 A 变成 B 再回到 A 时开始新的使用周期。复用历史计数一次，紧接着的导航不重复计数。
-   复制成功后才计入使用次数。禁用历史后保留已有记录，仍可查看、复制和删除，但停止记录、使用统计及上下键历史导航。
-   容量为 1–200 条，按 Enter 或离开输入框后确认。缩容立即按当前排序保留高优先级记录；相同优先级依次按最近使用时间、创建时间和精确文本确定稳定顺序。
-   设置和历史使用独立快照串行保存。保存失败时保留内存修改并节流提示，下次修改会尝试保存最新状态；不会自动后台重试，也不保证应用强制退出时落盘。
-   旧格式和混合格式历史逐项校验。精确文本重复项合并时取最早创建时间、最近使用时间和最大计数。若无法读取已有数据，则禁止写入以免覆盖；修复存储问题后重新加载插件。读取失败期间的临时修改不会在重载时合并。

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
