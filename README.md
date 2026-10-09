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
-   Input history

## To Do

-   [ ] Search/Replace in Selection


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
-   Use Node.js 24.21.0 (see `.node-version`) and pnpm 12.3.4 (see `packageManager` in `package.json`). Install pnpm following its [installation guide](https://pnpm.io/installation).
-   `pnpm install --frozen-lockfile` to install the committed dependency versions.
-   `pnpm test` to run the regression tests and `pnpm typecheck` to check TypeScript and Svelte components.
-   `pnpm build` to build files in `./dist`.
-   Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/text-finder/`.
-   Enable plugin in Obsidian setting.

Dependency changes must update and commit `pnpm-lock.yaml` using pnpm. CI installs
with `--frozen-lockfile`, runs tests and TypeScript/Svelte checks, and builds the plugin.
Do not use npm or Yarn to install dependencies in this repository.

### Releases

-   Download `main.js`, `styles.css`, `manifest.json` in the [latest release](https://github.com/nyable/obsidian-text-finder/releases/latest)
-   Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/text-finder/`.
-   Enable plugin in Obsidian setting.

## Settings

-   Assign a hotkeys for the plugin's command.

## Regular expression replacement

Enable regular expression mode to use capture groups in replacements: for example,
find `(foo)(bar)` and replace with `$2-$1` to produce `bar-foo`.

-   Search and replacement share the case-sensitivity option and multiline anchors (`^` and `$`). Lookarounds use the complete current document.
-   Replacement templates follow JavaScript rules: `$1`–`$99`, `$<name>`, `$&` (the match), `$$` (a literal dollar sign), `` $` `` (text before the match), and `$'` (text after the match).
-   When the escape-character setting is enabled, `\n` and `\t` in regex replacements become a newline and a tab; `\\` inserts a literal backslash.
-   In ordinary text mode, replacement text is literal: dollar templates and backslash escapes are not expanded.
-   Zero-width matches, such as `^` on its own, are currently excluded from search and replacement.

## Editor isolation

-   Each finder operates on the Markdown view where it was opened. Split views, including two views of the same file, keep their own current match.
-   Opening another file in that view preserves the query but recalculates its matches. Navigation and replacement never reuse offsets from another document.
-   Editing clears old highlights immediately and recomputes them without scrolling. Search history saving does not delay match navigation.
-   Replacement commands still work when the finder is hidden; they recalculate matches before changing text. A closed view or a view in reading mode is not a replacement target.

## Customize Style

Use [CSS snippets](https://help.obsidian.md/Extending+Obsidian/CSS+snippets) or [Style Settings Plugin](https://github.com/mgmeyers/obsidian-style-settings) to customize styles.

[Example Style Settings configuration file](./style-settings.css).

Here are some CSS snippets examples.

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
.nya-toggle {
	border-left: 3px solid red !important;
}
```
