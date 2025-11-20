<script lang="ts">
	import {
		ArrowDown,
		ArrowUp,
		ReplaceAll,
		X,
		Replace,
		Regex,
		CaseSensitive,
		ChevronDown,
		ChevronRight,
	} from "lucide-svelte";
	import { searchCacheEffect, type EditorSearch } from "./editor-extension";
	import { i18n } from "./i18n";
	import { MarkdownView, Platform } from "obsidian";
	import type { EditorView } from "@codemirror/view";
	import { findTextOffsets } from "./util/text-helper";
	import type { TransactionSpec } from "@codemirror/state";
	import { HistorySortOrder } from "./constants";

	export let editorSearch: EditorSearch;
	export let cid: string;

	const cache: SearchCache = {
		search: "",
		replace: "",
		index: 0,
		matches: [],
		visible: false,
		collapse: true,
		options: {
			regexMode: false,
			caseSensitive: false,
		},
	};

	// Search History
	// let searchHistory: string[] = []; // Use plugin.settings.searchHistory instead
	let historyIndex = -1;
	// Temporary storage for the current input when navigating history
	let tempInput = "";
	// Track the last recorded search term to avoid duplicate count increments
	let lastRecordedSearch = "";

	// Get sorted history based on user preference
	const getSortedHistory = () => {
		const searchHistory = editorSearch.plugin.settings.searchHistory;
		const sortOrder = editorSearch.plugin.settings.historySortOrder;
		return [...searchHistory].sort((a, b) => {
			switch (sortOrder) {
				case HistorySortOrder.CREATED_AT:
					return b.createdAt - a.createdAt;
				case HistorySortOrder.COUNT:
					// Primary sort: by count (descending)
					const countDiff = (b.count || 0) - (a.count || 0);
					// Secondary sort: if count is same, sort by lastUsedAt (descending)
					if (countDiff === 0) {
						return b.lastUsedAt - a.lastUsedAt;
					}
					return countDiff;
				case HistorySortOrder.LAST_USED_AT:
				default:
					return b.lastUsedAt - a.lastUsedAt;
			}
		});
	};

	// Record search to history
	// If it's the first time for this search term in current session, increment count
	// Otherwise, only update lastUsedAt
	const recordSearchToHistory = async (searchText: string) => {
		const { enableHistory, historyMaxCount } = editorSearch.plugin.settings;
		if (!enableHistory || !searchText.trim()) {
			return;
		}

		const searchHistory = editorSearch.plugin.settings.searchHistory;
		const trimmedText = searchText.trim();

		// Check if this search term was already recorded in current session
		const isAlreadyRecorded = lastRecordedSearch === trimmedText;

		// Find existing entry
		const existingIndex = searchHistory.findIndex(
			(item) => item.text === trimmedText,
		);

		if (existingIndex !== -1) {
			// Update existing entry
			const existing = searchHistory[existingIndex];
			searchHistory.splice(existingIndex, 1);
			searchHistory.push({
				text: trimmedText,
				lastUsedAt: Date.now(),
				createdAt: existing.createdAt || Date.now(),
				count: isAlreadyRecorded
					? existing.count
					: (existing.count || 0) + 1,
			});
		} else {
			// Before adding new entry, check if we need to make room
			// Remove lowest priority item if we're at capacity
			if (searchHistory.length >= historyMaxCount) {
				const sorted = getSortedHistory();
				if (sorted.length > 0) {
					// Get the last item (lowest priority) after sorting
					const itemToRemove = sorted[sorted.length - 1];
					// Find and remove it from the original array
					const indexToRemove = searchHistory.findIndex(
						(item) => item.text === itemToRemove.text,
					);
					if (indexToRemove !== -1) {
						searchHistory.splice(indexToRemove, 1);
					}
				}
			}

			// Add new entry
			searchHistory.push({
				text: trimmedText,
				lastUsedAt: Date.now(),
				createdAt: Date.now(),
				count: 1,
			});
		}

		// Mark as recorded
		lastRecordedSearch = trimmedText;

		// Save settings
		await editorSearch.plugin.saveSettings();
	};

	$: isCollapsed = cache.collapse;
	$: finderTabIndex = cache.collapse ? 0 : 1;
	$: commonTabIndex = cache.collapse ? 0 : 2;
	$: replacerTabIndex = cache.collapse ? -1 : 1;
	const isMobile = Platform.isMobile;
	const iconSize = 18;
	let searchEl: HTMLTextAreaElement;

	export function getSearchCache() {
		return cache;
	}

	export function setVisible(
		flag: boolean,
		searchText?: string,
		historyIndexOverride?: number,
	) {
		cache.visible = flag;
		const settings = editorSearch.plugin.settings;
		if (cache.visible) {
			if (searchText) {
				cache.search = searchText;
			}
			setFindText(cache.search);
			searchEl.select();
			// Set history index (either provided or reset to -1)
			historyIndex =
				historyIndexOverride !== undefined ? historyIndexOverride : -1;
			tempInput = "";
		} else {
			cache.collapse = true;
			if (settings.clearAfterHidden) {
				resetMatches(true, true);
			} else {
				emitChange();
			}
		}
	}

	// Set visible from history selection
	// This function finds the position of the selected item in the sorted history
	export function setVisibleFromHistory(searchText: string) {
		const sortedHistory = getSortedHistory();
		const index = sortedHistory.findIndex(
			(item) => item.text === searchText,
		);
		// Set visible with the history index
		setVisible(true, searchText, index);
	}

	export function setCollapse(flag: boolean) {
		cache.collapse = flag;
	}

	export function resetAll() {
		cache.search = "";
		cache.replace = "";
		cache.index = 0;
		cache.matches = [];
		cache.visible = false;
		cache.collapse = true;
		cache.options = {
			regexMode: false,
			caseSensitive: false,
		};
		emitChange();
	}

	export function toggleVisible() {
		setVisible(!cache.visible);
	}

	export function toggleCollapse() {
		setCollapse(!cache.collapse);
	}

	export function isVisible() {
		return cache.visible;
	}

	const onSearchChanged = (e: Event) => {
		const target = e.target as HTMLTextAreaElement;
		setFindText(target.value);
	};

	const replaceAll = () => {
		replaceAllMatchedText(cache.replace);
	};

	const replaceOnce = () => {
		const { beforeCount, afterCount } = replaceMatchedText(cache.replace);
		if (beforeCount === afterCount) {
			toNextMatch();
		}
	};

	export const closeFinder = () => {
		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const state = activeEditor.view.getState();
			const { sourceModeWhenSearch } = editorSearch.plugin.settings;
			if (state.mode === "source" && sourceModeWhenSearch) {
				state.source = !isNeedPreviewMode();
				activeEditor.view.setState(state, { history: false });
			}
		}
		setVisible(false);
	};
	export const toggleRegexMode = (e: Event) => {
		cache.options.regexMode = !cache.options.regexMode;
		searchEl.focus();
		setFindText(cache.search);
	};

	export const toggleMatchCaseMode = (e: Event) => {
		cache.options.caseSensitive = !cache.options.caseSensitive;
		searchEl.focus();
		setFindText(cache.search);
	};

	export const getActiveEditor = () => {
		const view =
			editorSearch.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const editor = view.editor;
			return {
				view: view,
				editor: editor,
				// eslint-disable-next-line
				editorView: (editor as any).cm as EditorView,
			};
		}
		return null;
	};

	export const emitChange = (
		withCache: boolean = true,
		extraSpec?: TransactionSpec,
	) => {
		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const { editorView } = activeEditor;
			let spec: TransactionSpec = {
				effects: withCache ? [searchCacheEffect.of(cache)] : [],
			};
			if (extraSpec) {
				spec = Object.assign(spec, extraSpec);
			}
			editorView.dispatch(spec);
		}
	};

	export const setFindText = (text: string, scroll: boolean = true) => {
		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const { editor } = activeEditor;

			// Reset recorded state when search text changes
			if (cache.search !== text) {
				lastRecordedSearch = "";
			}

			cache.search = text;
			if (text) {
				const content = editor.getValue();
				cache.matches = findTextOffsets(
					content,
					text,
					cache.options.regexMode,
					cache.options.caseSensitive,
				);
				if (cache.index > cache.matches.length - 1) {
					cache.index = 0;
				}
				if (cache.matches.length > 0) {
					if (scroll) {
						scrollToMatch();
					} else {
						emitChange();
					}
				} else {
					resetMatches();
				}
			} else {
				resetMatches(true);
			}
		}
	};

	export const toNextMatch = async () => {
		const matchSize = cache.matches.length;
		if (matchSize == 0) {
			cache.index = 0;
		} else {
			cache.index = (cache.index + 1) % matchSize;
		}

		// Record to history when navigating matches
		if (cache.search) {
			await recordSearchToHistory(cache.search);
		}

		scrollToMatch();
	};

	export const toPreviousMatch = async () => {
		const matchSize = cache.matches.length;
		if (matchSize == 0) {
			cache.index = 0;
		} else {
			cache.index = (cache.index - 1 + matchSize) % matchSize;
		}

		// Record to history when navigating matches
		if (cache.search) {
			await recordSearchToHistory(cache.search);
		}

		scrollToMatch();
	};

	export const scrollToMatch = () => {
		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const { editor } = activeEditor;

			const { matches, index } = cache;
			if (matches.length > 0) {
				const matched = matches[index];
				const { from, to } = matched;

				editor.scrollIntoView(
					{
						from: editor.offsetToPos(from),
						to: editor.offsetToPos(to),
					},
					true,
				);
				const view = activeEditor.view;
				const state = view.getState();
				const { sourceModeWhenSearch, moveCursorToMatch } =
					editorSearch.plugin.settings;
				if (sourceModeWhenSearch && state.mode === "source") {
					state.source = true;
				}
				view.setState(state, { history: false });
				emitChange(true, {
					selection: moveCursorToMatch
						? { anchor: from, head: to }
						: undefined,
				});
			}
		}
	};

	export const resetMatches = (clearSearch = false, clearReplace = false) => {
		cache.matches = [];
		cache.index = 0;
		if (clearSearch) {
			cache.search = "";
		}
		emitChange();
	};

	const adjustReplaceText = (text: string) => {
		if (editorSearch.plugin.settings.useEscapeCharInReplace) {
			return text
				.replace(/\\\\/g, "\0")
				.replace(/\\n/g, "\n")
				.replace(/\\t/g, "\t")
				.replace(/\0/g, "\\");
		}
		return text;
	};

	export const replaceMatchedText = (inputText: string): ReplaceResult => {
		const { matches, search, replace, index } = cache;
		const matchSize = matches.length;
		const result: ReplaceResult = {
			changeCount: 0,
			changed: false,
			search: search,
			replace: replace,
			beforeCount: matchSize,
			afterCount: matchSize,
		};

		const activeEditor = getActiveEditor();
		if (activeEditor) {
			if (matchSize > 0) {
				const { regexMode, caseSensitive } = cache.options;
				const { editor, editorView } = activeEditor;
				const current = matches[index];

				let replaceStr = inputText;
				if (regexMode) {
					const regex = new RegExp(
						search,
						"g" + (caseSensitive ? "i" : ""),
					);
					const rangeText = editor.getRange(
						editor.offsetToPos(current.from),
						editor.offsetToPos(current.to),
					);
					const replacement = adjustReplaceText(inputText);
					replaceStr = rangeText.replace(regex, replacement);
				}
				editorView.dispatch({
					changes: {
						from: current.from,
						to: current.to,
						insert: replaceStr,
					},
				});

				setFindText(search);
				result.changeCount = 1;
				result.changed = true;
				result.afterCount = cache.matches.length;
			}
		}
		return result;
	};

	export const replaceAllMatchedText = (inputText: string): ReplaceResult => {
		const { matches, search, replace } = cache;
		const matchSize = matches.length;
		const result: ReplaceResult = {
			changeCount: 0,
			changed: false,
			search: search,
			replace: replace,
			beforeCount: matchSize,
			afterCount: matchSize,
		};

		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const { editor, editorView } = activeEditor;

			if (matchSize > 0) {
				let changes: { from: number; to: number; insert: string }[] =
					[];
				const { regexMode, caseSensitive } = cache.options;
				if (regexMode) {
					const regex = new RegExp(
						search,
						"g" + (caseSensitive ? "i" : ""),
					);
					const replacement = adjustReplaceText(inputText);
					changes = matches.map((item) => {
						const rangeText = editor.getRange(
							editor.offsetToPos(item.from),
							editor.offsetToPos(item.to),
						);
						const text = rangeText.replace(regex, replacement);
						return {
							from: item.from,
							to: item.to,
							insert: text,
						};
					});
				} else {
					changes = matches.map((item) => {
						return {
							from: item.from,
							to: item.to,
							insert: inputText,
						};
					});
				}

				editorView.dispatch({
					changes: changes,
				});

				setFindText(search);

				result.changed = true;
				result.changeCount = changes.length;
				result.afterCount = cache.matches.length;
			}
		}
		return result;
	};
	const onFinderKeyDown = async (e: KeyboardEvent) => {
		const { enableInputHotkeys, enableHistory, historyMaxCount } =
			editorSearch.plugin.settings;
		const searchHistory = editorSearch.plugin.settings.searchHistory;
		// Use sorted history for navigation
		const sortedHistory = getSortedHistory();

		// Handle History Navigation
		if (enableHistory && e.code === "ArrowUp") {
			const cursorPosition = searchEl.selectionStart;
			const value = searchEl.value;
			const firstLineEnd = value.indexOf("\n");

			// Only navigate history if cursor is on the first line
			if (firstLineEnd === -1 || cursorPosition <= firstLineEnd) {
				if (historyIndex === -1) {
					// Start navigating history from the beginning (most recent/used)
					tempInput = cache.search;
					historyIndex = 0;
				} else {
					// Move forward in the sorted history
					historyIndex = Math.min(
						sortedHistory.length - 1,
						historyIndex + 1,
					);
				}

				if (historyIndex >= 0 && historyIndex < sortedHistory.length) {
					e.preventDefault();
					setFindText(sortedHistory[historyIndex].text);
				} else if (historyIndex === -1) {
					// If we are at the beginning of history and go up, we might want to stay or do nothing
					// For now, let's just prevent default if we successfully changed text
				}
			}
			return;
		}

		if (enableHistory && e.code === "ArrowDown") {
			const cursorPosition = searchEl.selectionStart;
			const value = searchEl.value;
			const lastLineStart = value.lastIndexOf("\n");

			// Only navigate history if cursor is on the last line
			if (lastLineStart === -1 || cursorPosition > lastLineStart) {
				if (historyIndex === -1) {
					// VSCode-like behavior: clear search when pressing down at newest position
					if (cache.search.trim()) {
						e.preventDefault();
						setFindText("");
					}
					return;
				}

				e.preventDefault();
				// Move backward in the sorted history
				historyIndex = historyIndex - 1;
				if (historyIndex < 0) {
					// Reached beginning of history, restore temp input
					historyIndex = -1;
					setFindText(tempInput);
				} else {
					setFindText(sortedHistory[historyIndex].text);
				}
			}
			return;
		}

		const isEnterPress = ["Enter", "NumpadEnter"].includes(e.code);
		if (enableInputHotkeys && isEnterPress) {
			// 这里本来打算监听enter shift+enter ctrl+enter 但是加上修饰键 会和默认的快捷键有冲突.所以除了enter都用命令的快捷键算了
			if (!e.altKey && !e.ctrlKey && !e.shiftKey) {
				e.preventDefault();

				// Record to history
				if (cache.search) {
					await recordSearchToHistory(cache.search);
					// Reset history index
					historyIndex = -1;
					tempInput = "";
				}

				toNextMatch();
			}
		}
	};
	const enterOnReplacer = (e: KeyboardEvent) => {
		const enableInputHotkeys =
			editorSearch.plugin.settings.enableInputHotkeys;
		const isEnterPress = ["Enter", "NumpadEnter"].includes(e.code);
		if (enableInputHotkeys && isEnterPress) {
			if (!e.altKey && !e.ctrlKey && !e.shiftKey) {
				e.preventDefault();
				replaceOnce();
			}
		}
	};

	const isNeedPreviewMode = (): boolean => {
		return (editorSearch.plugin.app.vault as any).getConfig("livePreview");
	};

	const defaultEnterEvent = (e: KeyboardEvent) => {
		const isEnterPress = ["Enter", "NumpadEnter"].includes(e.code);
		if (isEnterPress) {
			e.preventDefault();
			const el = e.target as HTMLElement;
			el.click();
		}
	};

	export const matchAgain = (scroll = true) => {
		const { search } = cache;
		if (cache.visible && search != "") {
			setFindText(search, scroll);
		}
	};
