# Obsidian Text Finder

[简体中文说明](README-zh_CN.md)

This plugin for Obsidian(https://obsidian.md).  
Provides a search/replace window similar to VSCode in editing mode.

**Note:** The Obsidian API is still in early alpha and is subject to change at any time!

## Feature

Search or replace the text of the current MarkDown file **in editor mode**.

-   Highlight matching text.
-   Display the total number of matches and the current item.
-   Supports regular expressions.
-   Supports case sensitivity.

## ScreenShot

# How to use

## Install

### Source Code

-   Clone this repo.
-   `npm i` or `yarn` to install dependencies
-   `npm run build` to build file in `./dist`.
-   Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/obsidian-text-finder/`.
-   Enable plugin in Obsidian setting.

### Releases

-   Download `main.js`, `styles.css`, `manifest.json` in the [latest release](https://github.com/nyable/obsidian-text-finder/releases/latest)
-   Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/obsidian-text-finder/`.
-   Enable plugin in Obsidian setting.

## Settings

## Customize Style

Use [Css snippets](https://help.obsidian.md/Extending+Obsidian/CSS+snippets) to override classes, customize matching highlights and styles for the current item.  
Such as:

```css
.nya-text-finder-match {
	border: 1px solid #5fb4b4;
	background-color: inherit;
	color: inherit;
}

.nya-text-finder-match-current {
	background-color: #fac761;
	color: black;
}
```
