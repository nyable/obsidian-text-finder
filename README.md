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
-   Find/replace within exact editor selections, including multiple selections
-   Input history

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
-   All closing commands use the same behavior. The query, the replacement text and the match options are retained by default; “Clear search and replacement text” clears the query and replacement text, not the options. Escape has no finder effect while it is hidden.

## General settings and floating search entry

- General settings includes “Show floating search entry when opening notes”, off by default. When enabled, existing and newly opened Markdown notes show a compact search icon without searching, scrolling, taking focus or opening the keyboard. Split views have independent entries.
- Clicking the icon expands without focusing an input. Show/Toggle Find commands expand and focus the query, retaining existing inputs and options. Open Find and Replace/Toggle Replace commands open the full panel and show the replacement row from a closed or compact state, focusing the replacement input; normal toggling applies when the panel is already expanded.
- Closing an entry keeps it closed when switching back to that tab; opening another note can show it again. Existing expanded panels are not forced to collapse. Disabling the setting only stops future automatic display. Reading mode uses Text Finder, with native fallback when unsupported; replacement commands never switch a reading view to editing.

## Whole-word matching

- Toggle “Match whole word” beside the regex and match-case controls. It is off by default and applies to editing search, reading search and editing replacements; it can be combined with regex.
- Boundaries follow VS Code's default editor word separators, not JavaScript `\b` or language-aware segmentation. `cat` matches `(cat)` and `cat-dog`, but not `cat2`, `cat_name` or `concatenate`.
- Chinese text is not automatically segmented: `中文` does not match part of `中文内容`. Full-width punctuation and NBSP are not default separators.
- Punctuation at the start/end of the match can itself satisfy that boundary: `C++` also matches `C++17`. Regex checks use the actual complete match without changing captures or replacement templates.
- Reading search checks the continuous rendered text, not individual DOM nodes; its results can differ from Markdown source search. Native-find fallback keeps Obsidian's own semantics.

## Find in selection

The note's top-right **More options → Text Finder: Open find** follows the ordinary command and your settings, including automatic selection seeding. With body text selected, right-click **Find selected text** to clear an old scope and search the whole note using that text, or **Find in selection** to restrict the scope while retaining the query. Explicit selected-text search does not depend on automatic selection seeding. Reading scope search requires plugin support and never silently becomes native full-note search. Reading context-menu integration is capability-checked; actual host, popup and mobile selection menus still require verification.

- Select editor text and run **Open find in selection**, or enable **Find in selection** in the finder's More menu. The dedicated command retains the query; normal Open Find still follows the selection-as-query preference. Appearance settings can place the action inline, in More or hide it. There is no default-enabled or expand-to-whole-lines setting.
- Scopes use exact Markdown source characters, even across lines. Multiple nonempty selections are searched separately, without including gaps or concatenating text. Counts, navigation and every replacement entry point use the same scope.
- The selection button's active state indicates the mode; a subtle editor background marks the range without an underline or extra text beside the count. When the action is in More, a small accent dot appears on the collapsed More button and hides when expanded; hidden actions do not add a separate marker. Navigation never shrinks the scope. Select again and rerun the dedicated command to update it, or turn the scope action off to return to full-file search. Empty/invalid scopes remain restricted and pressed, with a tooltip explaining how to reselect or turn the restriction off.
- Scopes follow edits, including insertions/replacements at their edges. Deleting exactly a scope keeps collapsed anchors so undo can restore it. Edits crossing a scope boundary invalidate that range instead of guessing a wider boundary. Empty/invalid scopes cannot replace text.
- Collapsing the panel retains the scope; closing ends it and blocks hidden replacement from silently becoming a full-file edit. Explicitly reopening ordinary Find starts a full-file session. File/mode changes, editor rebuilds and window migration invalidate the scope; reselect or explicitly clear it. Scopes are view-local and never saved.
- Regex scans the original document from each scope's start, accepting only fully contained matches. Lookarounds, line anchors, whole-word boundaries and prefix/suffix replacement templates retain full-document context: selecting `bar` in `foobar` allows `(?<=foo)bar`, but not `^bar`. This is not a promise of identical VS Code regex semantics.
- Editing uses Markdown source selections in Source/Live Preview; reading uses selected rendered body text for find only, never replacement. Coordinates do not transfer between modes. Enable after the body finishes rendering; source or node reconstruction invalidates the reading scope rather than silently searching the whole note.

