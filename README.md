# Obsidian Text Finder

[English](README.md)  
[中文说明](README-zh_CN.md)

This plugin for Obsidian(https://obsidian.md).  
Provides a VSCode-like finder: search/replace in editing mode and rendered-text search in reading mode.

## Feature

Search or replace the current Markdown file **in editing mode**, or search its rendered body **in reading mode**.

-   Search/Replace in current file
-   Highlight matching text
-   Show number of matches
-   Supports regular expressions
-   Supports case sensitivity
-   Supports whole-word matching
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

### Releases

-   Download `main.js`, `styles.css`, `manifest.json` in the [latest release](https://github.com/nyable/obsidian-text-finder/releases/latest)
-   Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/text-finder/`.
-   Enable plugin in Obsidian setting.

## Basic usage

-   Assign shortcuts to Text Finder commands in Obsidian's hotkey settings.
-   Run “Open search in current file”, enter a query, and use the previous/next buttons or Enter to navigate matches.
-   In editing mode, use “Open search & replace in current file” for replacements. Press Escape or the close button to hide the finder.
-   All closing commands use the same behavior. Queries and regex/match-case/whole-word options are retained by default; “Clear search and replacement text” clears both inputs, not the options. Escape has no finder effect while it is hidden.

## Whole-word matching

- Toggle “Match whole word” beside the regex and match-case controls. It is off by default and applies to editing search, reading search and editing replacements; it can be combined with regex.
- Boundaries follow VS Code's default editor word separators, not JavaScript `\b` or language-aware segmentation. `cat` matches `(cat)` and `cat-dog`, but not `cat2`, `cat_name` or `concatenate`.
- Chinese text is not automatically segmented: `中文` does not match part of `中文内容`. Full-width punctuation and NBSP are not default separators.
- Punctuation at the start/end of the match can itself satisfy that boundary: `C++` also matches `C++17`. Regex checks use the actual complete match without changing captures or replacement templates.
- Reading search checks the continuous rendered text, not individual DOM nodes; its results can differ from Markdown source search. Native-find fallback keeps Obsidian's own semantics.

## Move or collapse the finder

- On desktop, drag the left accent strip directly in either editing or reading mode. The replace-fold arrow only folds the replace row. On mobile, use the grip in the result/close bar. Movement starts after about 3px without holding; dragging fades the finder to 80% opacity, and release/cancel restores it. Move controls use accessible names without hover tooltips.
- Enable “Collapse when dragged to an edge” in Find settings (off by default). Drag near either edge and release; a near-full-width finder instead requires a clear horizontal drag, so vertical movement does not collapse it. The compact search marker is 30px on desktop and 40px on mobile. Drag it freely in both directions: release near an edge to snap there, or elsewhere to leave it compact at that position. Dragging does not expand it; click to expand without opening the keyboard. Its context menu offers close/reset; Escape and close commands retain their normal behavior.
- Queries, options, current match, replace-row state and highlights remain active while collapsed. Replacement calculation cannot auto-collapse; replacement commands first expand the finder to show progress. Full-width expansion is centered at the chosen height. No collapse on scroll, mouse leave or resize.
- Mobile More stays beside the input. Only inline actions that do not fit move to the result bar, preserving their order and settings; they return when space allows. The result bar may wrap rather than clip controls.
- Arrow keys on the move control shift 8px (Shift: 32px), Home resets. “Restore finder position” is also available in commands (current view) and Find settings (existing views). Positions are session-only and bounded by the note view and visible viewport.

## Reading-mode search

-   Run “Open search in current file” in reading mode for case-sensitive search, whole-word matching, regex, highlights and match navigation. Replacement is not available.
-   Searches rendered body text, not hidden Markdown markers. Embedded notes and some plugin-generated content are not supported.
-   If native find still opens after upgrading, disable “Using Obsidian's native search in reading” in settings.

## Regular expression replacement

Find matching, replacement candidates and post-replacement matching preferably run in a Worker; close the finder to terminate pending work. Worker startup unavailability is reported and falls back to synchronous compatibility mode. Execution failures are not automatically replayed; retry in a Worker or explicitly choose synchronous retry. Complex regex can block the interface in synchronous mode. **Text commits remain synchronous transactions; replace-all supports one undo. Cancelling after commit does not undo text, and retry never replays an already applied replacement.** Reading-mode DOM indexing, result processing and painting remain on the main thread. No regex syntax or match-count restrictions are added.

Enable regular expression mode to use capture groups in replacements: for example,
find `(foo)(bar)` and replace with `$2-$1` to produce `bar-foo`.

-   Use `$1`, `$2`, etc. for capture groups, `$<name>` for named groups, `$&` for the matched text, and `$$` for a literal dollar sign.
-   When the escape-character setting is enabled, `\n` and `\t` in regex replacements become a newline and a tab; `\\` inserts a literal backslash.
-   In ordinary text mode, replacement text is literal: dollar templates and backslash escapes are not expanded.
-   Zero-width matches, such as `^` on its own, are currently excluded from search and replacement.

## Split views

-   Each finder operates on the Markdown view where it was opened. Split views, including two views of the same file, keep their own current match.
-   Opening another file in that view preserves the query and updates the results.
-   Editing updates matches without automatically changing your reading position. Replacement is available only in editing mode.

## Search history

-   Run “Show search history” to view, reuse, copy or delete queries. Use Up/Down in the search field to browse history.
-   Leading/trailing spaces, newlines and tabs are preserved. Continuous navigation with the same query counts as one use.
-   If the query being browsed is deleted, browsing moves to the next surviving neighbour, or the previous one at the end. Empty history restores the input from before browsing.
-   Keep 1–200 entries and sort by creation time, last use or usage count. Lowering the limit removes lower-priority entries.
-   Disabling history preserves existing entries but stops recording new queries, updating usage and Up/Down history navigation.
-   Read/save failures display a notice. Follow its instructions; unsaved changes may be lost on exit.

## Appearance settings

- Reorder actions and choose Toolbar, More or Hidden in individual action blocks in the Appearance settings tab. The full preview stays at the top while configuration scrolls below; it always displays both find and replace rows and has no interactive controls.
- Colors, search toolbar and replacement toolbar sections fold independently and start collapsed. An undo-style icon beside each heading shows a Restore default settings tooltip. Clicking directly restores that section; individual color resets affect only that color, with no confirmation dialog. All resets show the same brief “Default settings restored” notice.
- The preview uses the fixed query `text` and an empty replacement field. The English sample below shows current and other match highlights using the existing highlight colors and CSS customizations.
- Customize the focus border, accent strip, and text/background colors of current and other matches. Click a swatch to open the color/opacity picker; adjustments only affect the preview until you click Apply. Canceling or leaving settings discards the draft. Unset colors inherit existing CSS; resetting a color or the color section removes overrides without changing toolbar configuration.
- Set “Enabled by default” on the regex, match-case and whole-word items. These defaults initialize new finders for each Markdown view; existing finders and reopening or switching files/modes retain manual choices. Exact historical default layouts migrate to group all three match options; customized orders/placements are preserved.
- Restore defaults affects only its toolbar: search restores the layout and turns off all three default options; replace restores its layout. Existing finders keep their options. Hiding a button does not turn its mode off.

## Customize Style

Use [CSS snippets](https://help.obsidian.md/Extending+Obsidian/CSS+snippets) or [Style Settings Plugin](https://github.com/mgmeyers/obsidian-style-settings) to customize styles.

[Example Style Settings configuration file](./style-settings.css).

To use the example, save it as a CSS snippet in your vault, enable that snippet, then open the Style Settings plugin. Installing Style Settings alone does not register this example.

Here are some CSS snippets examples.

### Match colors (editing and reading modes)

```css
body {
	--nya-match-bgColor: #ea5c0054;
	--nya-match-color: inherit;
	--nya-match-curbgColor: #ffcc00;
	--nya-match-curColor: #000000;
}
```

### Match Highlight and Current Item (editing mode)

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

## Developer documentation

For source builds, design notes, testing and acceptance, see the [developer documentation](docs/README.md).
