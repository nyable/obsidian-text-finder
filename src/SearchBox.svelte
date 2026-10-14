<script lang="ts">
	import {
		X,
		ChevronDown,
		ChevronRight,
		Search,
	} from "lucide-svelte";
	import type { EditorSearch } from "./editor-extension";
	import { searchCacheEffect, finderSelection, searchScopeField, searchScopeEffect } from "./search-highlight";
	import type { EditorContext } from "./editor-context";
	import { i18n } from "./i18n";
	import { Platform, Menu, type MarkdownView } from "obsidian";
	import { findTextOffsets, prepareReplacements, normalizeSearchRanges } from "./util/text-helper";
	import { HistoryNavigation } from "./history";
	import { onMount, tick } from "svelte";
	import { createFinderPosition, type FinderPlacement } from "./finder-position";
	import { getLivePreviewPreference } from "./util/obsidian-internal";
	import type { TransactionSpec } from "@codemirror/state";
	import type { MatchExecutor, MatchResult } from "./match-protocol";
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
	let workerError = false;
	let editingEngine: MatchExecutor | null = null;
	let editingComputation: { context: EditorContext; key: string; window: Window | null; scroll: boolean; direction: number } | null = null;
	interface ReplacementTask {
		context: EditorContext;
		key: string;
		window: Window | null;
		path: string | undefined;
		replace: string;
		escape: boolean;
		phase: "prepare" | "committed";
		committing: boolean;
		scopeEpoch: number;
		searchKey: string;
	}
	let replacementTask: ReplacementTask | null = null;
	let replacementRetry: ((synchronous: boolean) => void) | null = null;
	let replacementCommittedError = false;
	const cancelEditing = (preserveIdle = false) => {
		const busy = !!editingComputation || !!replacementTask;
		editingComputation = null;
		replacementTask = null;
		replacementRetry = null;
		if (!preserveIdle || busy) editingEngine?.cancel();
	};
	let positionRequest = 0;
	let disposed = false;
	let docked = false;
	// An automatically shown entry is not an active search session yet.
	let passiveEntry = false;
	let panelIntent = 0;
	let dockSide: "left" | "right" = editorSearch?.plugin.settings.finderDockSide ?? "right";
	let placement: ReturnType<typeof createFinderPosition> | undefined;
	let refreshPlacement: ((state: FinderPlacement) => void) | undefined;
	let mobileInlineTarget: HTMLDivElement;
	let autoDock = editorSearch?.plugin.settings.finderAutoDock ?? false;
	let edgeMenu: Menu | undefined;
	let searchMode = "source";
	let statusContext = ownerView?.file;
	const isReading = () => ownerView.getMode?.() === "preview";
	let scopeEnabled = false;
	let scopeBlocked = false;
	let scopeEmpty = false;
	let scopeEpoch = 0;
	let scopeContext: EditorContext | null = null;
	let scopeWindow: Window | null = null;
	const scopeState = (context: EditorContext | null) => context && searchScopeField
		? context.editorView.state.field(searchScopeField, false) : undefined;
	const clearScope = (block = false) => {
		const previous = scopeContext;
		scopeContext = null; scopeEnabled = false; scopeBlocked = block; scopeEmpty = false; scopeEpoch++;
		if (previous && scopeState(previous)?.ranges != null) {
			try { previous.editorView.dispatch({ effects: searchScopeEffect.of(null) }); }
			catch (error) { console.warn("Text Finder: could not clear detached search scope", error); }
		}
	};
	const syncScope = (context: EditorContext | null) => {
		if (scopeEnabled && (isReading() || !context || context.file !== scopeContext?.file || context.editor !== scopeContext.editor
			|| context.editorView !== scopeContext.editorView || scopeState(context)?.ranges == null
			|| scopeWindow !== (ownerView.containerEl?.ownerDocument.defaultView ?? null))) clearScope(true);
		scopeEmpty = scopeEnabled && !scopeRanges()?.length;
	};
	const scopeRanges = (): readonly SearchRange[] | undefined => {
		if (scopeBlocked) return [];
		return scopeEnabled ? normalizeSearchRanges(scopeState(scopeContext)?.ranges ?? [], scopeContext!.editorView.state.doc.length) : undefined;
	};
	const activateScope = () => {
		if (disposed || isReading()) return false;
		const context = getEditorContext();
		const state = scopeState(context);
		const ranges = context ? normalizeSearchRanges(state?.candidate ?? [], context.doc.length) : [];
		if (!context || !state || !ranges.length) {
			editorSearch.plugin.reportError("search.SelectionRequired", new Error("No valid editor selection"));
			return false;
		}
		cancelEditing(); positionRequest++;
		clearScope(); scopeContext = context; scopeEnabled = true;
		scopeWindow = ownerView.containerEl?.ownerDocument.defaultView ?? null;
		context.editorView.dispatch({ effects: searchScopeEffect.of(ranges) });
		scopeEmpty = false;
		cache.index = 0;
		return true;
	};
	export function findInSelection() {
		if (!activateScope()) return false;
		setVisible(true);
		return true;
	}
	export function toggleFindInSelection() {
		if (scopeEnabled || scopeBlocked) { clearScope(); setFindText(cache.search); }
		else if (activateScope()) setFindText(cache.search);
	}
	export function hasSelectionScope() { return scopeEnabled || scopeBlocked; }

	const cache: SearchCache = {
		search: "",
		replace: "",
		index: 0,
		matches: [],
		visible: false,
		collapse: true,
		options: {
			regexMode: editorSearch?.plugin.settings.defaultRegexMode ?? false,
			caseSensitive: editorSearch?.plugin.settings.defaultCaseSensitive ?? false,
			wholeWord: editorSearch?.plugin.settings.defaultWholeWord ?? false,
		},
	};

	// Search History
	const historyNavigation = new HistoryNavigation();
	// Track usage separately from bind:value to identify consecutive query cycles.
	let lastRecordedSearch: string | null = null;
	let currentSearch = "";

	// Get sorted history based on user preference
	const getSortedHistory = () => editorSearch.plugin.history.sorted();
	onMount(() => {
		const unsubscribe = editorSearch.plugin.history.subscribe(() => {
			if (!editorSearch.plugin.settings.enableHistory) { historyNavigation.reset(); return; }
			const text = historyNavigation.reconcile(getSortedHistory());
			if (text !== undefined) setFindText(text, false);
		});
		return () => { disposed = true; edgeMenu?.hide(); positionRequest++; cancelEditing(); clearScope(); unsubscribe(); };
	});

	// Continuous navigation counts once; explicit history reuse starts a new use.
	const recordSearchToHistory = (searchText: string, force = false) => {
		if (editorSearch.plugin.history.record(searchText, force || lastRecordedSearch !== searchText)) {
			lastRecordedSearch = searchText;
		}
	};

	$: isCollapsed = readingMode || cache.collapse;
	$: expanded = cache.visible && !docked;
	$: finderTabIndex = !expanded ? -1 : isCollapsed ? 0 : 1;
	$: commonTabIndex = !expanded ? -1 : isCollapsed ? 0 : 2;
	$: replacerTabIndex = !expanded || isCollapsed ? -1 : 1;
	const isMobile = Platform.isMobile;
	const iconSize = 18;
	let searchEl: HTMLTextAreaElement;
	let replaceEl: HTMLTextAreaElement;
	let finderEl: HTMLDivElement;
	const syncFinderVisibility = () => {
		if (!finderEl) return;
		// Clear hidden/inert state synchronously; compact expansion focuses only
		// after Svelte has rendered the expanded controls and corrected placement.
		finderEl.style.visibility = cache.visible ? "visible" : "hidden";
		const focused = finderEl.ownerDocument.activeElement;
		if (!cache.visible && focused && finderEl.contains(focused)) (focused as HTMLElement).blur();
		finderEl.setAttribute("aria-hidden", String(!cache.visible));
		finderEl.classList.toggle("nya-finder--docked", docked);
		finderEl.querySelectorAll<HTMLElement>(".main-part, .nya-toggle, .nya-dragger, .nya-float-act").forEach((child) => {
			child.toggleAttribute("inert", !cache.visible || docked);
			child.setAttribute("aria-hidden", String(!cache.visible || docked));
			if (docked) child.style.setProperty("display", "none", "important");
			else child.style.removeProperty("display");
		});
		refreshPlacement?.(placementState());
	};
	const placementState = (): FinderPlacement => ({ visible: cache.visible, docked, side: dockSide,
		toolsHeight: isMobile ? (finderEl?.querySelector<HTMLElement>(".nya-float-act")?.offsetHeight || 40) : 0, autoDock });
	function guardHiddenFocus(node: HTMLElement) {
		// Reject late focus requests as well as removing hidden controls from Tab order.
		const guard = (event: FocusEvent) => {
			if (!cache.visible || (docked && !(event.target as HTMLElement).closest(".nya-dock-tab"))) (event.target as HTMLElement).blur();
		};
		node.addEventListener("focusin", guard);
		return { destroy() { node.removeEventListener("focusin", guard); } };
	}
	function positionFinder(node: HTMLElement, state: FinderPlacement) {
		let doc = node.ownerDocument;
		const create = () => createFinderPosition(node, ownerView.containerEl, (side) => dockFinder(side), () => !replacementTask);
		placement = create();
		const update = (next: FinderPlacement) => {
			if (node.ownerDocument !== doc) {
				placement?.destroy(); doc = node.ownerDocument;
				placement = create();
			}
			placement?.update(next);
		};
		refreshPlacement = update; update(state);
		return { update, destroy() { placement?.destroy(); placement = undefined; refreshPlacement = undefined; } };
	}
	export function dockFinder(side: "left" | "right" = dockSide) {
		if (!cache.visible || replacementTask || disposed) return false;
		// Avoid queued navigation selecting/scrolling text after the user asks to
		// read it unobstructed; matching itself continues and keeps highlights.
		positionRequest++;
		if (editingComputation) { editingComputation.scroll = false; editingComputation.direction = 0; }
		if (isReading()) editorSearch.getReadingSearch(ownerView).pauseNavigation();
		docked = true;
		dockSide = side;
		const intent = ++panelIntent;
		const focused = finderEl.ownerDocument.activeElement;
		if (focused && finderEl.contains(focused)) (focused as HTMLElement).blur();
		syncFinderVisibility();
		void tick().then(() => {
			if (!disposed && panelIntent === intent && cache.visible && docked) {
				refreshPlacement?.(placementState());
				finderEl.querySelector<HTMLButtonElement>(".nya-dock-expand")?.focus({ preventScroll: true });
			}
		});
		return true;
	}
	export function expandFinder() {
		if (!cache.visible || disposed) return;
		if (passiveEntry && editorSearch.activateFloatingFinder?.(ownerView) === false) return;
		const activate = passiveEntry;
		passiveEntry = false;
		const intent = ++panelIntent;
		docked = false; syncFinderVisibility();
		if (activate) setFindText(cache.search, false);
		void tick().then(() => { if (!disposed && panelIntent === intent && cache.visible && !docked) refreshPlacement?.(placementState()); });
		// Do not focus/select the query: tapping the edge tab must not open a keyboard.
	}
	const expandFromTab = () => {
		expandFinder();
		const intent = panelIntent;
		void tick().then(() => {
			if (!disposed && panelIntent === intent && cache.visible && !docked) finderEl.querySelector<HTMLElement>(isMobile ? ".nya-move-handle" : ".nya-dragger")?.focus({ preventScroll: true });
		});
	};

	export function showFloatingEntry() {
		if (disposed || cache.visible) return;
		// Hidden sessions can retain old coordinates; an idle icon must not display
		// those results for a newly opened file or resume an earlier computation.
		cancelEditing(); positionRequest++; readingRequest++;
		cache.matches = []; cache.index = 0; matchedContext = null;
		readingPending = false; readingUnsupported = false; readingError = undefined;
		workerError = false; replacementCommittedError = false;
		passiveEntry = true;
		cache.visible = true;
		docked = true;
		readingMode = isReading();
		const intent = ++panelIntent, file = ownerView.file, doc = finderEl?.ownerDocument;
		syncFinderVisibility();
		// The first synchronous measurement can precede the compact DOM/layout.
		// Re-measure without resetting a marker the user has already moved.
		void tick().then(() => {
			if (!disposed && panelIntent === intent && ownerView.file === file && finderEl?.ownerDocument === doc
				&& ownerView.containerEl?.ownerDocument === doc && cache.visible && docked && passiveEntry) {
				refreshPlacement?.(placementState());
			}
		});
		// Unlike dockFinder(), do not focus the marker or initiate matching.
	}
	const expandFromClick = (event: MouseEvent) => { if (!placement?.consumeClick(event)) expandFromTab(); };
	const dockMenu = (event: MouseEvent) => {
		event.preventDefault();
		if (isMobile) { event.stopPropagation(); placement?.suppressClick(event); return; }
		if (!cache.visible || finderEl.classList.contains("nya-finder--dragging")) return;
		edgeMenu?.hide(); const intent = panelIntent;
		const current = () => !disposed && panelIntent === intent && cache.visible && docked;
		edgeMenu = new Menu(); edgeMenu.addItem((item) => item.setTitle(i18n.t("search.tip.Close")).setIcon("x").onClick(() => { if (current()) closeFinder(); }))
			.addItem((item) => item.setTitle(i18n.t("search.tip.ResetFinderPosition")).setIcon("rotate-ccw").onClick(() => { if (current()) resetFinderPosition(); }))
			.showAtMouseEvent(event);
	};
	function dragToMove(node: HTMLElement, enabled: boolean) {
		// Pointer capture does not isolate the parallel Touch Events stream used
		// by host sidebar gestures. Guard only a touch that begins on this handle.
		let doc = node.ownerDocument, win = doc.defaultView;
		let touchId: number | undefined;
		const cleanupTouch = () => {
			touchId = undefined;
			doc.removeEventListener("touchmove", touchMove, true);
			doc.removeEventListener("touchend", touchEnd, true);
			doc.removeEventListener("touchcancel", touchEnd, true);
			win?.removeEventListener("blur", cleanupTouch); win?.removeEventListener("pagehide", cleanupTouch);
		};
		const ownsTouch = (event: TouchEvent) => Array.from(event.changedTouches).some((touch) => touch.identifier === touchId);
		const touchMove = (event: TouchEvent) => {
			if (!ownsTouch(event)) return;
			event.stopPropagation(); if (event.cancelable) event.preventDefault();
		};
		const touchEnd = (event: TouchEvent) => {
			if (!ownsTouch(event)) return;
			event.stopPropagation(); cleanupTouch();
		};
		const touchStart = (event: TouchEvent) => {
			if (node.ownerDocument !== doc) { cleanupTouch(); doc = node.ownerDocument; win = doc.defaultView; }
			if (!isMobile || !enabled || touchId !== undefined || !event.changedTouches.length) return;
			touchId = event.changedTouches[0].identifier;
			// Preserve the browser's short-tap click; never preventDefault here.
			event.stopPropagation();
			doc.addEventListener("touchmove", touchMove, { capture: true, passive: false });
			doc.addEventListener("touchend", touchEnd, true); doc.addEventListener("touchcancel", touchEnd, true);
			win?.addEventListener("blur", cleanupTouch); win?.addEventListener("pagehide", cleanupTouch);
		};
		const start = (event: PointerEvent) => { if (enabled) placement?.start(event, isMobile); };
		const context = (event: MouseEvent) => {
			if (!enabled) return;
			event.preventDefault();
			if (isMobile) { event.stopPropagation(); placement?.suppressClick(event); }
		};
		node.addEventListener("pointerdown", start); node.addEventListener("contextmenu", context);
		if (isMobile) node.addEventListener("touchstart", touchStart, { passive: true });
		return { update(next: boolean) {
			enabled = next;
			if (!enabled || node.ownerDocument !== doc) cleanupTouch();
		}, destroy() {
			cleanupTouch(); node.removeEventListener("touchstart", touchStart);
			node.removeEventListener("pointerdown", start); node.removeEventListener("contextmenu", context);
		} };
	}
	$: if (finderEl) syncFinderVisibility();
	export function resetFinderPosition() { if (docked && !passiveEntry) expandFinder(); placement?.reset(); }
	const moveFinderKey = (event: KeyboardEvent) => {
		if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
		const step = event.shiftKey ? 32 : 8;
		const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
		if (delta) { event.preventDefault(); event.stopPropagation(); placement?.moveBy(delta[0], delta[1]); }
		else if (event.key === "Home") { event.preventDefault(); resetFinderPosition(); }
	};
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
		autoDock = editorSearch.plugin.settings.finderAutoDock ?? false;
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

	const runToolbarAction = (action: ToolbarAction, focusQuery = true) => {
		if (action === "regex") toggleRegexMode(focusQuery);
		else if (action === "case") toggleMatchCaseMode(focusQuery);
		else if (action === "wholeWord") toggleWholeWordMode(focusQuery);
		else if (action === "selection") toggleFindInSelection();
		else if (action === "previous") toPreviousMatch();
		else if (action === "next") toNextMatch();
		else if (action === "history") editorSearch.openHistory();
		else if (action === "replace") replaceOnce();
		else if (action === "replaceAll") replaceAll();
	};

	export function getSearchCache() {
		return cache;
	}

	function focusInput(target: "search" | "replace", afterLayout: boolean) {
		const intent = panelIntent, file = ownerView.file, reading = isReading();
		const doc = finderEl?.ownerDocument;
		const current = () => !disposed && panelIntent === intent && cache.visible && !docked
			&& ownerView.file === file && isReading() === reading && finderEl?.ownerDocument === doc
			&& ownerView.containerEl?.ownerDocument === doc && (target !== "replace" || (!reading && !cache.collapse));
		const focus = () => {
			if (!current()) return;
			if (afterLayout) refreshPlacement?.(placementState());
			if (!current()) return;
			const input = target === "replace" ? replaceEl : searchEl;
			if (!input?.isConnected || input.ownerDocument !== doc) return;
			input.focus({ preventScroll: true });
			const select = () => { if (current() && doc?.activeElement === input) input.select(); };
			select();
			// Immediate opening may supply a new query before bind:value flushes.
			// Reselect that rendered value, without issuing another focus request.
			if (!afterLayout) void tick().then(select);
		};
		if (afterLayout) void tick().then(focus); else focus();
	}

	export function setVisible(
		flag: boolean,
		searchText?: string,
		historyIndexOverride?: number,
		focusTarget: "search" | "replace" = "search",
	) {
		edgeMenu?.hide();
		const wasDocked = docked;
		positionRequest++;
		passiveEntry = false;
		docked = false;
		panelIntent++;
		cache.visible = flag;
		syncFinderVisibility();
		const settings = editorSearch.plugin.settings;
		if (cache.visible) {
			if (!scopeEnabled) scopeBlocked = false;
			setFindText(searchText !== undefined ? searchText : cache.search);
			focusInput(focusTarget, wasDocked || focusTarget === "replace");
			if (historyIndexOverride !== undefined) historyNavigation.select(cache.search, getSortedHistory());
			else historyNavigation.reset();
		} else {
			cancelEditing();
			if (scopeEnabled) clearScope(true);
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

	export function showReplace(searchText?: string) {
		if (disposed || isReading()) return;
		// Expanding a compact session must not replace its query with a selection.
		const query = docked ? undefined : searchText;
		setCollapse(false);
		// Focus the replacement input directly, never the query as an intermediate
		// target (which could scroll ancestors or briefly open the wrong keyboard).
		setVisible(true, query, undefined, "replace");
	}

	export function toggleReplaceFromCommand() {
		if (disposed || isReading()) return;
		if (!cache.visible || docked) showReplace();
		else toggleCollapse();
	}

	export function resetAll() {
		cancelEditing();
		clearScope();
		positionRequest++;
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
		passiveEntry = false;
		docked = false;
		panelIntent++;
		syncFinderVisibility();
		cache.collapse = true;
		cache.options = {
			regexMode: false,
			caseSensitive: false,
			wholeWord: false,
		};
		emitChange();
	}

	export function toggleVisible() {
		if (cache.visible && !docked) closeFinder();
		else setVisible(true);
	}

	export function toggleCollapse() {
		setCollapse(!cache.collapse);
	}

	export function isVisible() {
		return cache.visible;
	}
	export function isDocked() { return docked; }

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
		if (typeof editorSearch.getMatchEngine?.(ownerView).replace === "function") return replaceInWorker(cache.replace, false, true);
		const before = getEditorContext();
		const result = replaceText(cache.replace, false);
		const current = getEditorContext();
		const request = positionRequest;
		const advance = () => {
			if (!disposed && positionRequest === request && result.changed && !result.navigationFailed
				&& result.beforeCount === result.afterCount && before && current
				&& current.file === before.file && current.editor === before.editor
				&& current.editorView === before.editorView && isCurrentContext(current)
				&& matchedContext?.doc === current.doc && matchedQuery === queryKey()) {
				toNextMatch();
			}
		};
		if (result.navigationCompletion) void result.navigationCompletion.then((success) => { if (success) advance(); });
		else advance();
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
	export const toggleRegexMode = (focusQuery = true) => {
		cache.options.regexMode = !cache.options.regexMode;
		if (focusQuery) searchEl.focus({ preventScroll: true });
		setFindText(cache.search);
	};

	export const toggleMatchCaseMode = (focusQuery = true) => {
		cache.options.caseSensitive = !cache.options.caseSensitive;
		if (focusQuery) searchEl.focus({ preventScroll: true });
		setFindText(cache.search);
	};

	export const toggleWholeWordMode = (focusQuery = true) => {
		cache.options.wholeWord = !cache.options.wholeWord;
		if (focusQuery) searchEl.focus({ preventScroll: true });
		setFindText(cache.search);
	};

	const searchKey = () => JSON.stringify([cache.search, cache.options.regexMode, cache.options.caseSensitive, cache.options.wholeWord]);
	const queryKey = () => JSON.stringify([searchKey(), scopeEpoch, scopeRanges()]);

	export const getEditorContext = () => {
		const context = editorSearch.getEditorContext(ownerView);
		syncScope(context);
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
				annotations: finderSelection ? finderSelection.of(true) : undefined,
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

	export const setFindText = (text: string, scroll: boolean = true, activeEditor = getEditorContext(), direction = 0, synchronous = false) => {
		// Host editor-change/layout events can fire synchronously during our commit.
		// They must not cancel post-commit matching, or replay the edit.
		if (replacementTask?.committing) return;
		passiveEntry = false;
		if (replacementTask && !scroll && text === cache.search && replacementCurrent(replacementTask)) return;
		if (replacementTask) cancelEditing();
		replacementRetry = null; replacementCommittedError = false;
		positionRequest++;
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
		workerError = false;
		if (readingMode) {
			cancelEditing();
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
				workerError = result.workerError ?? false;
			}, direction);
			return;
		}
		readingRequest++;
		editorSearch.clearReadingSearch?.(ownerView);
		if (activeEditor && isCurrentContext(activeEditor)) {
			const { editor } = activeEditor;

			if (text) {
				const key = queryKey();
				const pending = editingComputation;
				const win = ownerView.containerEl?.ownerDocument.defaultView ?? null;
				if (!synchronous && pending && pending.key === key && pending.window === win
					&& pending.context.doc === activeEditor.doc && pending.context.file === activeEditor.file
					&& pending.context.editor === activeEditor.editor && pending.context.editorView === activeEditor.editorView) {
					if (scroll) { pending.scroll = true; pending.direction += direction; }
					return;
				}
				if (editingComputation) cancelEditing();
				readingPending = false;
				const content = editor.getValue();
				const apply = (result: MatchResult, shouldScroll: boolean, requestedDirection: number) => {
					if (disposed || !isCurrentContext(activeEditor) || queryKey() !== key
						|| (ownerView.containerEl?.ownerDocument.defaultView ?? null) !== win || win?.closed) return;
					readingPending = false;
					if (result.status === "cancelled") return;
					if (result.status === "failed") {
						cache.matches = []; cache.index = 0; matchedContext = null;
						readingError = "failed"; workerError = true; emitChange(); return;
					}
					cache.matches = result.matches; rememberMatches(activeEditor);
					if (cache.matches.length && requestedDirection) cache.index = ((cache.index + requestedDirection)
						% cache.matches.length + cache.matches.length) % cache.matches.length;
					if (cache.matches.length && shouldScroll) scrollToMatch(activeEditor);
					else { if (!cache.matches.length) cache.index = 0; emitChange(true, undefined, activeEditor); }
				};
				if (!synchronous && editorSearch.getMatchEngine) editingEngine = editorSearch.getMatchEngine(ownerView);
				const ranges = scopeRanges();
				const result = !synchronous && editingEngine ? editingEngine.match(content, text, cache.options, ranges)
					: { status: "completed" as const, matches: findTextOffsets(content, text, cache.options.regexMode, cache.options.caseSensitive, cache.options.wholeWord, ranges), synchronous: true };
				if (result instanceof Promise) {
					const computation = { context: activeEditor, key, window: win, scroll, direction };
					editingComputation = computation; readingPending = true;
					cache.matches = []; emitChange(true, undefined, activeEditor);
					void result.then((value) => {
						if (editingComputation !== computation) return;
						editingComputation = null; apply(value, computation.scroll, computation.direction);
					}).catch((error) => {
						if (editingComputation !== computation) return;
						editingComputation = null; apply({ status: "failed", error }, false, 0);
					});
				} else apply(result, scroll, direction);
			} else {
				resetMatches(true);
			}
		} else {
			cancelEditing(); readingPending = false;
			cache.matches = [];
			cache.index = 0;
			matchedContext = null;
		}
	};

	const navigateMatch = (direction: number) => {
		if (replacementTask) { cancelEditing(); readingPending = false; }
		if (isReading()) {
			setFindText(cache.search, true, null, direction);
			if (cache.visible && !readingUnsupported && !readingError && cache.search) recordSearchToHistory(cache.search);
			return;
		}
		const context = getEditorContext();
		if (!context) return;
		if (matchedContext?.doc !== context.doc || matchedContext.file !== context.file
			|| matchedContext.editorView !== context.editorView || matchedQuery !== queryKey() || editingComputation) {
			setFindText(cache.search, true, context, direction);
			if (cache.search) recordSearchToHistory(cache.search);
			return;
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
		if (disposed) return false;
		if (replacementTask?.phase === "prepare") { cancelEditing(); readingPending = false; }
		if (isReading()) { setFindText(cache.search, true); return true; }
		try {
			if (!activeEditor || !isCurrentContext(activeEditor)) return false;
			if (matchedContext?.doc !== activeEditor.doc || matchedQuery !== queryKey()
				|| matchedContext.file !== activeEditor.file || matchedContext.editorView !== activeEditor.editorView) {
				setFindText(cache.search, true, activeEditor);
				return false;
			}
			const matched = cache.matches[cache.index];
			if (!matched) return true;
			const request = ++positionRequest;
			const requestQuery = queryKey();
			const requestIndex = cache.index;
			const visible = cache.visible;
			const { editor, view } = activeEditor;
			const { from, to } = matched;
			editor.scrollIntoView({ from: editor.offsetToPos(from), to: editor.offsetToPos(to) }, true);
			const state = view.getState();
			const { sourceModeWhenSearch, moveCursorToMatch } = editorSearch.plugin.settings;
			if (sourceModeWhenSearch && state.mode === "source") state.source = true;
			const currentRequest = () => !disposed && positionRequest === request
				&& cache.visible === visible && queryKey() === requestQuery && cache.index === requestIndex
				&& ownerView.file === activeEditor.file;
			const complete = () => {
				if (!currentRequest()) return false;
				if (!isCurrentContext(activeEditor)) {
					// Mode switches may rebuild the editor. Refresh, but never select
					// using old offsets or advance a replacement in the new editor.
					const rebuilt = getEditorContext();
					if (rebuilt && rebuilt.editorView !== activeEditor.editorView) matchAgain(false);
					return false;
				}
				emitChange(true, { selection: moveCursorToMatch ? { anchor: from, head: to } : undefined }, activeEditor);
				return true;
			};
			const changed = view.setState(state, { history: false });
			if (changed && typeof changed.then === "function") {
				return Promise.resolve(changed).then(complete).catch((error) => {
					if (currentRequest() && getEditorContext()) editorSearch.plugin.reportError(
						afterReplacement ? "search.ReplacedNavigationFailed" : "search.EditorFailed", error);
					return false;
				});
			}
			return complete();
		} catch (error) {
			editorSearch.plugin.reportError(afterReplacement ? "search.ReplacedNavigationFailed" : "search.EditorFailed", error);
			return false;
		}
	};

	export const resetMatches = (clearSearch = false, clearReplace = false) => {
		cancelEditing();
		positionRequest++;
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
		cancelEditing(); readingPending = false;
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
			cache.options.wholeWord,
			scopeRanges(),
		);
		cache.matches = replacements.matches;
		rememberMatches(activeEditor);
		if (cache.matches.length === 0) {
			emitChange(true, undefined, activeEditor);
		}
		return { activeEditor, replacements };
	};

	const replaceText = (inputText: string, all: boolean): ReplaceResult => {
		if (docked) expandFinder();
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
					// Replacement remains synchronous in this first integration stage,
					// including its post-commit count/navigation contract.
					setFindText(search, false, current, 0, true);
					const positioned = scrollToMatch(current, true);
					if (typeof positioned === "boolean") result.navigationFailed = !positioned;
					else result.navigationCompletion = positioned.then((success) => {
						result.navigationFailed = !success;
						return success;
					});
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

	const replacementCurrent = (task: ReplacementTask) => !disposed && replacementTask === task
		&& !isReading() && isCurrentContext(task.context) && queryKey() === task.key
		&& task.context.file?.path === task.path
		&& (ownerView.containerEl?.ownerDocument.defaultView ?? null) === task.window && !task.window?.closed
		&& (task.phase === "committed" || (cache.replace === task.replace
			&& editorSearch.plugin.settings.useEscapeCharInReplace === task.escape));

	const replaceInWorker = (inputText: string, all: boolean, advance = false, synchronous = false): ReplaceResult | Promise<ReplaceResult> => {
		const result: ReplaceResult = { changed: false, changeCount: 0, search: cache.search, replace: cache.replace,
			beforeCount: 0, afterCount: 0, status: "cancelled" };
		if (disposed || isReading()) return result;
		if (docked) expandFinder();
		const context = getEditorContext();
		if (!context) return result;
		const index = matchedContext && (matchedContext.file !== context.file || matchedContext.editorView !== context.editorView) ? 0 : cache.index;
		cancelEditing(true); positionRequest++;
		editingEngine = editorSearch.getMatchEngine(ownerView);
		const task: ReplacementTask = { context, key: queryKey(), window: ownerView.containerEl?.ownerDocument.defaultView ?? null,
			path: context.file?.path, replace: cache.replace, escape: editorSearch.plugin.settings.useEscapeCharInReplace,
			phase: "prepare", committing: false, scopeEpoch, searchKey: searchKey() };
		replacementTask = task; readingError = undefined; workerError = false; replacementCommittedError = false;
		const options = { ...cache.options };
		const replacement = options.regexMode ? adjustReplaceText(inputText) : inputText;
		const failed = (error: unknown, committed: boolean) => {
			result.status = "failed"; result.error = error; result.navigationFailed = committed;
			readingPending = false; readingError = "failed"; workerError = true; replacementCommittedError = committed;
			replacementTask = null;
			if (committed) {
				// Never offer to replay a write which already committed.
				replacementRetry = null;
				editorSearch.plugin.reportError("search.ReplacedNavigationFailed", error);
			} else {
				replacementRetry = (sync) => {
					if (!disposed && isCurrentContext(context) && queryKey() === task.key && cache.replace === task.replace
						&& editorSearch.plugin.settings.useEscapeCharInReplace === task.escape
						&& context.file?.path === task.path
						&& (ownerView.containerEl?.ownerDocument.defaultView ?? null) === task.window) {
						void replaceInWorker(inputText, all, advance, sync);
					} else setFindText(cache.search);
				};
			}
		};
		const finishPosition = (matched: MatchResult): boolean | Promise<boolean> => {
			if (!replacementCurrent(task)) {
				if (replacementTask === task) { replacementTask = null; readingPending = false; }
				return false;
			}
			if (matched.status === "failed") { failed(matched.error, true); return false; }
			if (matched.status === "cancelled") { replacementTask = null; readingPending = false; return false; }
			cache.matches = matched.matches; rememberMatches(task.context);
			result.afterCount = matched.matches.length; readingPending = false; replacementTask = null;
			let positioned: boolean | Promise<boolean>;
			try { positioned = scrollToMatch(task.context, true); }
			catch (error) { failed(error, true); return false; }
			const request = positionRequest;
			const complete = (success: boolean) => {
				result.navigationFailed = !success;
				if (success && advance && result.beforeCount === result.afterCount && !disposed
					&& positionRequest === request && isCurrentContext(task.context) && queryKey() === task.key
					&& (ownerView.containerEl?.ownerDocument.defaultView ?? null) === task.window) toNextMatch();
				return success;
			};
			return positioned instanceof Promise ? positioned.then(complete) : complete(positioned);
		};
		const apply = (prepared: MatchResult): ReplaceResult => {
			if (!replacementCurrent(task)) {
				if (replacementTask === task) { replacementTask = null; readingPending = false; }
				return result;
			}
			if (prepared.status === "failed") { failed(prepared.error, false); return result; }
			if (prepared.status === "cancelled") { replacementTask = null; readingPending = false; return result; }
			cache.matches = prepared.matches; rememberMatches(context);
			result.beforeCount = result.afterCount = prepared.matches.length;
			const changes = prepared.changes ?? [];
			const ranges = scopeRanges();
			if (ranges && changes.some(({ from, to }) => !ranges.some((range) => from >= range.from && to <= range.to))) {
				failed(new Error("Replacement outside search scope"), false); return result;
			}
			if (!changes.length) {
				replacementTask = null; readingPending = false; result.status = "completed";
				emitChange(true, undefined, context); return result;
			}
			// All candidates are for the captured immutable doc, verified above.
			// Commit exactly once, synchronously; no main-thread regex revalidation.
			try {
				task.committing = true; context.editorView.dispatch({ changes });
			} catch (error) {
				task.committing = false;
				// Host callbacks can throw after CodeMirror has committed the state.
				// Report that boundary, never invite a second write.
				const committed = context.editorView.state.doc !== context.doc;
				result.changed = committed; result.changeCount = committed ? changes.length : 0;
				failed(error, committed); replacementRetry = null; return result;
			}
			finally { task.committing = false; }
			result.changed = true; result.changeCount = changes.length; result.status = "completed";
			task.phase = "committed";
			const current = getEditorContext();
			if (!current || current.file !== context.file || current.editor !== context.editor || current.editorView !== context.editorView
				|| replacementTask !== task || scopeEpoch !== task.scopeEpoch || searchKey() !== task.searchKey) {
				result.navigationFailed = true; replacementTask = null; readingPending = false; return result;
			}
			task.context = current;
			task.key = queryKey();
			cache.matches = []; readingPending = true;
			try {
				emitChange(true, undefined, current);
				const matched = synchronous ? { status: "completed" as const, matches: findTextOffsets(current.doc.toString(),
					cache.search, options.regexMode, options.caseSensitive, options.wholeWord, scopeRanges()), synchronous: true }
					: editingEngine!.match(current.doc.toString(), cache.search, options, scopeRanges());
				const positioned = matched instanceof Promise ? matched.then(finishPosition) : finishPosition(matched);
				if (positioned instanceof Promise) result.navigationCompletion = positioned.then((success) => {
					result.navigationFailed = !success; return success;
				}).catch((error) => {
					if (replacementCurrent(task)) failed(error, true);
					result.navigationFailed = true; return false;
				});
				else result.navigationFailed = !positioned;
			} catch (error) { if (replacementCurrent(task)) failed(error, true); }
			return result;
		};
		try {
			const source = context.doc.toString();
			let prepared: MatchResult | Promise<MatchResult>;
			if (synchronous) {
				const replacements = prepareReplacements(source, cache.search, replacement, options.regexMode, options.caseSensitive, options.wholeWord, scopeRanges());
				const selectedIndex = index >= 0 && index < replacements.matches.length ? index : 0;
				const selected = all ? undefined : replacements.one(selectedIndex);
				prepared = { status: "completed", synchronous: true, matches: replacements.matches,
					changes: all ? replacements.all() : selected ? [selected] : [] };
			} else prepared = editingEngine.replace!(source, cache.search, replacement, options, index, all, scopeRanges());
			if (prepared instanceof Promise) {
				readingPending = true;
				return prepared.then(apply).catch((error) => { if (replacementCurrent(task)) failed(error, task.phase === "committed"); return result; });
			}
			return apply(prepared);
		} catch (error) { if (replacementCurrent(task)) failed(error, task.phase === "committed"); return result; }
	};

	export const replaceMatchedText = (inputText: string): ReplaceResult | Promise<ReplaceResult> =>
		typeof editorSearch.getMatchEngine?.(ownerView).replace === "function" ? replaceInWorker(inputText, false) : replaceText(inputText, false);

	export const replaceAllMatchedText = (inputText: string): ReplaceResult | Promise<ReplaceResult> =>
		typeof editorSearch.getMatchEngine?.(ownerView).replace === "function" ? replaceInWorker(inputText, true) : replaceText(inputText, true);
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
		syncFinderVisibility();
		if (passiveEntry) { readingMode = isReading(); return; }
		if (replacementTask?.committing || (!scroll && replacementTask && replacementCurrent(replacementTask))) return;
		const { search } = cache;
		if (cache.visible) {
			setFindText(search, scroll);
		} else {
			cancelEditing();
			readingRequest++;
			readingMode = isReading();
			readingPending = false;
			editorSearch.clearReadingSearch?.(ownerView);
			cache.matches = [];
			cache.index = 0;
			matchedContext = null;
		}
	};
	const retrySynchronously = () => {
		if (replacementRetry) { replacementRetry(true); return; }
		if (isReading()) editorSearch.getReadingSearch(ownerView).retrySynchronously();
		setFindText(cache.search, true, getEditorContext(), 0, true);
	};
	const onReplaceChanged = () => {
		if (replacementTask?.phase === "prepare") { cancelEditing(); readingPending = false; }
		replacementRetry = null;
	};
	const retrySearch = () => {
		if (replacementRetry) replacementRetry(false);
		else setFindText(cache.search);
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
	class:nya-finder--docked={docked}
	class:nya-finder--dock-left={dockSide === "left"}
	use:positionFinder={{ visible: cache.visible, docked, side: dockSide, toolsHeight: isMobile ? 40 : 0, autoDock }}
	use:alignRows={[isCollapsed, customToolbar, searchToolbar, replaceToolbar]}
>
	<SearchStatus visible={expanded} pending={readingPending} unsupported={readingUnsupported}
		error={readingError} query={cache.search} context={statusContext} retry={retrySearch}
		{readingMode} {workerError} synchronousRetry={retrySynchronously} cancel={() => setVisible(false)}
		committed={replacementCommittedError}
		replacing={replacementTask?.phase === "prepare"} rematching={replacementTask?.phase === "committed"}
		nativeFind={() => editorSearch.openNativeSearch(ownerView)} />
	{#if docked}
		<div class="nya-dock-tab">
			<button type="button" class="nya-dock-expand" tabindex={cache.visible ? 0 : -1} on:click={expandFromClick} use:dragToMove={cache.visible}
				on:keydown={moveFinderKey} on:contextmenu={dockMenu}
				aria-labelledby={`nya-expand-label-${cid}`} aria-expanded="false" aria-busy={readingPending}>
				<span id={`nya-expand-label-${cid}`} class="nya-move-help">{i18n.t("search.tip.ExpandFinder")}</span>
				<Search size={16} aria-hidden="true" />
				{#if readingPending || readingError || readingUnsupported}
					<span class="nya-dock-state" role="status" aria-label={i18n.t(readingPending ? "search.MatchPending" : "search.StatusError")}>{readingPending ? "…" : "!"}</span>
				{/if}
			</button>
		</div>
	{/if}
	{#if !isMobile}
		<div class="nya-dragger nya-drag-handle" use:dragToMove={expanded} role="button" tabindex={expanded ? 0 : -1}
			aria-labelledby={`nya-move-label-${cid}`} on:keydown={moveFinderKey}>
			<span id={`nya-move-label-${cid}`} class="nya-move-help">{i18n.t("search.tip.MoveFinder")}</span>
		</div>
	{:else}
		<div class="nya-dragger"></div>
	{/if}
	{#if !readingMode}
	<div
		class={`nya-toggle nya-focus`}
		on:click={toggleCollapse}
		role="button"
		tabindex={expanded ? 0 : -1}
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
					<button type="button" class="nya-move-handle nya-focus" tabindex={commonTabIndex}
						aria-labelledby={`nya-move-label-${cid}`} use:dragToMove={expanded} on:keydown={moveFinderKey}>
						<span id={`nya-move-label-${cid}`} class="nya-move-help">{i18n.t("search.tip.MoveFinder")}</span>
						<span class="nya-move-bar" aria-hidden="true"></span>
					</button>
					<div class="nya-float-tip">
						{#if readingPending || readingUnsupported || readingError}
							<div aria-label={i18n.t(readingPending ? (readingMode ? "search.ReadingPending" : "search.MatchPending") : "search.StatusError")} title={i18n.t(readingPending ? (readingMode ? "search.ReadingPendingDetail" : "search.MatchPending") : "search.StatusError")} aria-busy={readingPending}>{readingPending ? "…" : "!"}</div>
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
					<div class="nya-mobile-actions">
						<div class="nya-mobile-inline" bind:this={mobileInlineTarget}></div>
						<div
							class="nya-btn nya-focus"
							class:nya-mobile-close={isMobile}
							on:click={closeFinder}
							role="button"
							tabindex={commonTabIndex}
							on:keydown={defaultEnterEvent}
							aria-label={i18n.t("search.tip.Close")}
						>
							<X size={iconSize} />
						</div>
					</div>
				</div>
			{:else}
				<div class="nya-tip">
					{#if readingPending || readingUnsupported || readingError}
						<div aria-label={i18n.t(readingPending ? (readingMode ? "search.ReadingPending" : "search.MatchPending") : "search.StatusError")} title={i18n.t(readingPending ? (readingMode ? "search.ReadingPendingDetail" : "search.MatchPending") : "search.StatusError")} aria-busy={readingPending}>{readingPending ? "…" : "!"}</div>
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
					caseSensitive={cache.options.caseSensitive} wholeWord={cache.options.wholeWord} {historyEnabled} tabindex={commonTabIndex} visible={expanded}
					selection={scopeEnabled || scopeBlocked} selectionUnavailable={scopeBlocked || scopeEmpty} {readingMode}
					inlineTarget={isMobile ? mobileInlineTarget : undefined} />
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
				bind:this={replaceEl}
				use:trackComposition
				wrap="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				rows="1"
				class="nya-input"
				bind:value={cache.replace}
				on:input={onReplaceChanged}
				on:keydown={enterOnReplacer}
				placeholder={i18n.t("search.tip.ReplacePlaceholder")}
				tabindex={replacerTabIndex}
			/>
			<div class="replacer-act"
				style:padding-right={replaceOffset === undefined ? undefined : `${replaceOffset}px`}
				style:--nya-search-actions-width={searchActionsWidth === undefined ? undefined : `${searchActionsWidth}px`}>
				<Toolbar items={replaceToolbar} run={runToolbarAction} tabindex={commonTabIndex} visible={expanded && !isCollapsed} />
			</div>
		</div>
	</div>
</div>

<style lang="scss">
	@use "./styles/finder-primitives" as finder;
	.nya-finder {
		@include finder.surface;
		position: absolute;
		transition:
			transform 0.2s linear,
			opacity 0.2s linear,
			right 0.3s cubic-bezier(0.45, 0.05, 0.55, 0.95);
		height: 72px;
		min-width: min(var(--nya-default-width), var(--nya-available-width, 100vw));
		max-width: var(--nya-available-width, calc(100vw - 16px));
		top: 88px;
		right: 48px;
		z-index: 20;
		display: flex;
		flex-direction: row;
		justify-content: center;
		align-items: center;
		&--dragging { transition: opacity 0.12s ease; opacity: 0.8; user-select: none; cursor: grabbing; }
		&:global([data-dock-preview="left"]) { border-left-color: var(--interactive-accent); box-shadow: -3px 0 0 var(--interactive-accent); }
		&:global([data-dock-preview="right"]) { border-right-color: var(--interactive-accent); box-shadow: 3px 0 0 var(--interactive-accent); }
		&.nya-finder--docked {
			min-width: 0; width: 30px !important;
			background-color: var(--background-secondary);
			border-color: var(--background-modifier-border);
			border-radius: 8px; box-shadow: none;
			// Compact positioning must not sample a moving transform/right offset.
			transition: opacity 0.12s ease;
			.main-part, .nya-toggle, .nya-dragger, .nya-float-act { display: none !important; }
		}
		.nya-dock-tab button {
			display: flex; align-items: center; justify-content: center; margin: 0; padding: 0;
			width: 32px; height: 100%; border: 0; border-radius: inherit;
			box-shadow: none; background: transparent; color: var(--text-normal);
			&:hover { background: var(--background-modifier-hover); }
			&:active { background: var(--background-modifier-active-hover, var(--background-modifier-hover)); }
			&:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
		}
		.nya-drag-handle, .nya-move-handle, .nya-dock-expand { touch-action: none; cursor: grab; }
		&--dragging .nya-drag-handle, &--dragging .nya-move-handle, &--dragging .nya-dock-expand { cursor: grabbing; }
		.nya-drag-handle { position: relative; outline-offset: 2px; }
		.nya-drag-handle::after { content: ""; position: absolute; left: -6px; right: -2px; top: 0; bottom: 0; }
		.nya-drag-handle:focus-visible { outline: 2px solid var(--interactive-accent); }
		.nya-dock-tab { display: flex; width: 100%; height: 100%; border-radius: inherit; }
		.nya-dock-tab button { width: 100%; }
		.nya-dock-tab .nya-dock-expand { position: relative; }
		.nya-dock-state { position: absolute; top: 0; right: 2px; font-size: 12px; }
		// overflow: hidden;

		&--collapsed {
			height: 38px;
		}
		&.nya-finder--docked { height: 30px; }

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
			min-width: 0;
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
			grid-template-columns: minmax(0, 1fr) auto auto;
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
		@include finder.counter;
	}

	.nya-btn {
		@include finder.button;
	}
	.nya-input {
		@include finder.input;
		min-width: 0; flex: 1;
	}
	.nya-focus {
		@include finder.focus;
	}
	.nya-move-help { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

	:global(.is-mobile) {
		.nya-finder.nya-mobile {
			.nya-move-handle, .nya-dock-expand { -webkit-touch-callout: none; user-select: none; }
			// Expansion changes right/transform; measuring an animated base would
			// leave a stale translate that pushes the panel out after the animation.
			transition: opacity 0.2s linear;
			&.nya-finder--dragging, &.nya-finder--docked { transition: opacity 0.12s ease; }
			box-sizing: border-box;
			height: auto;
			min-width: 0;
			max-width: min(416px, var(--nya-available-width, calc(100vw - 16px)));
			width: 100%;
			right: 50%;
			transform: translateX(50%);
			&.nya-finder--docked {
				width: 40px !important; height: 40px;
				right: 8px; transform: none;
				&.nya-finder--dock-left { left: 8px; right: auto; }
			}
			.main-part {
				height: auto; padding: 0; gap: 0;
				.finder, .replacer {
					box-sizing: border-box; min-height: 38px; padding: 4px 0;
					margin: 0; align-items: center;
				}
			}
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
				bottom: 100%; left: -1px; top: auto;
				position: absolute;
				right: -1px;
				border-radius: 4px 4px 0 0;
				border: 1px solid var(--modal-border-color);
				box-sizing: border-box; min-height: 40px; padding: 4px;
				height: auto;
				display: grid;
				grid-template-columns: minmax(0, 1fr) 72px minmax(0, 1fr);
				align-items: center;
				.nya-move-handle {
					grid-column: 2; grid-row: 1; align-self: start;
					box-sizing: border-box; width: 72px; height: 30px; min-height: 0;
					margin: 0; padding: 4px 0 0; display: flex; align-items: flex-start; justify-content: center;
					border: 0; border-radius: 4px; box-shadow: none; background: transparent;
					color: var(--text-muted); cursor: grab;
					&:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
				}
				.nya-move-bar { width: 32px; height: 4px; border-radius: 2px; background: currentColor; pointer-events: none; }
				.nya-mobile-actions {
					grid-column: 3; grid-row: 1; min-width: 0; display: flex;
					justify-content: flex-end; align-items: center; flex-wrap: wrap;
					> .nya-btn { flex-shrink: 0; }
				}
				.nya-mobile-inline { display: flex; flex-wrap: wrap; align-items: center; min-width: 0; }
				.nya-mobile-inline { flex-shrink: 1; max-width: calc(100% - 28px); }
				.nya-float-tip {
					grid-column: 1; grid-row: 1;
					display: flex;
					align-items: center;
					font-size: 12px;
					text-align: left;
					font-family: auto;
					min-width: 0;
					flex: 1; max-width: 100%;
					overflow: hidden;
					text-wrap: nowrap;
					padding: 0 4px;
					> div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				}
			}

			.nya-input {
				box-sizing: border-box; min-width: 0; min-height: 0;
				height: 30px; margin: 0; padding: 4px 6px;
				font-family: var(--font-interface); font-size: 16px; line-height: 20px;
				border-width: 1px; border-style: solid; border-color: var(--background-modifier-border);
				overflow: auto; overscroll-behavior: contain;
				&:focus { border-color: var(--nya-focus-border-color); }
				&::-webkit-scrollbar {
					display: none;
				}
			}
			.finder-act {
				height: 30px;
				min-width: unset;
				width: auto;
				flex-shrink: 0;
			}
			.replacer-act {
				height: 30px;
				min-width: unset;
				width: 112px;
				justify-content: flex-start;
				padding-right: unset;
			}
			&.nya-finder--custom-toolbar .main-part {
				display: flex;
				.finder, .replacer { display: flex; }
				.finder-act { width: auto; }
				.replacer-act { width: auto; justify-content: flex-start; }
			}
		}
	}
	@media (prefers-reduced-motion: reduce) { .nya-finder { transition: none !important; } }
</style>