More opens a compact panel of icon buttons matching the inline toolbar. Mode toggles keep it open for consecutive adjustments; other actions close it. A 5px theme-accent dot at the top right of collapsed More indicates enabled modes inside, without a mode-style blue background or border. Expanding hides the dot and retains only subtle expanded-border feedback; collapsing restores the dot only if needed. The dot takes no layout space, has no animation or separate click target, and the accessible mode description remains available while expanded. Toolbar focus rings use `:focus-visible` for keyboard navigation rather than a persistent pointer-focus blue shadow; mode activation styling is unchanged. Click outside, click More again or press Escape to dismiss; Escape does not also close the finder. Arrow keys and Home/End browse enabled buttons; Tab retains native focus traversal.

### Search selection appearance

In **Settings → Appearance → Search selection**, customize background and border colors (both support opacity), enable the contour outline, and choose a width of 1–3px. Defaults inherit the theme's subtle background and accent color, with the outline off and width set to 1px. Color drafts affect only the preview until applied. Individual color resets restore inheritance; the section reset changes only selection appearance, not match colors or toolbars.

Background color is always available. Show selection outline precedes its dependent controls; border color and width appear only when enabled. Turning it off retains those values and dismisses related popups. Left/right edges receive only half-stroke compensation, keeping the inner edge close to selected character boundaries without an extra 2px margin; top/bottom retain about 2px of inner clearance. Tight gaps limit expansion along their separating axis. No text padding or actual scope changes are made.

The outline follows currently rendered selected text rather than a large enclosing rectangle. Syntax/highlight fragments share a contour, while separate selections never bridge their gaps. It remeasures after reflow/scroll; hidden source or disconnected text may produce separate contours. It does not intercept input, change text layout or expand the actual search/replacement range. Older hosts without CodeMirror's layer API retain background-only presentation.

Fully selected, visible blank lines (including spaces/tabs) within one continuous scope receive contour connections, preferring the neighboring text's shared width rather than the full editor width. Hidden/folded source, separate scopes and ambiguous bidi fragments remain conservatively disconnected. In editing mode, matched source newlines show a small `↵` at each consumed line break using the existing current/other match colors; multiple newlines in one match still count as one match. These overlays do not alter document text, wrapping or copied content. Reading mode does not add source-newline markers. Actual themes, quotes/lists, Live Preview and mobile drawing still require host verification.

Reading view also supports Open find in selection and the scope toggle without replacing the current query. Locked scopes survive input focus/navigation and virtual node reattachment, while changed body/source/node identity fails closed. Scope background and optional contour use the existing appearance settings. Reading `<br>`, preformatted newlines and anchored body-block boundaries can be counted, navigated and shown as `↵`; protection separators, the trailing index sentinel and soft wrapping do not create standalone newline results. Rendering, clipping, command-palette selection and mobile behavior still require host verification. Reading view never writes files or switches to edit mode; an explicit scoped command does not silently fall back to native full-note search.

## Move or collapse the finder

