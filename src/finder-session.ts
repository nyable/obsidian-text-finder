import type { EditorSearch } from "./editor-extension";
import { searchCacheEffect, finderSelection, searchScopeField, searchScopeEffect } from "./search-highlight";
import type { EditorContext } from "./editor-context";
import type { ReadingSelection } from "./reading-selection";
import { i18n } from "./i18n";
import { Platform, Menu, type MarkdownView } from "obsidian";
import { findTextOffsets, prepareReplacements, normalizeSearchRanges } from "./util/text-helper";
import { HistoryNavigation } from "./history";
import { createFinderPosition, type FinderPlacement } from "./finder-position";
import { getLivePreviewPreference } from "./util/obsidian-internal";
import type { TransactionSpec } from "@codemirror/state";
import type { MatchExecutor, MatchResult } from "./match-protocol";
import { defaultToolbar, type ToolbarAction } from "./toolbar";
export interface FinderRuntime { reactive<T extends object>(value: T): T; tick(): Promise<void>; onMount(callback: () => (() => void) | void): void }
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
export interface FinderState { matchedContext: EditorContext | null;
matchedQuery: string;
readingMode: boolean;
readingPending: boolean;
readingUnsupported: boolean;
readingError: "failed" | "timeout" | undefined;
readingRequest: number;
workerError: boolean;
editingEngine: MatchExecutor | null;
editingComputation: {context: EditorContext; key: string; window: Window | null; scroll: boolean; direction: number} | null;
replacementTask: ReplacementTask | null;
replacementRetry: ((synchronous: boolean) => void) | null;
replacementCommittedError: boolean;
positionRequest: number;
disposed: boolean;
docked: boolean;
passiveEntry: boolean;
panelIntent: number;
dockSide: "left" | "right";
placement: ReturnType<typeof createFinderPosition> | undefined;
refreshPlacement: ((state: FinderPlacement) => void) | undefined;
mobileInlineTarget: HTMLDivElement | undefined;
autoDock: boolean;
edgeMenu: Menu | undefined;
searchMode: string;
statusContext: unknown;
scopeEnabled: boolean;
scopeBlocked: boolean;
scopeEmpty: boolean;
scopeEpoch: number;
scopeContext: EditorContext | null;
scopeWindow: Window | null;
readingScope: boolean;
cache: SearchCache;
lastRecordedSearch: string | null;
currentSearch: string;
searchEl: HTMLTextAreaElement;
replaceEl: HTMLTextAreaElement;
finderEl: HTMLDivElement;
searchToolbar: ReturnType<typeof defaultToolbar>;
replaceToolbar: ReturnType<typeof defaultToolbar>;
historyEnabled: boolean;
replaceOffset: number | undefined;
searchActionsWidth: number | undefined; }
/** One owner-local session. Host objects retain raw identity; only presentation state is observable. */
export function createFinderSession(editorSearch: EditorSearch, ownerView: MarkdownView, cid: string, runtime: FinderRuntime) {
const uiState = runtime.reactive({}) as FinderState;
const {tick, onMount} = runtime;
const isCollapsed = () => uiState.readingMode || uiState.cache.collapse;
const expanded = () => uiState.cache.visible && !uiState.docked;
const customToolbar = () => uiState.searchToolbar.some((item, index) => item.id !== defaultToolbar("search")[index]?.id || item.placement !== defaultToolbar("search")[index]?.placement) || uiState.replaceToolbar.some((item,index) => item.id !== defaultToolbar("replace")[index]?.id || item.placement !== defaultToolbar("replace")[index]?.placement);
uiState.matchedContext = null;
uiState.matchedQuery = "";
uiState.readingMode = false;
uiState.readingPending = false;
uiState.readingUnsupported = false;
uiState.readingError = undefined;
uiState.readingRequest = 0;
uiState.workerError = false;
uiState.editingEngine = null;
uiState.editingComputation = null;

uiState.replacementTask = null;
uiState.replacementRetry = null;
uiState.replacementCommittedError = false;
const cancelEditing = (preserveIdle = false) => {
    const busy = !!uiState.editingComputation || !!uiState.replacementTask;
    uiState.editingComputation = null;
    uiState.replacementTask = null;
    uiState.replacementRetry = null;
    if (!preserveIdle || busy)
        uiState.editingEngine?.cancel();
};
uiState.positionRequest = 0;
uiState.disposed = false;
uiState.docked = false;
// An automatically shown entry is not an active search session yet.
uiState.passiveEntry = false;
uiState.panelIntent = 0;
uiState.dockSide = editorSearch?.plugin.settings.finderDockSide ?? "right";
uiState.placement = undefined;
uiState.refreshPlacement = undefined;
uiState.mobileInlineTarget = undefined;
uiState.autoDock = editorSearch?.plugin.settings.finderAutoDock ?? false;
uiState.edgeMenu = undefined;
uiState.searchMode = "source";
uiState.statusContext = ownerView?.file;
const isReading = () => ownerView.getMode?.() === "preview";
uiState.scopeEnabled = false;
uiState.scopeBlocked = false;
uiState.scopeEmpty = false;
uiState.scopeEpoch = 0;
uiState.scopeContext = null;
uiState.scopeWindow = null;
uiState.readingScope = false;
const scopeState = (context: EditorContext | null) => context && searchScopeField
    ? context.editorView.state.field(searchScopeField, false) : undefined;
const clearScope = (block = false) => {
    const previous = uiState.scopeContext;
    if (uiState.readingScope)
        editorSearch.getReadingSearch(ownerView).clearScope();
    uiState.readingScope = false;
    uiState.scopeContext = null;
    uiState.scopeEnabled = false;
    uiState.scopeBlocked = block;
    uiState.scopeEmpty = false;
    uiState.scopeEpoch++;
    if (previous && scopeState(previous)?.ranges != null) {
        try {
            previous.editorView.dispatch({ effects: searchScopeEffect.of(null) });
        }
        catch (error) {
            console.warn("Text Finder: could not clear detached search scope", error);
        }
    }
};
const syncScope = (context: EditorContext | null) => {
    if (uiState.readingScope) {
        if (!isReading() || uiState.scopeWindow !== (ownerView.containerEl?.ownerDocument.defaultView ?? null))
            clearScope(true);
        return;
    }
    if (uiState.scopeEnabled && (isReading() || !context || context.file !== uiState.scopeContext?.file || context.editor !== uiState.scopeContext.editor
        || context.editorView !== uiState.scopeContext.editorView || scopeState(context)?.ranges == null
        || uiState.scopeWindow !== (ownerView.containerEl?.ownerDocument.defaultView ?? null)))
        clearScope(true);
    uiState.scopeEmpty = uiState.scopeEnabled && !scopeRanges()?.length;
};
const scopeRanges = (): readonly SearchRange[] | undefined => {
    if (uiState.scopeBlocked)
        return [];
    if (uiState.readingScope)
        return [];
    return uiState.scopeEnabled ? normalizeSearchRanges(scopeState(uiState.scopeContext)?.ranges ?? [], uiState.scopeContext!.editorView.state.doc.length) : undefined;
};
const activateScope = (selection?: readonly SearchRange[] | readonly ReadingSelection[]) => {
    if (uiState.disposed)
        return false;
    if (isReading()) {
        const readingSelection = selection as readonly ReadingSelection[] | undefined
            ?? editorSearch.getReadingSelection?.(ownerView);
        if (!readingSelection || !editorSearch.canSearchReading(ownerView)) {
            editorSearch.plugin.reportError("search.SelectionRequired", new Error("No supported reading selection"));
            return false;
        }
        if (!editorSearch.getReadingSearch(ownerView).setScope(readingSelection)) {
            editorSearch.plugin.reportError("search.SelectionRequired", new Error("Reading selection could not be mapped"));
            return false;
        }
        if (uiState.scopeContext && scopeState(uiState.scopeContext)?.ranges != null) {
            try {
                uiState.scopeContext.editorView.dispatch({ effects: searchScopeEffect.of(null) });
            }
            catch (error) {
                console.warn("Text Finder: could not clear detached search scope", error);
            }
        }
        uiState.scopeContext = null;
        uiState.scopeBlocked = false;
        uiState.scopeEpoch++;
        uiState.readingScope = true;
        uiState.scopeEnabled = true;
        uiState.scopeWindow = ownerView.containerEl?.ownerDocument.defaultView ?? null;
        uiState.scopeEmpty = false;
        uiState.cache.index = 0;
        return true;
    }
    const context = getEditorContext();
    const state = scopeState(context);
    const ranges = context ? normalizeSearchRanges((selection as readonly SearchRange[] | undefined) ?? state?.candidate ?? [], context.doc.length) : [];
    if (!context || !state || !ranges.length) {
        editorSearch.plugin.reportError("search.SelectionRequired", new Error("No valid editor selection"));
        return false;
    }
    cancelEditing();
    uiState.positionRequest++;
    clearScope();
    uiState.scopeContext = context;
    uiState.scopeEnabled = true;
    uiState.scopeWindow = ownerView.containerEl?.ownerDocument.defaultView ?? null;
    context.editorView.dispatch({ effects: searchScopeEffect.of(ranges) });
    uiState.scopeEmpty = false;
    uiState.cache.index = 0;
    return true;
};
function findInSelection() {
    if (!activateScope())
        return false;
    setVisible(true);
    return true;
}
/** Caller validates the owner/document snapshot before passing menu boundaries. */
function findInCapturedSelection(selection: readonly SearchRange[] | readonly ReadingSelection[]) {
    if (!activateScope(selection))
        return false;
    setVisible(true);
    return true;
}
function findSelectedText(text: string) {
    if (uiState.disposed || !text)
        return false;
    clearScope();
    uiState.cache.index = 0;
    setVisible(true, text);
    return true;
}
function toggleFindInSelection() {
    if (uiState.scopeEnabled || uiState.scopeBlocked) {
        clearScope();
        setFindText(uiState.cache.search);
    }
    else if (activateScope())
        setFindText(uiState.cache.search);
}
function hasSelectionScope() { return uiState.scopeEnabled || uiState.scopeBlocked; }
uiState.cache = runtime.reactive({
    search: "",
    replace: "",
    index: 0,
    matches: [],
    visible: false,
    collapse: true,
    options: runtime.reactive({
        regexMode: editorSearch?.plugin.settings.defaultRegexMode ?? false,
        caseSensitive: editorSearch?.plugin.settings.defaultCaseSensitive ?? false,
        wholeWord: editorSearch?.plugin.settings.defaultWholeWord ?? false,
    }),
});
// Search History
const historyNavigation = new HistoryNavigation();
// Track usage separately from bind:value to identify consecutive query cycles.
uiState.lastRecordedSearch = null;
uiState.currentSearch = "";
// Get sorted history based on user preference
const getSortedHistory = () => editorSearch.plugin.history.sorted();
onMount(() => {
    const unsubscribe = editorSearch.plugin.history.subscribe(() => {
        if (!editorSearch.plugin.settings.enableHistory) {
            historyNavigation.reset();
            return;
        }
        const text = historyNavigation.reconcile(getSortedHistory());
        if (text !== undefined)
            setFindText(text, false);
    });
    return () => { uiState.disposed = true; uiState.edgeMenu?.hide(); uiState.positionRequest++; cancelEditing(); clearScope(); unsubscribe(); };
});
// Continuous navigation counts once; explicit history reuse starts a new use.
const recordSearchToHistory = (searchText: string, force = false) => {
    if (editorSearch.plugin.history.record(searchText, force || uiState.lastRecordedSearch !== searchText)) {
        uiState.lastRecordedSearch = searchText;
    }
};
const isMobile = Platform.isMobile;
const iconSize = 18;
const syncFinderVisibility = () => {
    if (!uiState.finderEl)
        return;
    // Clear hidden/inert state synchronously; compact expansion focuses only
    // after the view has rendered the expanded() controls and corrected placement.
    uiState.finderEl.style.visibility = uiState.cache.visible ? "visible" : "hidden";
    const focused = uiState.finderEl.ownerDocument.activeElement;
    if (!uiState.cache.visible && focused && uiState.finderEl.contains(focused))
        (focused as HTMLElement).blur();
    uiState.finderEl.setAttribute("aria-hidden", String(!uiState.cache.visible));
    uiState.finderEl.classList.toggle("nya-finder--docked", uiState.docked);
    uiState.finderEl.querySelectorAll<HTMLElement>(".main-part, .nya-toggle, .nya-dragger, .nya-float-act").forEach((child) => {
        child.toggleAttribute("inert", !uiState.cache.visible || uiState.docked);
        child.setAttribute("aria-hidden", String(!uiState.cache.visible || uiState.docked));
        if (uiState.docked)
            child.style.setProperty("display", "none", "important");
        else
            child.style.removeProperty("display");
    });
    uiState.refreshPlacement?.(placementState());
};
const placementState = (): FinderPlacement => ({ visible: uiState.cache.visible, docked: uiState.docked, side: uiState.dockSide,
    toolsHeight: isMobile ? (uiState.finderEl?.querySelector<HTMLElement>(".nya-float-act")?.offsetHeight || 40) : 0, autoDock: uiState.autoDock });
function guardHiddenFocus(node: HTMLElement) {
    // Reject late focus requests as well as removing hidden controls from Tab order.
    const guard = (event: FocusEvent) => {
        if (!uiState.cache.visible || (uiState.docked && !(event.target as HTMLElement).closest(".nya-dock-tab")))
            (event.target as HTMLElement).blur();
    };
    node.addEventListener("focusin", guard);
    return { destroy() { node.removeEventListener("focusin", guard); } };
}
function positionFinder(node: HTMLElement, state: FinderPlacement) {
    let doc = node.ownerDocument;
    const create = () => createFinderPosition(node, ownerView.containerEl, (side) => dockFinder(side), () => !uiState.replacementTask);
    uiState.placement = create();
    const update = (next: FinderPlacement) => {
        if (node.ownerDocument !== doc) {
            uiState.placement?.destroy();
            doc = node.ownerDocument;
            uiState.placement = create();
        }
        uiState.placement?.update(next);
    };
    uiState.refreshPlacement = update;
    update(state);
    return { update, destroy() { uiState.placement?.destroy(); uiState.placement = undefined; uiState.refreshPlacement = undefined; } };
}
function dockFinder(side: "left" | "right" = uiState.dockSide) {
    if (!uiState.cache.visible || uiState.replacementTask || uiState.disposed)
        return false;
    // Avoid queued navigation selecting/scrolling text after the user asks to
    // read it unobstructed; matching itself continues and keeps highlights.
    uiState.positionRequest++;
    if (uiState.editingComputation) {
        uiState.editingComputation.scroll = false;
        uiState.editingComputation.direction = 0;
    }
    if (isReading())
        editorSearch.getReadingSearch(ownerView).pauseNavigation();
    uiState.docked = true;
    uiState.dockSide = side;
    const intent = ++uiState.panelIntent;
    const focused = uiState.finderEl.ownerDocument.activeElement;
    if (focused && uiState.finderEl.contains(focused))
        (focused as HTMLElement).blur();
    syncFinderVisibility();
    void tick().then(() => {
        if (!uiState.disposed && uiState.panelIntent === intent && uiState.cache.visible && uiState.docked) {
            uiState.refreshPlacement?.(placementState());
            uiState.finderEl.querySelector<HTMLButtonElement>(".nya-dock-expand")?.focus({ preventScroll: true });
        }
    });
    return true;
}
function expandFinder() {
    if (!uiState.cache.visible || uiState.disposed)
        return;
    if (uiState.passiveEntry && editorSearch.activateFloatingFinder?.(ownerView) === false)
        return;
    const activate = uiState.passiveEntry;
    uiState.passiveEntry = false;
    const intent = ++uiState.panelIntent;
    uiState.docked = false;
    syncFinderVisibility();
    if (activate)
        setFindText(uiState.cache.search, false);
    void tick().then(() => { if (!uiState.disposed && uiState.panelIntent === intent && uiState.cache.visible && !uiState.docked)
        uiState.refreshPlacement?.(placementState()); });
    // Do not focus/select the query: tapping the edge tab must not open a keyboard.
}
const expandFromTab = () => {
    expandFinder();
    const intent = uiState.panelIntent;
    void tick().then(() => {
        if (!uiState.disposed && uiState.panelIntent === intent && uiState.cache.visible && !uiState.docked)
            uiState.finderEl.querySelector<HTMLElement>(isMobile ? ".nya-move-handle" : ".nya-dragger")?.focus({ preventScroll: true });
    });
};
function showFloatingEntry() {
    if (uiState.disposed || uiState.cache.visible)
        return;
    // Hidden sessions can retain old coordinates; an idle icon must not display
    // those results for a newly opened file or resume an earlier computation.
    cancelEditing();
    uiState.positionRequest++;
    uiState.readingRequest++;
    uiState.cache.matches = [];
    uiState.cache.index = 0;
    uiState.matchedContext = null;
    uiState.readingPending = false;
    uiState.readingUnsupported = false;
    uiState.readingError = undefined;
    uiState.workerError = false;
    uiState.replacementCommittedError = false;
    uiState.passiveEntry = true;
    uiState.cache.visible = true;
    uiState.docked = true;
    uiState.readingMode = isReading();
    const intent = ++uiState.panelIntent, file = ownerView.file, doc = uiState.finderEl?.ownerDocument;
    syncFinderVisibility();
    // The first synchronous measurement can precede the compact DOM/layout.
    // Re-measure without resetting a marker the user has already moved.
    void tick().then(() => {
        if (!uiState.disposed && uiState.panelIntent === intent && ownerView.file === file && uiState.finderEl?.ownerDocument === doc
            && ownerView.containerEl?.ownerDocument === doc && uiState.cache.visible && uiState.docked && uiState.passiveEntry) {
            uiState.refreshPlacement?.(placementState());
        }
    });
    // Unlike dockFinder(), do not focus the marker or initiate matching.
}
const expandFromClick = (event: MouseEvent) => { if (!uiState.placement?.consumeClick(event))
    expandFromTab(); };
const dockMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (isMobile) {
        event.stopPropagation();
        uiState.placement?.suppressClick(event);
        return;
    }
    if (!uiState.cache.visible || uiState.finderEl.classList.contains("nya-finder--dragging"))
        return;
    uiState.edgeMenu?.hide();
    const intent = uiState.panelIntent;
    const current = () => !uiState.disposed && uiState.panelIntent === intent && uiState.cache.visible && uiState.docked;
    uiState.edgeMenu = new Menu();
    uiState.edgeMenu.addItem((item) => item.setTitle(i18n.t("search.tip.Close")).setIcon("x").onClick(() => { if (current())
        closeFinder(); }))
        .addItem((item) => item.setTitle(i18n.t("search.tip.ResetFinderPosition")).setIcon("rotate-ccw").onClick(() => { if (current())
        resetFinderPosition(); }))
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
        win?.removeEventListener("blur", cleanupTouch);
        win?.removeEventListener("pagehide", cleanupTouch);
    };
    const ownsTouch = (event: TouchEvent) => Array.from(event.changedTouches).some((touch) => touch.identifier === touchId);
    const touchMove = (event: TouchEvent) => {
        if (!ownsTouch(event))
            return;
        event.stopPropagation();
        if (event.cancelable)
            event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
        if (!ownsTouch(event))
            return;
        event.stopPropagation();
        cleanupTouch();
    };
    const touchStart = (event: TouchEvent) => {
        if (node.ownerDocument !== doc) {
            cleanupTouch();
            doc = node.ownerDocument;
            win = doc.defaultView;
        }
        if (!isMobile || !enabled || touchId !== undefined || !event.changedTouches.length)
            return;
        touchId = event.changedTouches[0].identifier;
        // Preserve the browser's short-tap click; never preventDefault here.
        event.stopPropagation();
        doc.addEventListener("touchmove", touchMove, { capture: true, passive: false });
        doc.addEventListener("touchend", touchEnd, true);
        doc.addEventListener("touchcancel", touchEnd, true);
        win?.addEventListener("blur", cleanupTouch);
        win?.addEventListener("pagehide", cleanupTouch);
    };
    const start = (event: PointerEvent) => { if (enabled)
        uiState.placement?.start(event, isMobile); };
    const context = (event: MouseEvent) => {
        if (!enabled)
            return;
        event.preventDefault();
        if (isMobile) {
            event.stopPropagation();
            uiState.placement?.suppressClick(event);
        }
    };
    node.addEventListener("pointerdown", start);
    node.addEventListener("contextmenu", context);
    if (isMobile)
        node.addEventListener("touchstart", touchStart, { passive: true });
    return { update(next: boolean) {
            enabled = next;
            if (!enabled || node.ownerDocument !== doc)
                cleanupTouch();
        }, destroy() {
            cleanupTouch();
            node.removeEventListener("touchstart", touchStart);
            node.removeEventListener("pointerdown", start);
            node.removeEventListener("contextmenu", context);
        } };
}
function resetFinderPosition() { if (uiState.docked && !uiState.passiveEntry)
    expandFinder(); uiState.placement?.reset(); }
const moveFinderKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
        return;
    const step = event.shiftKey ? 32 : 8;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (delta) {
        event.preventDefault();
        event.stopPropagation();
        uiState.placement?.moveBy(delta[0], delta[1]);
    }
    else if (event.key === "Home") {
        event.preventDefault();
        resetFinderPosition();
    }
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
uiState.searchToolbar = defaultToolbar("search");
uiState.replaceToolbar = defaultToolbar("replace");
uiState.historyEnabled = true;
uiState.replaceOffset = undefined;
uiState.searchActionsWidth = undefined;
function refreshToolbar() {
    uiState.searchToolbar = editorSearch.plugin.settings.searchToolbar ?? defaultToolbar("search");
    uiState.replaceToolbar = editorSearch.plugin.settings.replaceToolbar ?? defaultToolbar("replace");
    uiState.historyEnabled = editorSearch.plugin.settings.enableHistory;
    uiState.autoDock = editorSearch.plugin.settings.finderAutoDock ?? false;
}
// Derive the spacer from the current controls, never from the row/input widths:
// the spacer itself contributes to those widths and would keep an old wide count alive.
// Custom toolbars use CSS grid; mobile and reading layouts need no spacer.
function alignRows(node: HTMLElement, _layout: unknown) {
    const win = node.ownerDocument.defaultView;
    const count = node.querySelector<HTMLElement>(".nya-tip");
    const searchActions = node.querySelector<HTMLElement>(".finder-act");
    const replaceActions = node.querySelector<HTMLElement>(".replacer-act");
    const replacementControls = replaceActions?.querySelector<HTMLElement>(".nya-toolbar");
    const outerWidth = (element: HTMLElement) => {
        const style = win!.getComputedStyle(element);
        return element.getBoundingClientRect().width
            + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
    };
    const measure = () => {
        if (isMobile || uiState.readingMode || isCollapsed() || customToolbar() || !win || !count || !searchActions || !replaceActions || !replacementControls)
            return;
        const width = searchActions.getBoundingClientRect().width;
        if (!width || !count.getBoundingClientRect().width || !replacementControls.getBoundingClientRect().width)
            return;
        const replaceStyle = win.getComputedStyle(replaceActions);
        const replaceMargins = (parseFloat(replaceStyle.marginLeft) || 0) + (parseFloat(replaceStyle.marginRight) || 0);
        const offset = Math.max(0, Math.round((outerWidth(count) + outerWidth(searchActions)
            - outerWidth(replacementControls) - replaceMargins) * 100) / 100);
        if (offset !== uiState.replaceOffset)
            uiState.replaceOffset = offset;
        if (width !== uiState.searchActionsWidth)
            uiState.searchActionsWidth = width;
    };
    const observer = !isMobile && win && "ResizeObserver" in win ? new win.ResizeObserver(measure) : undefined;
    for (const element of [count, searchActions, replacementControls]) {
        if (element)
            observer?.observe(element, { box: "border-box" });
    }
    win?.addEventListener("resize", measure);
    measure();
    return { update: measure, destroy() { observer?.disconnect(); win?.removeEventListener("resize", measure); } };
}
const runToolbarAction = (action: ToolbarAction, focusQuery = true) => {
    if (action === "regex")
        toggleRegexMode(focusQuery);
    else if (action === "case")
        toggleMatchCaseMode(focusQuery);
    else if (action === "wholeWord")
        toggleWholeWordMode(focusQuery);
    else if (action === "selection")
        toggleFindInSelection();
    else if (action === "previous")
        toPreviousMatch();
    else if (action === "next")
        toNextMatch();
    else if (action === "history")
        editorSearch.openHistory();
    else if (action === "replace")
        replaceOnce();
    else if (action === "replaceAll")
        replaceAll();
};
function getSearchCache() {
    return uiState.cache;
}
function focusInput(target: "search" | "replace", afterLayout: boolean) {
    const intent = uiState.panelIntent, file = ownerView.file, reading = isReading();
    const doc = uiState.finderEl?.ownerDocument;
    const current = () => !uiState.disposed && uiState.panelIntent === intent && uiState.cache.visible && !uiState.docked
        && ownerView.file === file && isReading() === reading && uiState.finderEl?.ownerDocument === doc
        && ownerView.containerEl?.ownerDocument === doc && (target !== "replace" || (!reading && !uiState.cache.collapse));
    const focus = () => {
        if (!current())
            return;
        if (afterLayout)
            uiState.refreshPlacement?.(placementState());
        if (!current())
            return;
        const input = target === "replace" ? uiState.replaceEl : uiState.searchEl;
        if (!input?.isConnected || input.ownerDocument !== doc)
            return;
        input.focus({ preventScroll: true });
        const select = () => { if (current() && doc?.activeElement === input)
            input.select(); };
        select();
        // Immediate opening may supply a new query before bind:value flushes.
        // Reselect that rendered value, without issuing another focus request.
        if (!afterLayout)
            void tick().then(select);
    };
    if (afterLayout)
        void tick().then(focus);
    else
        focus();
}
function setVisible(flag: boolean, searchText?: string, historyIndexOverride?: number, focusTarget: "search" | "replace" = "search") {
    uiState.edgeMenu?.hide();
    const wasDocked = uiState.docked;
    uiState.positionRequest++;
    uiState.passiveEntry = false;
    uiState.docked = false;
    uiState.panelIntent++;
    uiState.cache.visible = flag;
    syncFinderVisibility();
    const settings = editorSearch.plugin.settings;
    if (uiState.cache.visible) {
        if (!uiState.scopeEnabled)
            uiState.scopeBlocked = false;
        setFindText(searchText !== undefined ? searchText : uiState.cache.search);
        focusInput(focusTarget, wasDocked || focusTarget === "replace");
        if (historyIndexOverride !== undefined)
            historyNavigation.select(uiState.cache.search, getSortedHistory());
        else
            historyNavigation.reset();
    }
    else {
        cancelEditing();
        if (uiState.scopeEnabled)
            clearScope(true);
        uiState.readingRequest++;
        uiState.readingPending = false;
        uiState.readingUnsupported = false;
        uiState.readingError = undefined;
        editorSearch.clearReadingSearch?.(ownerView);
        uiState.cache.collapse = true;
        historyNavigation.reset();
        if (settings.clearAfterHidden) {
            resetMatches(true, true);
        }
        else {
            emitChange();
        }
    }
}
// Set visible from history selection
// This function finds the position of the selected item in the sorted history
function setVisibleFromHistory(searchText: string) {
    if (isReading() ? !editorSearch.canSearchReading(ownerView) : !getEditorContext())
        return false;
    const sortedHistory = getSortedHistory();
    const index = sortedHistory.findIndex((item) => item.text === searchText);
    // Set visible with the history index
    setVisible(true, searchText, index);
    recordSearchToHistory(searchText, true);
    // Usage can reorder the list; preserve the selected entry's new position.
    historyNavigation.select(searchText, getSortedHistory());
    return true;
}
function setCollapse(flag: boolean) {
    uiState.cache.collapse = isReading() ? true : flag;
}
function showReplace(searchText?: string) {
    if (uiState.disposed || isReading())
        return;
    // Expanding a compact session must not replace its query with a selection.
    const query = uiState.docked ? undefined : searchText;
    setCollapse(false);
    // Focus the replacement input directly, never the query as an intermediate
    // target (which could scroll ancestors or briefly open the wrong keyboard).
    setVisible(true, query, undefined, "replace");
}
function toggleReplaceFromCommand() {
    if (uiState.disposed || isReading())
        return;
    if (!uiState.cache.visible || uiState.docked)
        showReplace();
    else
        toggleCollapse();
}
function resetAll() {
    cancelEditing();
    clearScope();
    uiState.positionRequest++;
    historyNavigation.reset();
    uiState.readingRequest++;
    uiState.readingPending = false;
    uiState.readingUnsupported = false;
    uiState.readingError = undefined;
    editorSearch.clearReadingSearch?.(ownerView);
    uiState.currentSearch = "";
    uiState.lastRecordedSearch = null;
    uiState.cache.search = "";
    uiState.cache.replace = "";
    uiState.cache.index = 0;
    uiState.cache.matches = [];
    uiState.cache.visible = false;
    uiState.passiveEntry = false;
    uiState.docked = false;
    uiState.panelIntent++;
    syncFinderVisibility();
    uiState.cache.collapse = true;
    uiState.cache.options = runtime.reactive({
        regexMode: false,
        caseSensitive: false,
        wholeWord: false,
    });
    emitChange();
}
function toggleVisible() {
    if (uiState.cache.visible && !uiState.docked)
        closeFinder();
    else
        setVisible(true);
}
function toggleCollapse() {
    setCollapse(!uiState.cache.collapse);
}
function isVisible() {
    return uiState.cache.visible;
}
function isDocked() { return uiState.docked; }
const onSearchChanged = (e: Event) => {
    historyNavigation.reset();
    const target = e.target as HTMLTextAreaElement;
    setFindText(target.value);
};
const replaceAll = () => {
    replaceAllMatchedText(uiState.cache.replace);
};
// All user-facing single-replace entry points share the same navigation policy.
const replaceOnce = () => {
    if (typeof editorSearch.getMatchEngine?.(ownerView).replace === "function")
        return replaceInWorker(uiState.cache.replace, false, true);
    const before = getEditorContext();
    const result = replaceText(uiState.cache.replace, false);
    const current = getEditorContext();
    const request = uiState.positionRequest;
    const advance = () => {
        if (!uiState.disposed && uiState.positionRequest === request && result.changed && !result.navigationFailed
            && result.beforeCount === result.afterCount && before && current
            && current.file === before.file && current.editor === before.editor
            && current.editorView === before.editorView && isCurrentContext(current)
            && uiState.matchedContext?.doc === current.doc && uiState.matchedQuery === queryKey()) {
            toNextMatch();
        }
    };
    if (result.navigationCompletion)
        void result.navigationCompletion.then((success) => { if (success)
            advance(); });
    else
        advance();
    return result;
};
const closeFinder = () => {
    if (!uiState.cache.visible)
        return;
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
    }
    catch (error) {
        editorSearch.plugin.reportError("search.EditorFailed", error);
    }
    finally {
        setVisible(false);
    }
};
const toggleRegexMode = (focusQuery = true) => {
    uiState.cache.options.regexMode = !uiState.cache.options.regexMode;
    if (focusQuery)
        uiState.searchEl.focus({ preventScroll: true });
    setFindText(uiState.cache.search);
};
const toggleMatchCaseMode = (focusQuery = true) => {
    uiState.cache.options.caseSensitive = !uiState.cache.options.caseSensitive;
    if (focusQuery)
        uiState.searchEl.focus({ preventScroll: true });
    setFindText(uiState.cache.search);
};
const toggleWholeWordMode = (focusQuery = true) => {
    uiState.cache.options.wholeWord = !uiState.cache.options.wholeWord;
    if (focusQuery)
        uiState.searchEl.focus({ preventScroll: true });
    setFindText(uiState.cache.search);
};
const searchKey = () => JSON.stringify([uiState.cache.search, uiState.cache.options.regexMode, uiState.cache.options.caseSensitive, uiState.cache.options.wholeWord]);
const queryKey = () => JSON.stringify([searchKey(), uiState.scopeEpoch, scopeRanges()]);
const getEditorContext = () => {
    const context = editorSearch.getEditorContext(ownerView);
    syncScope(context);
    if (!context && !isReading()) {
        uiState.cache.matches = [];
        uiState.cache.index = 0;
        uiState.matchedContext = null;
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
    if (uiState.matchedContext && (uiState.matchedContext.file !== context.file
        || uiState.matchedContext.editorView !== context.editorView))
        uiState.cache.index = 0;
    uiState.matchedContext = context;
    uiState.matchedQuery = queryKey();
    if (uiState.cache.index < 0 || uiState.cache.index >= uiState.cache.matches.length)
        uiState.cache.index = 0;
};
const emitChange = (withCache: boolean = true, extraSpec?: TransactionSpec, context: EditorContext | null = getEditorContext()) => {
    if (context && isCurrentContext(context)) {
        const { editorView } = context;
        const validMatches = uiState.matchedContext?.doc === context.doc
            && uiState.matchedContext.file === context.file && uiState.matchedContext.editorView === context.editorView
            && uiState.matchedQuery === queryKey();
        let spec: TransactionSpec = {
            annotations: finderSelection ? finderSelection.of(true) : undefined,
            effects: withCache ? [searchCacheEffect.of({
                    doc: context.doc,
                    visible: uiState.cache.visible,
                    index: uiState.cache.index,
                    matches: validMatches ? uiState.cache.matches.map((match) => ({ ...match })) : [],
                })] : [],
        };
        if (extraSpec) {
            spec = Object.assign(spec, extraSpec);
        }
        editorView.dispatch(spec);
    }
};
const setFindText = (text: string, scroll: boolean = true, activeEditor = getEditorContext(), direction = 0, synchronous = false) => {
    // Host editor-change/layout events can fire synchronously during our commit.
    // They must not cancel post-commit matching, or replay the edit.
    if (uiState.replacementTask?.committing)
        return;
    uiState.passiveEntry = false;
    if (uiState.replacementTask && !scroll && text === uiState.cache.search && replacementCurrent(uiState.replacementTask))
        return;
    if (uiState.replacementTask)
        cancelEditing();
    uiState.replacementRetry = null;
    uiState.replacementCommittedError = false;
    uiState.positionRequest++;
    uiState.statusContext = ownerView.file;
    // The view may update cache.search before the input handler.
    if (uiState.currentSearch !== text)
        uiState.lastRecordedSearch = null;
    uiState.currentSearch = text;
    uiState.cache.search = text;
    uiState.readingMode = isReading();
    const mode = uiState.readingMode ? "preview" : "source";
    if (uiState.searchMode !== mode) {
        uiState.cache.matches = [];
        uiState.cache.index = 0;
        uiState.matchedContext = null;
        uiState.searchMode = mode;
    }
    uiState.readingUnsupported = false;
    uiState.readingError = undefined;
    uiState.workerError = false;
    if (uiState.readingMode) {
        cancelEditing();
        if (!uiState.cache.visible) {
            uiState.readingRequest++;
            editorSearch.clearReadingSearch?.(ownerView);
            uiState.cache.matches = [];
            uiState.cache.index = 0;
            uiState.readingPending = false;
            return;
        }
        const request = ++uiState.readingRequest;
        if (uiState.scopeBlocked && !uiState.readingScope) {
            editorSearch.getReadingSearch(ownerView).blockScope();
            uiState.readingScope = true;
            uiState.scopeEnabled = true;
            uiState.scopeWindow = ownerView.containerEl?.ownerDocument.defaultView ?? null;
        }
        editorSearch.getReadingSearch(ownerView).search(text, uiState.cache.options, uiState.cache.index, scroll, (result) => {
            if (request !== uiState.readingRequest || !uiState.cache.visible || !isReading())
                return;
            uiState.cache.matches = result.matches;
            uiState.cache.index = result.index;
            uiState.readingPending = result.pending;
            uiState.readingUnsupported = result.unsupported;
            uiState.readingError = result.error;
            uiState.workerError = result.workerError ?? false;
            if (uiState.readingScope && result.scopeInvalid) {
                uiState.scopeEmpty = true;
                uiState.scopeBlocked = true;
            }
        }, direction);
        return;
    }
    uiState.readingRequest++;
    editorSearch.clearReadingSearch?.(ownerView);
    if (activeEditor && isCurrentContext(activeEditor)) {
        const { editor } = activeEditor;
        if (text) {
            const key = queryKey();
            const pending = uiState.editingComputation;
            const win = ownerView.containerEl?.ownerDocument.defaultView ?? null;
            if (!synchronous && pending && pending.key === key && pending.window === win
                && pending.context.doc === activeEditor.doc && pending.context.file === activeEditor.file
                && pending.context.editor === activeEditor.editor && pending.context.editorView === activeEditor.editorView) {
                if (scroll) {
                    pending.scroll = true;
                    pending.direction += direction;
                }
                return;
            }
            if (uiState.editingComputation)
                cancelEditing();
            uiState.readingPending = false;
            const content = editor.getValue();
            const apply = (result: MatchResult, shouldScroll: boolean, requestedDirection: number) => {
                if (uiState.disposed || !isCurrentContext(activeEditor) || queryKey() !== key
                    || (ownerView.containerEl?.ownerDocument.defaultView ?? null) !== win || win?.closed)
                    return;
                uiState.readingPending = false;
                if (result.status === "cancelled")
                    return;
                if (result.status === "failed") {
                    uiState.cache.matches = [];
                    uiState.cache.index = 0;
                    uiState.matchedContext = null;
                    uiState.readingError = "failed";
                    uiState.workerError = true;
                    emitChange();
                    return;
                }
                uiState.cache.matches = result.matches;
                rememberMatches(activeEditor);
                if (uiState.cache.matches.length && requestedDirection)
                    uiState.cache.index = ((uiState.cache.index + requestedDirection)
                        % uiState.cache.matches.length + uiState.cache.matches.length) % uiState.cache.matches.length;
                if (uiState.cache.matches.length && shouldScroll)
                    scrollToMatch(activeEditor);
                else {
                    if (!uiState.cache.matches.length)
                        uiState.cache.index = 0;
                    emitChange(true, undefined, activeEditor);
                }
            };
            if (!synchronous && editorSearch.getMatchEngine)
                uiState.editingEngine = editorSearch.getMatchEngine(ownerView);
            const ranges = scopeRanges();
            const result = !synchronous && uiState.editingEngine ? uiState.editingEngine.match(content, text, uiState.cache.options, ranges)
                : { status: "completed" as const, matches: findTextOffsets(content, text, uiState.cache.options.regexMode, uiState.cache.options.caseSensitive, uiState.cache.options.wholeWord, ranges), synchronous: true };
            if (result instanceof Promise) {
                const computation = { context: activeEditor, key, window: win, scroll, direction };
                uiState.editingComputation = computation;
                uiState.readingPending = true;
                uiState.cache.matches = [];
                emitChange(true, undefined, activeEditor);
                void result.then((value) => {
                    if (uiState.editingComputation !== computation)
                        return;
                    uiState.editingComputation = null;
                    apply(value, computation.scroll, computation.direction);
                }).catch((error) => {
                    if (uiState.editingComputation !== computation)
                        return;
                    uiState.editingComputation = null;
                    apply({ status: "failed", error }, false, 0);
                });
            }
            else
                apply(result, scroll, direction);
        }
        else {
            resetMatches(true);
        }
    }
    else {
        cancelEditing();
        uiState.readingPending = false;
        uiState.cache.matches = [];
        uiState.cache.index = 0;
        uiState.matchedContext = null;
    }
};
const navigateMatch = (direction: number) => {
    if (uiState.replacementTask) {
        cancelEditing();
        uiState.readingPending = false;
    }
    if (isReading()) {
        setFindText(uiState.cache.search, true, null, direction);
        if (uiState.cache.visible && !uiState.readingUnsupported && !uiState.readingError && uiState.cache.search)
            recordSearchToHistory(uiState.cache.search);
        return;
    }
    const context = getEditorContext();
    if (!context)
        return;
    if (uiState.matchedContext?.doc !== context.doc || uiState.matchedContext.file !== context.file
        || uiState.matchedContext.editorView !== context.editorView || uiState.matchedQuery !== queryKey() || uiState.editingComputation) {
        setFindText(uiState.cache.search, true, context, direction);
        if (uiState.cache.search)
            recordSearchToHistory(uiState.cache.search);
        return;
    }
    if (uiState.cache.index < 0 || uiState.cache.index >= uiState.cache.matches.length)
        uiState.cache.index = 0;
    const matchSize = uiState.cache.matches.length;
    uiState.cache.index = matchSize === 0 ? 0 : (uiState.cache.index + direction + matchSize) % matchSize;
    scrollToMatch(context);
    // Saving is not part of editor navigation and must not delay it.
    if (uiState.cache.search) {
        recordSearchToHistory(uiState.cache.search);
    }
};
const toNextMatch = () => navigateMatch(1);
const toPreviousMatch = () => navigateMatch(-1);
const scrollToMatch = (activeEditor = getEditorContext(), afterReplacement = false) => {
    if (uiState.disposed)
        return false;
    if (uiState.replacementTask?.phase === "prepare") {
        cancelEditing();
        uiState.readingPending = false;
    }
    if (isReading()) {
        setFindText(uiState.cache.search, true);
        return true;
    }
    try {
        if (!activeEditor || !isCurrentContext(activeEditor))
            return false;
        if (uiState.matchedContext?.doc !== activeEditor.doc || uiState.matchedQuery !== queryKey()
            || uiState.matchedContext.file !== activeEditor.file || uiState.matchedContext.editorView !== activeEditor.editorView) {
            setFindText(uiState.cache.search, true, activeEditor);
            return false;
        }
        const matched = uiState.cache.matches[uiState.cache.index];
        if (!matched)
            return true;
        const request = ++uiState.positionRequest;
        const requestQuery = queryKey();
        const requestIndex = uiState.cache.index;
        const visible = uiState.cache.visible;
        const { editor, view } = activeEditor;
        const { from, to } = matched;
        editor.scrollIntoView({ from: editor.offsetToPos(from), to: editor.offsetToPos(to) }, true);
        const state = view.getState();
        const { sourceModeWhenSearch, moveCursorToMatch } = editorSearch.plugin.settings;
        if (sourceModeWhenSearch && state.mode === "source")
            state.source = true;
        const currentRequest = () => !uiState.disposed && uiState.positionRequest === request
            && uiState.cache.visible === visible && queryKey() === requestQuery && uiState.cache.index === requestIndex
            && ownerView.file === activeEditor.file;
        const complete = () => {
            if (!currentRequest())
                return false;
            if (!isCurrentContext(activeEditor)) {
                // Mode switches may rebuild the editor. Refresh, but never select
                // using old offsets or advance a replacement in the new editor.
                const rebuilt = getEditorContext();
                if (rebuilt && rebuilt.editorView !== activeEditor.editorView)
                    matchAgain(false);
                return false;
            }
            emitChange(true, { selection: moveCursorToMatch ? { anchor: from, head: to } : undefined }, activeEditor);
            return true;
        };
        const changed = view.setState(state, { history: false });
        if (changed && typeof changed.then === "function") {
            return Promise.resolve(changed).then(complete).catch((error) => {
                if (currentRequest() && getEditorContext())
                    editorSearch.plugin.reportError(afterReplacement ? "search.ReplacedNavigationFailed" : "search.EditorFailed", error);
                return false;
            });
        }
        return complete();
    }
    catch (error) {
        editorSearch.plugin.reportError(afterReplacement ? "search.ReplacedNavigationFailed" : "search.EditorFailed", error);
        return false;
    }
};
const resetMatches = (clearSearch = false, clearReplace = false) => {
    cancelEditing();
    uiState.positionRequest++;
    uiState.readingRequest++;
    uiState.readingPending = false;
    uiState.readingUnsupported = false;
    uiState.readingError = undefined;
    editorSearch.clearReadingSearch?.(ownerView);
    uiState.cache.matches = [];
    uiState.cache.index = 0;
    if (clearSearch) {
        historyNavigation.reset();
        uiState.cache.search = "";
        uiState.currentSearch = "";
        uiState.lastRecordedSearch = null;
    }
    if (clearReplace)
        uiState.cache.replace = "";
    emitChange();
};
const adjustReplaceText = (text: string) => {
    if (editorSearch.plugin.settings.useEscapeCharInReplace) {
        // Decode once without reserving any character from the user's text.
        return text.replace(/\\([\\nt])/g, (_, escaped: string) => escaped === "n" ? "\n" : escaped === "t" ? "\t" : "\\");
    }
    return text;
};
const prepareReplacement = (inputText: string) => {
    if (isReading())
        return null;
    cancelEditing();
    uiState.readingPending = false;
    const activeEditor = getEditorContext();
    if (!activeEditor) {
        uiState.cache.matches = [];
        uiState.cache.index = 0;
        return null;
    }
    // Hidden finders do not track editor changes. Never use cached offsets
    // for a write: recalculate against the editor captured for this action.
    const replacements = prepareReplacements(activeEditor.editor.getValue(), uiState.cache.search, uiState.cache.options.regexMode ? adjustReplaceText(inputText) : inputText, uiState.cache.options.regexMode, uiState.cache.options.caseSensitive, uiState.cache.options.wholeWord, scopeRanges());
    uiState.cache.matches = replacements.matches;
    rememberMatches(activeEditor);
    if (uiState.cache.matches.length === 0) {
        emitChange(true, undefined, activeEditor);
    }
    return { activeEditor, replacements };
};
const replaceText = (inputText: string, all: boolean): ReplaceResult => {
    if (uiState.docked)
        expandFinder();
    const prepared = prepareReplacement(inputText);
    const { matches, search, replace, index } = uiState.cache;
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
        if (!changes.length)
            return result;
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
                if (typeof positioned === "boolean")
                    result.navigationFailed = !positioned;
                else
                    result.navigationCompletion = positioned.then((success) => {
                        result.navigationFailed = !success;
                        return success;
                    });
            }
            else {
                uiState.cache.matches = [];
                uiState.cache.index = 0;
                uiState.matchedContext = null;
            }
        }
        catch (error) {
            result.navigationFailed = true;
            // The write succeeded. A positioning failure must not invite retrying it.
            editorSearch.plugin.reportError("search.ReplacedNavigationFailed", error);
        }
        result.afterCount = uiState.cache.matches.length;
    }
    return result;
};
const replacementCurrent = (task: ReplacementTask) => !uiState.disposed && uiState.replacementTask === task
    && !isReading() && isCurrentContext(task.context) && queryKey() === task.key
    && task.context.file?.path === task.path
    && (ownerView.containerEl?.ownerDocument.defaultView ?? null) === task.window && !task.window?.closed
    && (task.phase === "committed" || (uiState.cache.replace === task.replace
        && editorSearch.plugin.settings.useEscapeCharInReplace === task.escape));