</script>

<div
	data-cid={cid}
	class={`nya-finder ${cache.visible ? "nya-finder--active" : "nya-finder--hidden"}`}
	class:nya-finder--collapsed={isCollapsed}
	class:nya-mobile={isMobile}
>
	<!-- TODO: 允许通过拖动该控件改变输入框宽度，临时生效。 -->
	<div class="nya-dragger"></div>
	<div
		class={`nya-toggle nya-focus`}
		on:click={toggleCollapse}
		role="button"
		tabindex="0"
		aria-label={i18n.t("search.tip.ToggleReplace")}
		on:keydown={defaultEnterEvent}
	>
		{#if isCollapsed}
			<ChevronRight size={iconSize} />
		{:else}
			<ChevronDown size={iconSize} />
		{/if}
	</div>
	<div class="main-part">
		<div class="finder">
			<textarea
				wrap="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				on:input={onSearchChanged}
				on:keydown={onFinderKeyDown}
				rows="1"
				class="nya-input"
				bind:this={searchEl}
				bind:value={cache.search}
				placeholder={i18n.t("search.tip.FindPlaceholder")}
				tabindex={finderTabIndex}
			/>
			<!-- TODO: 组件化,有空再优化；考虑用svelte5来做 -->
			{#if isMobile}
				<div class="nya-float-act">
					<div class="nya-float-tip">
						{#if cache.matches.length > 0}
							<div>
								{i18n.t("search.tip.HasResults", {
									current: cache.index + 1,
									total: cache.matches.length,
								})}
							</div>
						{:else}
							<div style={cache.search ? "color:red" : ""}>
								{i18n.t("search.tip.NoResults")}
							</div>
						{/if}
					</div>
					<div
						class="nya-btn nya-focus"
						on:click={closeFinder}
						role="button"
						tabindex={commonTabIndex}
						on:keydown={defaultEnterEvent}
						aria-label={i18n.t("search.tip.Close")}
					>
						<X size={iconSize} />
					</div>
				</div>
			{:else}
				<div class="nya-tip">
					{#if cache.matches.length > 0}
						<div>
							{i18n.t("search.tip.HasResults", {
								current: cache.index + 1,
								total: cache.matches.length,
							})}
						</div>
					{:else}
						<div style={cache.search ? "color:red" : ""}>
							{i18n.t("search.tip.NoResults")}
						</div>
					{/if}
				</div>
			{/if}
			<div class="finder-act">
				<div
					class={`nya-btn nya-focus`}
					class:nya-btn--active={cache.options.regexMode}
					on:click={toggleRegexMode}
					role="button"
					tabindex={commonTabIndex}
					on:keydown={defaultEnterEvent}
					aria-label={i18n.t("search.tip.UseRegularExpression")}
				>
					<Regex size={iconSize} />
				</div>
				<div
					class={`nya-btn nya-focus`}
					class:nya-btn--active={cache.options.caseSensitive}
					on:click={toggleMatchCaseMode}
					role="button"
					tabindex={commonTabIndex}
					on:keydown={defaultEnterEvent}
					aria-label={i18n.t("search.tip.MatchCase")}
				>
					<CaseSensitive size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={toPreviousMatch}
					role="button"
					tabindex={commonTabIndex}
					on:keydown={defaultEnterEvent}
					aria-label={i18n.t("search.tip.PreviousMatch")}
				>
					<ArrowUp size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={toNextMatch}
					role="button"
					tabindex={commonTabIndex}
					on:keydown={defaultEnterEvent}
					aria-label={i18n.t("search.tip.NextMatch")}
				>
					<ArrowDown size={iconSize} />
				</div>
				{#if !isMobile}
					<div
						class="nya-btn nya-focus"
						on:click={closeFinder}
						role="button"
						tabindex={commonTabIndex}
						on:keydown={defaultEnterEvent}
						aria-label={i18n.t("search.tip.Close")}
					>
						<X size={iconSize} />
					</div>
				{/if}
			</div>
		</div>
		<div class="replacer" style={isCollapsed ? "display: none" : ""}>
			<textarea
				wrap="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				rows="1"
				class="nya-input"
				bind:value={cache.replace}
				on:keydown={enterOnReplacer}
				placeholder={i18n.t("search.tip.ReplacePlaceholder")}
				tabindex={replacerTabIndex}
			/>
			<div class="replacer-act">
				<div
					class="nya-btn nya-focus"
					on:click={replaceOnce}
					tabindex={commonTabIndex}
					role="button"
					on:keydown={defaultEnterEvent}
					aria-label={i18n.t("search.tip.Replace")}
				>
					<Replace size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={replaceAll}
					tabindex={commonTabIndex}
					role="button"
					on:keydown={defaultEnterEvent}
					aria-label={i18n.t("search.tip.ReplaceAll")}
				>
					<ReplaceAll xlink:title="Replace All" size={iconSize} />
				</div>
			</div>
		</div>
	</div>
</div>

<style lang="scss">
	.nya-finder {
		position: absolute;
		background-color: var(--background-primary);
		transition:
			transform 0.2s linear,
			opacity 0.2s linear,
			right 0.3s cubic-bezier(0.45, 0.05, 0.55, 0.95);
		height: 72px;
		min-width: var(--nya-default-width);
		top: 88px;
		right: 48px;
		box-shadow: 0 0 6px 1px rgba(0, 0, 0, 0.36);
		border: 1px solid var(--modal-border-color);
		z-index: 20;
		display: flex;
		flex-direction: row;
		border-radius: 4px;
		justify-content: center;
		align-items: center;
		// overflow: hidden;

		&--collapsed {
			height: 38px;
		}

		&--hidden {
			transform: translateY(-100%);
			opacity: 0;
			user-select: none;
			pointer-events: none;
		}

		&--active {
			transform: translateY(0);
		}

		// 切换按钮
		.nya-toggle {
			width: 16px;
			height: calc(100% - 4px);
			margin-right: 2px;
			margin-left: 2px;
			display: flex;
			justify-content: center;
			align-items: center;
		}
		//拖拽按钮
		.nya-dragger {
			width: 1px;
			height: 100%;
			border-left: 3px solid var(--nya-dragger-color);
			border-radius: 4px 0 0 4px;
			// cursor: ew-resize;
			&:active {
				filter: brightness(1.3);
			}
		}

		.main-part {
			padding: 4px 0px;
			flex: 1;
			flex-direction: column;
			height: 100%;
			display: flex;
			// 搜索框容器
			.finder {
				display: flex;
				margin-bottom: 6px;
			}
			// 替换框容器
			.replacer {
				display: flex;
			}
			// 搜索框的操作区
			.finder-act {
				display: flex;
				justify-content: flex-end;
				align-items: center;
				height: 28px;
				min-width: 140px;
				margin-left: 4px;
			}
			// 替换框的操作区
			.replacer-act {
				display: flex;
				justify-content: flex-end;
				align-items: center;
				height: 28px;
				min-width: 140px;
				padding-right: 184px;
				margin-left: 4px;
			}
		}
	}
	.nya-tip {
		display: flex;
		align-items: center;
		font-size: 12px;
		text-align: left;
		font-family: auto;
		min-width: 100px;
		text-wrap: nowrap;
		padding: 0 4px 0px 8px;
	}

	.nya-btn {
		width: 24px;
		height: 24px;
		margin: 2px;
		padding: 4px;
		display: flex;
		justify-content: center;
		align-items: center;
		border-radius: 2px;
		&--active {
			border: 1px solid var(--nya-focus-border-color);
			background-color: rgba(36, 137, 219, 0.51);
			color: #fff;
		}
	}
	.nya-input {
		box-shadow: none;
		flex: 1;
		min-width: 177px;
		resize: none;
		height: 28px;
		scrollbar-width: none;
		&:focus {
			border: 1px solid var(--nya-focus-border-color);
		}
	}
	.nya-focus {
		&:hover {
			background-color: rgba(90, 93, 94, 0.31);
		}
		&:focus {
			box-shadow: 0 0 0 1px var(--nya-focus-border-color);
		}
	}

	:global(.is-mobile) {
		.nya-finder.nya-mobile {
			min-width: auto;
			max-width: 416px;
			width: 100%;
			right: 50%;
			transform: translateX(50%);
			.nya-tip {
				background-color: var(--background-primary);
				top: -22px;
				position: absolute;
				right: 0px;
				padding: 2px 4px;
				text-align: center;
				border-radius: 2px;
				border: 1px solid var(--modal-border-color);
			}

			.nya-float-act {
				font-size: 12px;
				background-color: var(--background-primary);
				top: -38px;
				position: absolute;
				right: 0px;
				border-radius: 4px;
				border: 1px solid var(--modal-border-color);
				height: 36px;
				display: flex;
				flex-direction: row;
				justify-content: center;
				align-items: center;
				.nya-float-tip {
					display: flex;
					align-items: center;
					font-size: 12px;
					text-align: left;
					font-family: auto;
					min-width: 88px;
					text-wrap: nowrap;
					padding: 0 4px;
				}
			}

			.nya-input {
				min-width: 100px;
				&::-webkit-scrollbar {
					display: none;
				}
			}
			.finder-act {
				min-width: unset;
				width: 112px;
			}
			.replacer-act {
				min-width: unset;
				width: 112px;
				justify-content: flex-start;
				padding-right: unset;
			}
		}
	}
</style>
