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
	import type { EditorSearch } from "./editor-extension";
	import { searchCacheEffect } from "./search-highlight";
	import type { EditorContext } from "./editor-context";
	import { i18n } from "./i18n";
	import { Platform, type MarkdownView } from "obsidian";
	import { findTextOffsets, findReplacementChanges } from "./util/text-helper";
	import { getLivePreviewPreference } from "./util/obsidian-internal";
	import type { TransactionSpec } from "@codemirror/state";

	export let editorSearch: EditorSearch;
	export let cid: string;
	export let ownerView: MarkdownView;
	let matchedContext: EditorContext | null = null;
	let matchedQuery = "";
	let readingMode = false;
	let readingPending = false;
	let readingUnsupported = false;
	let readingError: "failed" | "timeout" | undefined;
	let readingRequest = 0;
	let searchMode = "source";
	const isReading = () => ownerView.getMode?.() === "preview";

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
	let historyIndex = -1;
	// Temporary storage for the current input when navigating history
	let tempInput = "";
	// Track usage separately from bind:value to identify consecutive query cycles.
	let lastRecordedSearch: string | null = null;
	let currentSearch = "";

	// Get sorted history based on user preference
	const getSortedHistory = () => editorSearch.plugin.history.sorted();

	// Continuous navigation counts once; explicit history reuse starts a new use.
	const recordSearchToHistory = (searchText: string, force = false) => {
		if (editorSearch.plugin.history.record(searchText, force || lastRecordedSearch !== searchText)) {
			lastRecordedSearch = searchText;
		}
	};

	$: isCollapsed = readingMode || cache.collapse;
	$: finderTabIndex = isCollapsed ? 0 : 1;
	$: commonTabIndex = isCollapsed ? 0 : 2;
	$: replacerTabIndex = isCollapsed ? -1 : 1;
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
			setFindText(searchText !== undefined ? searchText : cache.search);
			searchEl.select();
			// Set history index (either provided or reset to -1)
			historyIndex =
				historyIndexOverride !== undefined ? historyIndexOverride : -1;
			tempInput = "";
		} else {
			readingRequest++;
			readingPending = false;
			editorSearch.clearReadingSearch?.(ownerView);
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
		if (isReading() ? !editorSearch.canSearchReading(ownerView) : !getEditorContext()) return false;
		const sortedHistory = getSortedHistory();
		const index = sortedHistory.findIndex(
			(item) => item.text === searchText,
		);
		// Set visible with the history index
		setVisible(true, searchText, index);
		recordSearchToHistory(searchText, true);
		// Usage can reorder the list; preserve the selected entry's new position.
		historyIndex = getSortedHistory().findIndex((item) => item.text === searchText);
		return true;
	}

	export function setCollapse(flag: boolean) {
		cache.collapse = isReading() ? true : flag;
	}

	export function resetAll() {
		readingRequest++;
		editorSearch.clearReadingSearch?.(ownerView);
		currentSearch = "";
		lastRecordedSearch = null;
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
		const activeEditor = getEditorContext();
		if (activeEditor) {
			const state = activeEditor.view.getState();
			const { sourceModeWhenSearch } = editorSearch.plugin.settings;
			if (state.mode === "source" && sourceModeWhenSearch) {
				const needPreview = isNeedPreviewMode();
				if (needPreview !== undefined) {
					state.source = !needPreview;
					activeEditor.view.setState(state, { history: false });
				}
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

	const queryKey = () => JSON.stringify([cache.search, cache.options.regexMode, cache.options.caseSensitive]);

	export const getEditorContext = () => {
		const context = editorSearch.getEditorContext(ownerView);
		if (!context && !isReading()) {
			cache.matches = [];
			cache.index = 0;
			matchedContext = null;
		}
		return context;
	};

	const isCurrentContext = (context: EditorContext) => {
		const current = getEditorContext();
		return current !== null && current.view === context.view && current.editorView === context.editorView
			&& current.editor === context.editor && current.file === context.file
			&& current.doc === context.doc;
	};

	const rememberMatches = (context: EditorContext) => {
		if (matchedContext && (matchedContext.file !== context.file
			|| matchedContext.editorView !== context.editorView)) cache.index = 0;
		matchedContext = context;
		matchedQuery = queryKey();
		if (cache.index < 0 || cache.index >= cache.matches.length) cache.index = 0;
	};

	export const emitChange = (
		withCache: boolean = true,
		extraSpec?: TransactionSpec,
		context: EditorContext | null = getEditorContext(),
	) => {
		if (context && isCurrentContext(context)) {
			const { editorView } = context;
			const validMatches = matchedContext?.doc === context.doc
				&& matchedContext.file === context.file && matchedContext.editorView === context.editorView
				&& matchedQuery === queryKey();
			let spec: TransactionSpec = {
				effects: withCache ? [searchCacheEffect.of({
					doc: context.doc,
					visible: cache.visible,
					index: cache.index,
					matches: validMatches ? cache.matches.map((match) => ({ ...match })) : [],
				})] : [],
			};
			if (extraSpec) {
				spec = Object.assign(spec, extraSpec);
			}
			editorView.dispatch(spec);
		}
	};

	export const setFindText = (text: string, scroll: boolean = true, activeEditor = getEditorContext(), direction = 0) => {
		// Svelte's bind:value may update cache.search before the input handler.
		if (currentSearch !== text) lastRecordedSearch = null;
		currentSearch = text;
		cache.search = text;
		readingMode = isReading();
		const mode = readingMode ? "preview" : "source";
		if (searchMode !== mode) { cache.matches = []; cache.index = 0; matchedContext = null; searchMode = mode; }
		readingUnsupported = false;
		readingError = undefined;
		if (readingMode) {
			if (!cache.visible) {
				readingRequest++;
				editorSearch.clearReadingSearch?.(ownerView);
				cache.matches = [];
				cache.index = 0;
				readingPending = false;
				return;
			}
			const request = ++readingRequest;
			editorSearch.getReadingSearch(ownerView).search(text, cache.options, cache.index, scroll, (result) => {
				if (request !== readingRequest || !cache.visible || !isReading()) return;
				cache.matches = result.matches;
				cache.index = result.index;
				readingPending = result.pending;
				readingUnsupported = result.unsupported;
				readingError = result.error;
			}, direction);
			return;
		}
		readingRequest++;
		readingPending = false;
		editorSearch.clearReadingSearch?.(ownerView);
		if (activeEditor && isCurrentContext(activeEditor)) {
			const { editor } = activeEditor;

			if (text) {
				const content = editor.getValue();
				cache.matches = findTextOffsets(
					content,
					text,
					cache.options.regexMode,
					cache.options.caseSensitive,
				);
				rememberMatches(activeEditor);
				if (cache.matches.length > 0) {
					if (scroll) {
						scrollToMatch(activeEditor);
					} else {
						emitChange(true, undefined, activeEditor);
					}
				} else {
					resetMatches();
				}
			} else {
				resetMatches(true);
			}
		} else {
			cache.matches = [];
			cache.index = 0;
			matchedContext = null;
		}
	};

	const navigateMatch = (direction: number) => {
		if (isReading()) {
			setFindText(cache.search, true, null, direction);
			if (cache.visible && !readingUnsupported && !readingError && cache.search) recordSearchToHistory(cache.search);
			return;
		}
		const context = getEditorContext();
		if (!context) return;
		if (matchedContext?.doc !== context.doc || matchedContext.file !== context.file
			|| matchedContext.editorView !== context.editorView || matchedQuery !== queryKey()) {
			setFindText(cache.search, false, context);
		}
		if (cache.index < 0 || cache.index >= cache.matches.length) cache.index = 0;
		const matchSize = cache.matches.length;
		cache.index = matchSize === 0 ? 0 : (cache.index + direction + matchSize) % matchSize;
		scrollToMatch(context);
		// Saving is not part of editor navigation and must not delay it.
		if (cache.search) {
			recordSearchToHistory(cache.search);
		}
	};
	export const toNextMatch = () => navigateMatch(1);
	export const toPreviousMatch = () => navigateMatch(-1);

	export const scrollToMatch = (activeEditor = getEditorContext()) => {
		if (isReading()) { setFindText(cache.search, true); return; }
		if (activeEditor && isCurrentContext(activeEditor)) {
			if (matchedContext?.doc !== activeEditor.doc || matchedQuery !== queryKey()
				|| matchedContext.file !== activeEditor.file || matchedContext.editorView !== activeEditor.editorView) {
				setFindText(cache.search, false, activeEditor);
			}
			const { editor } = activeEditor;

			const { matches, index } = cache;
			if (matches.length > 0 && index >= 0 && index < matches.length) {
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
				if (!isCurrentContext(activeEditor)) {
					matchAgain(false);
					return;
				}
				emitChange(true, {
					selection: moveCursorToMatch
						? { anchor: from, head: to }
						: undefined,
				}, activeEditor);
			}
		}
	};

	export const resetMatches = (clearSearch = false, clearReplace = false) => {
		readingRequest++;
		editorSearch.clearReadingSearch?.(ownerView);
		cache.matches = [];
		cache.index = 0;
		if (clearSearch) {
			cache.search = "";
			currentSearch = "";
			lastRecordedSearch = null;
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

	const prepareReplacement = (inputText: string) => {
		if (isReading()) return null;
		const activeEditor = getEditorContext();
		if (!activeEditor) {
			cache.matches = [];
			cache.index = 0;
			return null;
		}

		// Hidden finders do not track editor changes. Never use cached offsets
		// for a write: recalculate against the editor captured for this action.
		const changes = findReplacementChanges(
			activeEditor.editor.getValue(),
			cache.search,
			cache.options.regexMode ? adjustReplaceText(inputText) : inputText,
			cache.options.regexMode,
			cache.options.caseSensitive,
		);
		cache.matches = changes.map(({ from, to }, index) => ({ from, to, index }));
		rememberMatches(activeEditor);
		if (cache.matches.length === 0) {
			emitChange(true, undefined, activeEditor);
		}
		return { activeEditor, changes };
	};

	const replaceText = (inputText: string, all: boolean): ReplaceResult => {
		const prepared = prepareReplacement(inputText);
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

		if (prepared && matchSize > 0 && isCurrentContext(prepared.activeEditor)) {
			const changes = all ? prepared.changes : [prepared.changes[index]];
			prepared.activeEditor.editorView.dispatch({ changes });
			const current = getEditorContext();
			if (current && current.file === prepared.activeEditor.file
				&& current.editorView === prepared.activeEditor.editorView) setFindText(search, true, current);
			else {
				cache.matches = [];
				cache.index = 0;
				matchedContext = null;
			}
			result.changed = true;
			result.changeCount = changes.length;
			result.afterCount = cache.matches.length;
		}
		return result;
	};

	export const replaceMatchedText = (inputText: string): ReplaceResult =>
		replaceText(inputText, false);

	export const replaceAllMatchedText = (inputText: string): ReplaceResult =>
		replaceText(inputText, true);
	const onFinderKeyDown = (e: KeyboardEvent) => {
		const { enableInputHotkeys, enableHistory } =
			editorSearch.plugin.settings;
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
					if (cache.search !== "") {
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

				historyIndex = -1;
				tempInput = "";
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

	const isNeedPreviewMode = (): boolean | undefined => {
		return getLivePreviewPreference(editorSearch.plugin.app.vault);
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
		if (cache.visible) {
			setFindText(search, scroll);
		} else {
			readingRequest++;
			readingMode = isReading();
			readingPending = false;
			editorSearch.clearReadingSearch?.(ownerView);
			cache.matches = [];
			cache.index = 0;
			matchedContext = null;
		}
	};
</script>

<div
	data-cid={cid}
	class={`nya-finder ${cache.visible ? "nya-finder--active" : "nya-finder--hidden"}`}
	class:nya-finder--collapsed={isCollapsed}
	class:nya-finder--reading={readingMode}
	class:nya-mobile={isMobile}
>
	<!-- TODO: 允许通过拖动该控件改变输入框宽度，临时生效。 -->
	<div class="nya-dragger"></div>
	{#if !readingMode}
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
	{/if}
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
						{#if readingPending || readingUnsupported || readingError}
							<div>{i18n.t(readingError ? (readingError === "timeout" ? "search.ReadingTimeout" : "search.ReadingFailed") : readingPending ? "search.ReadingPending" : "search.ReadingUnsupported")}</div>
							{#if readingError || readingUnsupported}
								<button on:click={() => editorSearch.openNativeSearch(ownerView)}>{i18n.t("search.UseNativeFind")}</button>
							{/if}
						{:else if cache.matches.length > 0}
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
					{#if readingPending || readingUnsupported || readingError}
						<div>{i18n.t(readingError ? (readingError === "timeout" ? "search.ReadingTimeout" : "search.ReadingFailed") : readingPending ? "search.ReadingPending" : "search.ReadingUnsupported")}</div>
						{#if readingError || readingUnsupported}
							<button on:click={() => editorSearch.openNativeSearch(ownerView)}>{i18n.t("search.UseNativeFind")}</button>
						{/if}
					{:else if cache.matches.length > 0}
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

		&.nya-finder--reading .main-part {
			padding-left: 8px;
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
