<script lang="ts">
	import {
		X,
		ChevronDown,
		ChevronRight,
	} from "lucide-svelte";
	import type { EditorSearch } from "./editor-extension";
	import { searchCacheEffect } from "./search-highlight";
	import type { EditorContext } from "./editor-context";
	import { i18n } from "./i18n";
	import { Platform, type MarkdownView } from "obsidian";
	import { findTextOffsets, prepareReplacements } from "./util/text-helper";
	import { HistoryNavigation } from "./history";
	import { onMount } from "svelte";
	import { getLivePreviewPreference } from "./util/obsidian-internal";
	import type { TransactionSpec } from "@codemirror/state";
	import Toolbar from "./Toolbar.svelte";
	import SearchStatus from "./SearchStatus.svelte";
	import { defaultToolbar, type ToolbarAction } from "./toolbar";

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
	let statusContext = ownerView?.file;
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
	const historyNavigation = new HistoryNavigation();
	// Track usage separately from bind:value to identify consecutive query cycles.
	let lastRecordedSearch: string | null = null;
	let currentSearch = "";

	// Get sorted history based on user preference
	const getSortedHistory = () => editorSearch.plugin.history.sorted();
	onMount(() => editorSearch.plugin.history.subscribe(() => {
		if (!editorSearch.plugin.settings.enableHistory) { historyNavigation.reset(); return; }
		const text = historyNavigation.reconcile(getSortedHistory());
		if (text !== undefined) setFindText(text, false);
	}));

	// Continuous navigation counts once; explicit history reuse starts a new use.
	const recordSearchToHistory = (searchText: string, force = false) => {
		if (editorSearch.plugin.history.record(searchText, force || lastRecordedSearch !== searchText)) {
			lastRecordedSearch = searchText;
		}
	};

	$: isCollapsed = readingMode || cache.collapse;
	$: finderTabIndex = !cache.visible ? -1 : isCollapsed ? 0 : 1;
	$: commonTabIndex = !cache.visible ? -1 : isCollapsed ? 0 : 2;
	$: replacerTabIndex = !cache.visible || isCollapsed ? -1 : 1;
	const isMobile = Platform.isMobile;
	const iconSize = 18;
	let searchEl: HTMLTextAreaElement;
	let finderEl: HTMLDivElement;
	const syncFinderVisibility = () => {
		if (!finderEl) return;
		// Update synchronously: opening selects the input before Svelte's next flush.
		finderEl.style.visibility = cache.visible ? "visible" : "hidden";
		const focused = finderEl.ownerDocument.activeElement;
		if (!cache.visible && focused && finderEl.contains(focused)) (focused as HTMLElement).blur();
		finderEl.setAttribute("aria-hidden", String(!cache.visible));
	};
	function guardHiddenFocus(node: HTMLElement) {
		// Reject late focus requests as well as removing hidden controls from Tab order.
		const guard = (event: FocusEvent) => {
			if (!cache.visible) (event.target as HTMLElement).blur();
		};
		node.addEventListener("focusin", guard);
		return { destroy() { node.removeEventListener("focusin", guard); } };
	}
	const composingInputs = new WeakSet<EventTarget>();
	function trackComposition(node: HTMLTextAreaElement) {
		const start = () => composingInputs.add(node);
		const end = () => composingInputs.delete(node);
		node.addEventListener("compositionstart", start);
		node.addEventListener("compositionend", end);
		node.addEventListener("blur", end);
		return { destroy() {
			end();
			node.removeEventListener("compositionstart", start);
			node.removeEventListener("compositionend", end);
			node.removeEventListener("blur", end);
		} };
	}
	const isComposingInput = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229
		|| (event.currentTarget !== null && composingInputs.has(event.currentTarget));
	let searchToolbar = defaultToolbar("search");
	let replaceToolbar = defaultToolbar("replace");
	let historyEnabled = true;
	$: if (editorSearch) refreshToolbar();
	let replaceOffset: number | undefined;
	let searchActionsWidth: number | undefined;
	$: customToolbar = searchToolbar.some((item, index) => item.id !== defaultToolbar("search")[index]?.id
		|| item.placement !== defaultToolbar("search")[index]?.placement)
		|| replaceToolbar.some((item, index) => item.id !== defaultToolbar("replace")[index]?.id
			|| item.placement !== defaultToolbar("replace")[index]?.placement);
	$: if (readingMode || isCollapsed || customToolbar) { replaceOffset = undefined; searchActionsWidth = undefined; }

	export function refreshToolbar() {
		searchToolbar = editorSearch.plugin.settings.searchToolbar ?? defaultToolbar("search");
		replaceToolbar = editorSearch.plugin.settings.replaceToolbar ?? defaultToolbar("replace");
		historyEnabled = editorSearch.plugin.settings.enableHistory;
	}

	// Derive the spacer from the current controls, never from the row/input widths:
	// the spacer itself contributes to those widths and would keep an old wide count alive.
	// Custom toolbars use CSS grid; mobile and reading layouts need no spacer.
	function alignRows(node: HTMLElement, _layout: unknown) {
		const win = node.ownerDocument.defaultView;
		const count = node.querySelector<HTMLElement>(".nya-tip");
		const searchActions = node.querySelector<HTMLElement>(".finder-act");
		const replaceActions = node.querySelector<HTMLElement>(".replacer-act");
		const replaceToolbar = replaceActions?.querySelector<HTMLElement>(".nya-toolbar");
		const outerWidth = (element: HTMLElement) => {
			const style = win!.getComputedStyle(element);
			return element.getBoundingClientRect().width
				+ (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
		};
		const measure = () => {
			if (isMobile || readingMode || isCollapsed || customToolbar || !win || !count || !searchActions || !replaceActions || !replaceToolbar) return;
			const width = searchActions.getBoundingClientRect().width;
			if (!width || !count.getBoundingClientRect().width || !replaceToolbar.getBoundingClientRect().width) return;
			const replaceStyle = win.getComputedStyle(replaceActions);
			const replaceMargins = (parseFloat(replaceStyle.marginLeft) || 0) + (parseFloat(replaceStyle.marginRight) || 0);
			const offset = Math.max(0, Math.round((outerWidth(count) + outerWidth(searchActions)
				- outerWidth(replaceToolbar) - replaceMargins) * 100) / 100);
			if (offset !== replaceOffset) replaceOffset = offset;
			if (width !== searchActionsWidth) searchActionsWidth = width;
		};
		const observer = !isMobile && win && "ResizeObserver" in win ? new win.ResizeObserver(measure) : undefined;
		for (const element of [count, searchActions, replaceToolbar]) {
			if (element) observer?.observe(element, { box: "border-box" });
		}
		win?.addEventListener("resize", measure);
		measure();
		return { update: measure, destroy() { observer?.disconnect(); win?.removeEventListener("resize", measure); } };
	}

	const runToolbarAction = (action: ToolbarAction) => {
		if (action === "regex") toggleRegexMode();
		else if (action === "case") toggleMatchCaseMode();
		else if (action === "previous") toPreviousMatch();
		else if (action === "next") toNextMatch();
		else if (action === "history") editorSearch.openHistory();
		else if (action === "replace") replaceOnce();
		else if (action === "replaceAll") replaceAll();
	};

	export function getSearchCache() {
		return cache;
	}

	export function setVisible(
		flag: boolean,
		searchText?: string,
		historyIndexOverride?: number,
	) {
		cache.visible = flag;
		syncFinderVisibility();
		const settings = editorSearch.plugin.settings;
		if (cache.visible) {
			setFindText(searchText !== undefined ? searchText : cache.search);
			searchEl.focus();
			searchEl.select();
			if (historyIndexOverride !== undefined) historyNavigation.select(cache.search, getSortedHistory());
			else historyNavigation.reset();
		} else {
			readingRequest++;
			readingPending = false;
			readingUnsupported = false;
			readingError = undefined;
			editorSearch.clearReadingSearch?.(ownerView);
			cache.collapse = true;
			historyNavigation.reset();
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
		historyNavigation.select(searchText, getSortedHistory());
		return true;
	}

	export function setCollapse(flag: boolean) {
		cache.collapse = isReading() ? true : flag;
	}

	export function resetAll() {
		historyNavigation.reset();
		readingRequest++;
		readingPending = false;
		readingUnsupported = false;
		readingError = undefined;
		editorSearch.clearReadingSearch?.(ownerView);
		currentSearch = "";
		lastRecordedSearch = null;
		cache.search = "";
		cache.replace = "";
		cache.index = 0;
		cache.matches = [];
		cache.visible = false;
		syncFinderVisibility();
		cache.collapse = true;
		cache.options = {
			regexMode: false,
			caseSensitive: false,
		};
		emitChange();
	}

	export function toggleVisible() {
		if (cache.visible) closeFinder();
		else setVisible(true);
	}

	export function toggleCollapse() {
		setCollapse(!cache.collapse);
	}

	export function isVisible() {
		return cache.visible;
	}

	const onSearchChanged = (e: Event) => {
		historyNavigation.reset();
		const target = e.target as HTMLTextAreaElement;
		setFindText(target.value);
	};

	const replaceAll = () => {
		replaceAllMatchedText(cache.replace);
	};

	// All user-facing single-replace entry points share the same navigation policy.
	export const replaceOnce = () => {
		const before = getEditorContext();
		const result = replaceMatchedText(cache.replace);
		const current = getEditorContext();
		if (result.changed && !result.navigationFailed && result.beforeCount === result.afterCount && before && current
			&& current.file === before.file && current.editor === before.editor
			&& current.editorView === before.editorView && isCurrentContext(current)
			&& matchedContext?.doc === current.doc && matchedQuery === queryKey()) {
			toNextMatch();
		}
		return result;
	};

	export const closeFinder = () => {
		if (!cache.visible) return;
		try {
			const activeEditor = getEditorContext();
			if (activeEditor) {
				const state = activeEditor.view.getState();
				const { sourceModeWhenSearch } = editorSearch.plugin.settings;
				if (state.mode === "source" && sourceModeWhenSearch) {
					const needPreview = isNeedPreviewMode();
					if (needPreview !== undefined) {
						state.source = !needPreview;
						void Promise.resolve(activeEditor.view.setState(state, { history: false }))
							.catch((error) => editorSearch.plugin.reportError("search.EditorFailed", error));
					}
				}
			}
		} catch (error) { editorSearch.plugin.reportError("search.EditorFailed", error); }
		finally { setVisible(false); }
	};
	export const toggleRegexMode = () => {
		cache.options.regexMode = !cache.options.regexMode;
		searchEl.focus();
		setFindText(cache.search);
	};

	export const toggleMatchCaseMode = () => {
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
		statusContext = ownerView.file;
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

	export const scrollToMatch = (activeEditor = getEditorContext(), afterReplacement = false) => {
		if (isReading()) { setFindText(cache.search, true); return; }
		try {
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
				const requestQuery = queryKey();
				const requestFile = ownerView.file;
				const reportPositionError = (error: unknown) => editorSearch.plugin.reportError(
					afterReplacement ? "search.ReplacedNavigationFailed" : "search.EditorFailed", error);
				let changed: Promise<void>;
				try { changed = view.setState(state, { history: false }); }
				catch (error) { reportPositionError(error); return false; }
				void Promise.resolve(changed).then(() => {
					// Mode changes can rebuild the editor asynchronously. Never submit
					// old offsets to a new editor or overwrite a newer query/close.
					if (cache.visible && ownerView.file === requestFile && queryKey() === requestQuery
						&& getEditorContext() && !isCurrentContext(activeEditor)) matchAgain(false);
				}).catch(reportPositionError);
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
		return true;
		} catch (error) {
			editorSearch.plugin.reportError(afterReplacement ? "search.ReplacedNavigationFailed" : "search.EditorFailed", error);
			return false;
		}
	};

	export const resetMatches = (clearSearch = false, clearReplace = false) => {
		readingRequest++;
		readingPending = false;
		readingUnsupported = false;
		readingError = undefined;
		editorSearch.clearReadingSearch?.(ownerView);
		cache.matches = [];
		cache.index = 0;
		if (clearSearch) {
			historyNavigation.reset();
			cache.search = "";
			currentSearch = "";
			lastRecordedSearch = null;
		}
		if (clearReplace) cache.replace = "";
		emitChange();
	};

	const adjustReplaceText = (text: string) => {
		if (editorSearch.plugin.settings.useEscapeCharInReplace) {
			// Decode once without reserving any character from the user's text.
			return text.replace(/\\([\\nt])/g, (_, escaped: string) =>
				escaped === "n" ? "\n" : escaped === "t" ? "\t" : "\\");
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
		const replacements = prepareReplacements(
			activeEditor.editor.getValue(),
			cache.search,
			cache.options.regexMode ? adjustReplaceText(inputText) : inputText,
			cache.options.regexMode,
			cache.options.caseSensitive,
		);
		cache.matches = replacements.matches;
		rememberMatches(activeEditor);
		if (cache.matches.length === 0) {
			emitChange(true, undefined, activeEditor);
		}
		return { activeEditor, replacements };
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
			const selected = all ? undefined : prepared.replacements.one(index);
			const changes = all ? prepared.replacements.all() : selected ? [selected] : [];
			if (!changes.length) return result;
			prepared.activeEditor.editorView.dispatch({ changes });
			result.changed = true;
			result.changeCount = changes.length;
			try {
				const current = getEditorContext();
				if (current && current.file === prepared.activeEditor.file
					&& current.editorView === prepared.activeEditor.editorView) {
					setFindText(search, false, current);
					if (!scrollToMatch(current, true)) result.navigationFailed = true;
				} else {
					cache.matches = [];
					cache.index = 0;
					matchedContext = null;
				}
			} catch (error) {
				result.navigationFailed = true;
				// The write succeeded. A positioning failure must not invite retrying it.
				editorSearch.plugin.reportError("search.ReplacedNavigationFailed", error);
			}
			result.afterCount = cache.matches.length;
		}
		return result;
	};

	export const replaceMatchedText = (inputText: string): ReplaceResult =>
		replaceText(inputText, false);

	export const replaceAllMatchedText = (inputText: string): ReplaceResult =>
		replaceText(inputText, true);
	const onFinderKeyDown = (e: KeyboardEvent) => {
		if (isComposingInput(e)) return;
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
				const text = historyNavigation.move(1, cache.search, sortedHistory);
				if (text !== undefined) {
					e.preventDefault();
					setFindText(text);
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
				const text = historyNavigation.move(-1, cache.search, sortedHistory);
				if (text !== undefined) {
					e.preventDefault();
					setFindText(text);
				}
			}
			return;
		}

		const isEnterPress = ["Enter", "NumpadEnter"].includes(e.code);
		if (enableInputHotkeys && isEnterPress) {
			// 这里本来打算监听enter shift+enter ctrl+enter 但是加上修饰键 会和默认的快捷键有冲突.所以除了enter都用命令的快捷键算了
			if (!e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
				e.preventDefault();

				historyNavigation.reset();
				toNextMatch();
			}
		}
	};
	const enterOnReplacer = (e: KeyboardEvent) => {
		if (isComposingInput(e)) return;
		const enableInputHotkeys =
			editorSearch.plugin.settings.enableInputHotkeys;
		const isEnterPress = ["Enter", "NumpadEnter"].includes(e.code);
		if (enableInputHotkeys && isEnterPress) {
			if (!e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
				e.preventDefault();
				replaceOnce();
			}
		}
	};

	const isNeedPreviewMode = (): boolean | undefined => {
		return getLivePreviewPreference(editorSearch.plugin.app.vault);
	};

	const defaultEnterEvent = (e: KeyboardEvent) => {
		const isEnterPress = ["Enter", "NumpadEnter", "Space"].includes(e.code);
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
	bind:this={finderEl}
	use:guardHiddenFocus
	style:visibility={cache.visible ? "visible" : "hidden"}
	aria-hidden={!cache.visible}
	data-cid={cid}
	class={`nya-finder ${cache.visible ? "nya-finder--active" : "nya-finder--hidden"}`}
	class:nya-finder--collapsed={isCollapsed}
	class:nya-finder--reading={readingMode}
	class:nya-mobile={isMobile}
	class:nya-finder--custom-toolbar={customToolbar}
	use:alignRows={[isCollapsed, customToolbar, searchToolbar, replaceToolbar]}
>
	<SearchStatus visible={cache.visible && readingMode} pending={readingPending} unsupported={readingUnsupported}
		error={readingError} query={cache.search} context={statusContext} retry={() => setFindText(cache.search)}
		nativeFind={() => editorSearch.openNativeSearch(ownerView)} />
	<!-- TODO: 允许通过拖动该控件改变输入框宽度，临时生效。 -->
	<div class="nya-dragger"></div>
	{#if !readingMode}
	<div
		class={`nya-toggle nya-focus`}
		on:click={toggleCollapse}
		role="button"
		tabindex={cache.visible ? 0 : -1}
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
				use:trackComposition
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
			{#if isMobile}
				<div class="nya-float-act">
					<div class="nya-float-tip">
						{#if readingPending || readingUnsupported || readingError}
							<div aria-label={i18n.t(readingPending ? "search.ReadingPending" : "search.StatusError")} title={i18n.t(readingPending ? "search.ReadingPendingDetail" : "search.StatusError")} aria-busy={readingPending}>{readingPending ? "…" : "!"}</div>
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
						<div aria-label={i18n.t(readingPending ? "search.ReadingPending" : "search.StatusError")} title={i18n.t(readingPending ? "search.ReadingPendingDetail" : "search.StatusError")} aria-busy={readingPending}>{readingPending ? "…" : "!"}</div>
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
				<Toolbar items={searchToolbar} run={runToolbarAction} regexMode={cache.options.regexMode}
					caseSensitive={cache.options.caseSensitive} {historyEnabled} tabindex={commonTabIndex} visible={cache.visible} />
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
				use:trackComposition
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
			<div class="replacer-act"
				style:padding-right={replaceOffset === undefined ? undefined : `${replaceOffset}px`}
				style:--nya-search-actions-width={searchActionsWidth === undefined ? undefined : `${searchActionsWidth}px`}>
				<Toolbar items={replaceToolbar} run={runToolbarAction} tabindex={commonTabIndex} visible={cache.visible && !isCollapsed} />
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
				// Legacy fallback: counter gutter + search actions, minus replacement actions.
				padding-right: calc(108px + var(--nya-search-actions-width, 140px) - 64px);
				margin-left: 4px;
			}
		}

		&.nya-finder--reading .main-part {
			padding-left: 8px;
		}

		&.nya-finder--custom-toolbar .main-part {
			display: grid;
			grid-template-columns: minmax(177px, 1fr) auto auto;
			grid-template-rows: 28px 28px;
			row-gap: 6px;
			.finder, .replacer { display: contents; }
			.finder .nya-input { grid-column: 1; grid-row: 1; }
			.finder .nya-tip { grid-column: 2; grid-row: 1; }
			.finder-act { grid-column: 3; grid-row: 1; min-width: 0; }
			.replacer .nya-input { grid-column: 1; grid-row: 2; }
			.replacer-act { grid-column: 2 / 4; grid-row: 2; padding-right: 0; min-width: 0; justify-content: flex-start; }
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
			&.nya-finder--custom-toolbar .main-part {
				grid-template-columns: minmax(100px, 1fr) auto;
				.finder-act { grid-column: 2; width: auto; }
				.replacer-act { grid-column: 2; width: auto; }
			}
		}
	}
</style>
