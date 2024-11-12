# Obsidian Text Finder

[English](README.md)  
[中文说明](README-zh_CN.md)

This plugin for Obsidian(https://obsidian.md).  
Provides a search/replace window similar to VSCode in editing mode.

**Note:** The Obsidian API is still in early alpha and is subject to change at any time!

## Feature

Search or replace the text of the current MarkDown file **in editor mode**.

-   Search/Replace in current file
-   Highlight matching text
-   Show number of matches
-   Supports regular expressions
-   Supports case sensitivity

## To Do

-   [ ] Search/Replace in Selection
-   [ ] Input history

## ScreenShot

![Text Finder](https://github.com/nyable/obsidian-text-finder/blob/master/screenshot/demo.gif?raw=true)

# How to use

## Install

### Community plugins

-   Search for "text finder" in the community plugins and install it.
-   Enable plugin in Obsidian setting.

### BRAT

-   [Install the BRAT Plugin](https://obsidian.md/plugins?id=obsidian42-brat)
-   Execute command `Obsidian42 - BRAT: Add a beta plugin for testing`
-   Paste the URL of this repository and confirm
-   Enable plugin in Obsidian setting.

### Source Code

-   Clone this repo.
-   `npm i` or `yarn` to install dependencies
-   `npm run build` to build file in `./dist`.
-   Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/text-finder/`.
-   Enable plugin in Obsidian setting.

### Releases

-   Download `main.js`, `styles.css`, `manifest.json` in the [latest release](https://github.com/nyable/obsidian-text-finder/releases/latest)
-   Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/text-finder/`.
-   Enable plugin in Obsidian setting.

## Settings

-   Assign a hotkeys for the plugin's command.

## Customize Style

Use [CSS snippets](https://help.obsidian.md/Extending+Obsidian/CSS+snippets) to customize styles.  
Here are some examples.

### Match Highlight and Current Item

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

### Change Position

Top Left

```css
.nya-finder {
	right: unset !important;
	left: 376px;
}
```

Bottom Right

```css
.nya-finder {
	top: unset !important;
	bottom: 72px;
}
```

Bottom Left

```css
.nya-finder {
	top: unset !important;
	right: unset !important;
	left: 376px;
	bottom: 72px;
}
```

### Change the border color when focused

```css
body {
	--nya-focus-border-color: #39c5bb;
}
```

### Change the color of the collapse button

```css
.toggle-btn {
	border-left: 3px solid red !important;
}
```