const replaceInWorker = (inputText: string, all: boolean, advance = false, synchronous = false): ReplaceResult | Promise<ReplaceResult> => {
    const result: ReplaceResult = { changed: false, changeCount: 0, search: uiState.cache.search, replace: uiState.cache.replace,
        beforeCount: 0, afterCount: 0, status: "cancelled" };
    if (uiState.disposed || isReading())
        return result;
    if (uiState.docked)
        expandFinder();
    const context = getEditorContext();
    if (!context)
        return result;
    const index = uiState.matchedContext && (uiState.matchedContext.file !== context.file || uiState.matchedContext.editorView !== context.editorView) ? 0 : uiState.cache.index;
    cancelEditing(true);
    uiState.positionRequest++;
    uiState.editingEngine = editorSearch.getMatchEngine(ownerView);
    const task: ReplacementTask = { context, key: queryKey(), window: ownerView.containerEl?.ownerDocument.defaultView ?? null,
        path: context.file?.path, replace: uiState.cache.replace, escape: editorSearch.plugin.settings.useEscapeCharInReplace,
        phase: "prepare", committing: false, scopeEpoch: uiState.scopeEpoch, searchKey: searchKey() };
    uiState.replacementTask = task;
    uiState.readingError = undefined;
    uiState.workerError = false;
    uiState.replacementCommittedError = false;
    const options = { ...uiState.cache.options };
    const replacement = options.regexMode ? adjustReplaceText(inputText) : inputText;
    const failed = (error: unknown, committed: boolean) => {
        result.status = "failed";
        result.error = error;
        result.navigationFailed = committed;
        uiState.readingPending = false;
        uiState.readingError = "failed";
        uiState.workerError = true;
        uiState.replacementCommittedError = committed;
        uiState.replacementTask = null;
        if (committed) {
            // Never offer to replay a write which already committed.
            uiState.replacementRetry = null;
            editorSearch.plugin.reportError("search.ReplacedNavigationFailed", error);
        }
        else {
            uiState.replacementRetry = (sync) => {
                if (!uiState.disposed && isCurrentContext(context) && queryKey() === task.key && uiState.cache.replace === task.replace
                    && editorSearch.plugin.settings.useEscapeCharInReplace === task.escape
                    && context.file?.path === task.path
                    && (ownerView.containerEl?.ownerDocument.defaultView ?? null) === task.window) {
                    void replaceInWorker(inputText, all, advance, sync);
                }
                else
                    setFindText(uiState.cache.search);
            };
        }
    };
    const finishPosition = (matched: MatchResult): boolean | Promise<boolean> => {
        if (!replacementCurrent(task)) {
            if (uiState.replacementTask === task) {
                uiState.replacementTask = null;
                uiState.readingPending = false;
            }
            return false;
        }
        if (matched.status === "failed") {
            failed(matched.error, true);
            return false;
        }
        if (matched.status === "cancelled") {
            uiState.replacementTask = null;
            uiState.readingPending = false;
            return false;
        }
        uiState.cache.matches = matched.matches;
        rememberMatches(task.context);
        result.afterCount = matched.matches.length;
        uiState.readingPending = false;
        uiState.replacementTask = null;
        let positioned: boolean | Promise<boolean>;
        try {
            positioned = scrollToMatch(task.context, true);
        }
        catch (error) {
            failed(error, true);
            return false;
        }
        const request = uiState.positionRequest;
        const complete = (success: boolean) => {
            result.navigationFailed = !success;
            if (success && advance && result.beforeCount === result.afterCount && !uiState.disposed
                && uiState.positionRequest === request && isCurrentContext(task.context) && queryKey() === task.key
                && (ownerView.containerEl?.ownerDocument.defaultView ?? null) === task.window)
                toNextMatch();
            return success;
        };
        return positioned instanceof Promise ? positioned.then(complete) : complete(positioned);
    };
    const apply = (prepared: MatchResult): ReplaceResult => {
        if (!replacementCurrent(task)) {
            if (uiState.replacementTask === task) {
                uiState.replacementTask = null;
                uiState.readingPending = false;
            }
            return result;
        }
        if (prepared.status === "failed") {
            failed(prepared.error, false);
            return result;
        }
        if (prepared.status === "cancelled") {
            uiState.replacementTask = null;
            uiState.readingPending = false;
            return result;
        }
        uiState.cache.matches = prepared.matches;
        rememberMatches(context);
        result.beforeCount = result.afterCount = prepared.matches.length;
        const changes = prepared.changes ?? [];
        const ranges = scopeRanges();
        if (ranges && changes.some(({ from, to }) => !ranges.some((range) => from >= range.from && to <= range.to))) {
            failed(new Error("Replacement outside search scope"), false);
            return result;
        }
        if (!changes.length) {
            uiState.replacementTask = null;
            uiState.readingPending = false;
            result.status = "completed";
            emitChange(true, undefined, context);
            return result;
        }
        // All candidates are for the captured immutable doc, verified above.
        // Commit exactly once, synchronously; no main-thread regex revalidation.
        try {
            task.committing = true;
            context.editorView.dispatch({ changes });
        }
        catch (error) {
            task.committing = false;
            // Host callbacks can throw after CodeMirror has committed the state.
            // Report that boundary, never invite a second write.
            const committed = context.editorView.state.doc !== context.doc;
            result.changed = committed;
            result.changeCount = committed ? changes.length : 0;
            failed(error, committed);
            uiState.replacementRetry = null;
            return result;
        }
        finally {
            task.committing = false;
        }
        result.changed = true;
        result.changeCount = changes.length;
        result.status = "completed";
        task.phase = "committed";
        const current = getEditorContext();
        if (!current || current.file !== context.file || current.editor !== context.editor || current.editorView !== context.editorView
            || uiState.replacementTask !== task || uiState.scopeEpoch !== task.scopeEpoch || searchKey() !== task.searchKey) {
            result.navigationFailed = true;
            uiState.replacementTask = null;
            uiState.readingPending = false;
            return result;
        }
        task.context = current;
        task.key = queryKey();
        uiState.cache.matches = [];
        uiState.readingPending = true;
        try {
            emitChange(true, undefined, current);
            const matched = synchronous ? { status: "completed" as const, matches: findTextOffsets(current.doc.toString(), uiState.cache.search, options.regexMode, options.caseSensitive, options.wholeWord, scopeRanges()), synchronous: true }
                : uiState.editingEngine!.match(current.doc.toString(), uiState.cache.search, options, scopeRanges());
            const positioned = matched instanceof Promise ? matched.then(finishPosition) : finishPosition(matched);
            if (positioned instanceof Promise)
                result.navigationCompletion = positioned.then((success) => {
                    result.navigationFailed = !success;
                    return success;
                }).catch((error) => {
                    if (replacementCurrent(task))
                        failed(error, true);
                    result.navigationFailed = true;
                    return false;
                });
            else
                result.navigationFailed = !positioned;
        }
        catch (error) {
            if (replacementCurrent(task))
                failed(error, true);
        }
        return result;
    };
    try {
        const source = context.doc.toString();
        let prepared: MatchResult | Promise<MatchResult>;
        if (synchronous) {
            const replacements = prepareReplacements(source, uiState.cache.search, replacement, options.regexMode, options.caseSensitive, options.wholeWord, scopeRanges());
            const selectedIndex = index >= 0 && index < replacements.matches.length ? index : 0;
            const selected = all ? undefined : replacements.one(selectedIndex);
            prepared = { status: "completed", synchronous: true, matches: replacements.matches,
                changes: all ? replacements.all() : selected ? [selected] : [] };
        }
        else
            prepared = uiState.editingEngine.replace!(source, uiState.cache.search, replacement, options, index, all, scopeRanges());
        if (prepared instanceof Promise) {
            uiState.readingPending = true;
            return prepared.then(apply).catch((error) => { if (replacementCurrent(task))
                failed(error, task.phase === "committed"); return result; });
        }
        return apply(prepared);
    }
    catch (error) {
        if (replacementCurrent(task))
            failed(error, task.phase === "committed");
        return result;
    }
};
const replaceMatchedText = (inputText: string): ReplaceResult | Promise<ReplaceResult> => typeof editorSearch.getMatchEngine?.(ownerView).replace === "function" ? replaceInWorker(inputText, false) : replaceText(inputText, false);
const replaceAllMatchedText = (inputText: string): ReplaceResult | Promise<ReplaceResult> => typeof editorSearch.getMatchEngine?.(ownerView).replace === "function" ? replaceInWorker(inputText, true) : replaceText(inputText, true);
const onFinderKeyDown = (e: KeyboardEvent) => {
    if (isComposingInput(e))
        return;
    const { enableInputHotkeys, enableHistory } = editorSearch.plugin.settings;
    // Use sorted history for navigation
    const sortedHistory = getSortedHistory();
    // Handle History Navigation
    if (enableHistory && e.code === "ArrowUp") {
        const cursorPosition = uiState.searchEl.selectionStart;
        const value = uiState.searchEl.value;
        const firstLineEnd = value.indexOf("\n");
        // Only navigate history if cursor is on the first line
        if (firstLineEnd === -1 || cursorPosition <= firstLineEnd) {
            const text = historyNavigation.move(1, uiState.cache.search, sortedHistory);
            if (text !== undefined) {
                e.preventDefault();
                setFindText(text);
            }
        }
        return;
    }
    if (enableHistory && e.code === "ArrowDown") {
        const cursorPosition = uiState.searchEl.selectionStart;
        const value = uiState.searchEl.value;
        const lastLineStart = value.lastIndexOf("\n");
        // Only navigate history if cursor is on the last line
        if (lastLineStart === -1 || cursorPosition > lastLineStart) {
            const text = historyNavigation.move(-1, uiState.cache.search, sortedHistory);
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
    if (isComposingInput(e))
        return;
    const enableInputHotkeys = editorSearch.plugin.settings.enableInputHotkeys;
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
const matchAgain = (scroll = true) => {
    syncFinderVisibility();
    if (uiState.passiveEntry) {
        uiState.readingMode = isReading();
        return;
    }
    if (uiState.replacementTask?.committing || (!scroll && uiState.replacementTask && replacementCurrent(uiState.replacementTask)))
        return;
    const { search } = uiState.cache;
    if (uiState.cache.visible) {
        setFindText(search, scroll);
    }
    else {
        cancelEditing();
        uiState.readingRequest++;
        uiState.readingMode = isReading();
        uiState.readingPending = false;
        editorSearch.clearReadingSearch?.(ownerView);
        uiState.cache.matches = [];
        uiState.cache.index = 0;
        uiState.matchedContext = null;
    }
};
const retrySynchronously = () => {
    if (uiState.replacementRetry) {
        uiState.replacementRetry(true);
        return;
    }
    if (isReading())
        editorSearch.getReadingSearch(ownerView).retrySynchronously();
    setFindText(uiState.cache.search, true, getEditorContext(), 0, true);
};
const onReplaceChanged = () => {
    if (uiState.replacementTask?.phase === "prepare") {
        cancelEditing();
        uiState.readingPending = false;
    }
    uiState.replacementRetry = null;
};
const retrySearch = () => {
    if (uiState.replacementRetry)
        uiState.replacementRetry(false);
    else
        setFindText(uiState.cache.search);
};

refreshToolbar();
return { state: uiState, findInSelection, findInCapturedSelection, findSelectedText, toggleFindInSelection, hasSelectionScope, dockFinder, expandFinder, showFloatingEntry, resetFinderPosition, refreshToolbar, getSearchCache, setVisible, setVisibleFromHistory, setCollapse, showReplace, toggleReplaceFromCommand, resetAll, toggleVisible, toggleCollapse, isVisible, isDocked, replaceOnce, closeFinder, toggleRegexMode, toggleMatchCaseMode, toggleWholeWordMode, getEditorContext, emitChange, setFindText, toNextMatch, toPreviousMatch, scrollToMatch, resetMatches, replaceMatchedText, replaceAllMatchedText, matchAgain, isMobile, iconSize, onSearchChanged, onReplaceChanged, onFinderKeyDown, enterOnReplacer, defaultEnterEvent, runToolbarAction, retrySynchronously, retrySearch, expandFromClick, dockMenu, moveFinderKey, guardHiddenFocus, positionFinder, alignRows, dragToMove, trackComposition, syncFinderVisibility, placementState };
}
export type FinderSession = ReturnType<typeof createFinderSession>;