- On desktop, drag the left accent strip directly in either editing or reading mode. The replace-fold arrow only folds the replace row. On mobile, use the short horizontal grip at the top center of the result bar; its drag area is larger than the visible grip and avoids the side edges. Movement starts after about 3px without holding; dragging fades the finder to 80% opacity, and release/cancel restores it. Move controls use accessible names without hover tooltips.
- Enable “Collapse when dragged to an edge” in General settings (off by default). Drag near either edge and release; a near-full-width finder instead requires a clear horizontal drag, so vertical movement does not collapse it. The compact search marker is 30px on desktop and 40px on mobile. Drag it freely in both directions: release near an edge to snap there, or elsewhere to leave it compact at that position. Dragging does not expand it; click to expand without opening the keyboard. Desktop right-click offers close/reset. Mobile long presses neither open that menu nor accidentally expand the marker; holding then dragging still works. On mobile, expand to close, or restore position using the command. Input text-selection menus, Escape and close commands retain their normal behavior.
- Queries, options, current match, replace-row state and highlights remain active while collapsed. Replacement calculation cannot auto-collapse; replacement commands first expand the finder to show progress. Full-width expansion is centered at the chosen height. No collapse on scroll, mouse leave or resize.
- Mobile More stays beside the input. Only inline actions that do not fit move to the result bar, preserving their order and settings; they return when space allows. The result bar may wrap rather than clip controls.
- The mobile result bar and single-row search panel share a consistent base height. Search/replacement inputs have explicit line height and padding while retaining scrolling for multiline or long text instead of hiding content.
- The compact entry uses the theme's secondary background, normal text color and softly rounded corners. Automatic entries initially sit at a safe edge (right by default), independently of auto-collapse; a manually parked icon stays floating when switching back to its tab.
- Mobile dragging isolates host swipe gestures only on the compact icon/center grip, with early pointer capture and local touch protection. Note-body swipes and input touches remain available; no long press is required.
- Arrow keys on the move control shift 8px (Shift: 32px), Home resets. “Restore finder position” remains available in commands (current view), not General settings. Positions are session-only and bounded by the note view and visible viewport.

## Reading-mode search

-   Run “Open search in current file” in reading mode for case-sensitive search, whole-word matching, regex, highlights and match navigation. Replacement is not available.
-   Searches rendered body text, not hidden Markdown markers. Embedded notes and some plugin-generated content are not supported.
-   Reading mode now always uses Text Finder when supported. The old native-search preference is removed on upgrade; unsupported environments still show a notice and fall back to native find, and runtime failures retain a manual native-find action.

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
-   Keep 1–200 entries. Display sorting and retention are independent: retain recent, frequent or newly created queries (legacy). Upgrades inherit the old sorting preference for retention; changing display order no longer changes eviction.
-   A stable-height dialog keeps content scrolling independently. Filter queries, select rows directly for batch deletion, and inspect exact text in Details. Copying no longer changes usage. Undo the most recent deletion within 8 seconds in the same dialog.
-   Disabling history preserves existing entries but stops recording new queries, updating usage and Up/Down history navigation.
-   Read/save failures display a notice. Follow its instructions; unsaved changes may be lost on exit.

## Find and replace presets

- Run **Save current find as preset** to name the current view's rule. The replacement row's fold state is saved separately from its value and regex escape interpretation, so folding never discards a saved replacement. Creating from history copies only the query, so review the options before saving.
- Run **Apply find / replace preset**, filter by name or rule, and select an entry. Applying fills the finder and searches; **it never replaces note text automatically**. Existing selection restrictions, including invalid scopes, remain in effect; coordinates are never saved.
- An empty replacement deletes matches; it is not a find-only preset. Application clears any old replacement if none is saved and restores the saved row fold state. Reading mode applies only find options, without changing mode or retaining replacement text for later.
- Each preset card previews the Finder with its saved fold state. Apply from the middle; edit or delete with the icons on the right. Reorder with the left handle (drag or Up/Down, Home/End); clear filtering first. Order persists, renaming keeps position, and new presets append.
- Edit, rename, save as new, delete or briefly undo deletion. Finder edits do not update saved presets automatically. Modified drafts require explicit discard before closing. Presets are independent of history recording and capacity.
- Assign shortcuts to these two commands in Obsidian. Per-preset commands are not registered.

## Appearance settings

- Reorder actions and choose Toolbar, More or Hidden in individual action blocks in the Appearance settings tab. The full preview stays at the top while configuration scrolls below; it always displays both find and replace rows and has no interactive controls.
- Colors, search selection, search toolbar and replacement toolbar sections fold independently and start collapsed. An undo-style icon beside each heading shows a Restore default settings tooltip. Clicking directly restores that section; individual color resets affect only that color, with no confirmation dialog. All resets show the same brief “Default settings restored” notice.
- The preview uses the fixed query `text` and an empty replacement field. One two-line English text area combines current and other match highlights with a cross-line selection; narrow widths wrap naturally without clipping or reducing the font size.
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
