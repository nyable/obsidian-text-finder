import type { FinderHost, FinderPreferences, ScopeSelection } from "./finder-host";
import type { EditorPort, EditingSnapshot as EditorContext } from "./editor-port";
import { findTextOffsets } from "../../../core/search/text-matching";
import { HistoryNavigation } from "../../history";
import type { MatchResult } from "../../../core/search/match-protocol";
import type { ReplaceResult, SearchCache } from "../../../core/search/types";
import { defaultToolbar, type ToolbarAction } from "../model/toolbar";
import { searchIdentity, queryIdentity, decodeReplacementEscapes } from "../model/query-identity";
import type { PresentationPort } from "./presentation-port";
import { runReplacement, type ReplacementTask } from "./replacement-operation";
import { createSearchScope } from "./search-scope";
import { QueryLane } from "./query-lane";
import { navigateToMatch } from "./match-navigation";
import { Disposables } from "../../../shared/lifecycle/disposables";
export interface FinderRuntime {
	presentation: PresentationPort;
	editor: EditorPort;
	reactive<T extends object>(value: T): T;
	tick(): Promise<void>;
	onMount(callback: () => (() => void) | void): void;
}
export interface FinderState {
	matchedContext: EditorContext | null;
	matchedQuery: string;
	readingMode: boolean;
	readingPending: boolean;
	readingUnsupported: boolean;
	readingError: "failed" | "timeout" | undefined;
	readingRequest: number;
	workerError: boolean;
	replacementTask: ReplacementTask | null;
	replacementRetry: ((synchronous: boolean) => void) | null;
	replacementCommittedError: boolean;
	positionRequest: number;
	disposed: boolean;
	docked: boolean;
	passiveEntry: boolean;
	panelIntent: number;
	dockSide: "left" | "right";
	autoDock: boolean;
	searchMode: string;
	statusContext: unknown;
	scopeEnabled: boolean;
	scopeBlocked: boolean;
	scopeEmpty: boolean;
	scopeEpoch: number;
	scopeContext: EditorContext | null;
	scopeWindow: object | null;
	readingScope: boolean;
	cache: SearchCache;
	lastRecordedSearch: string | null;
	currentSearch: string;
	searchToolbar: FinderPreferences["searchToolbar"];
	replaceToolbar: FinderPreferences["replaceToolbar"];
	historyEnabled: boolean;
}
/** One owner-local session. Host objects retain raw identity; only presentation state is observable. */
export function createFinderSession(editorSearch: FinderHost, runtime: FinderRuntime) {
	const preferences = editorSearch.preferences();
	const cache: SearchCache = runtime.reactive({
		search: "",
		replace: "",
		index: 0,
		matches: [],
		visible: false,
		collapse: true,
		options: runtime.reactive({
			regexMode: preferences.defaultRegexMode ?? false,
			caseSensitive: preferences.defaultCaseSensitive ?? false,
			wholeWord: preferences.defaultWholeWord ?? false,
		}),
	});
	const uiState = runtime.reactive<FinderState>({
		matchedContext: null,
		matchedQuery: "",
		readingMode: false,
		readingPending: false,
		readingUnsupported: false,
		readingError: undefined,
		readingRequest: 0,
		workerError: false,
		replacementTask: null,
		replacementRetry: null,
		replacementCommittedError: false,
		positionRequest: 0,
		disposed: false,
		docked: false,
		passiveEntry: false,
		panelIntent: 0,
		dockSide: preferences.finderDockSide ?? "right",
		autoDock: preferences.finderAutoDock ?? false,
		searchMode: "source",
		statusContext: runtime.editor.ownerFile(),
		scopeEnabled: false,
		scopeBlocked: false,
		scopeEmpty: false,
		scopeEpoch: 0,
		scopeContext: null,
		scopeWindow: null,
		readingScope: false,
		cache,
		lastRecordedSearch: null,
		currentSearch: "",
		searchToolbar: defaultToolbar("search"),
		replaceToolbar: defaultToolbar("replace"),
		historyEnabled: true,
	});
	const { tick, onMount } = runtime;
	const reportEditorError = (error: unknown) =>
		editorSearch.reportError("search.EditorFailed", error);
	const queryLane = new QueryLane(reportEditorError);
	const cancelEditing = (preserveIdle = false) => {
		const replacementBusy = !!uiState.replacementTask;
		uiState.replacementTask = null;
		uiState.replacementRetry = null;
		queryLane.cancel(preserveIdle, replacementBusy);
	};
	const isReading = () => editorSearch.mode() === "preview";
	const scope = createSearchScope(
		uiState,
		editorSearch,
		runtime.editor,
		() => getEditorContext(),
		cancelEditing,
		() => {
			uiState.positionRequest++;
		},
		() => {
			uiState.cache.index = 0;
		},
	);
	const clearScope = scope.clear,
		syncScope = scope.sync,
		scopeRanges = scope.ranges,
		activateScope = scope.activate;
	function findInSelection() {
		if (!activateScope()) return false;
		setVisible(true);
		return true;
	}
	/** Caller validates the owner/document snapshot before passing menu boundaries. */
	function findInCapturedSelection(selection: ScopeSelection) {
		if (!activateScope(selection)) return false;
		setVisible(true);
		return true;
	}
	function findSelectedText(text: string) {
		if (uiState.disposed || !text) return false;
		clearScope();
		uiState.cache.index = 0;
		setVisible(true, text);
		return true;
	}
	function toggleFindInSelection() {
		if (uiState.scopeEnabled || uiState.scopeBlocked) {
			clearScope();
			setFindText(uiState.cache.search);
		} else if (activateScope()) setFindText(uiState.cache.search);
	}
	function hasSelectionScope() {
		return uiState.scopeEnabled || uiState.scopeBlocked;
	}
	// Search History
	const historyNavigation = new HistoryNavigation();
	// Track usage separately from bind:value to identify consecutive query cycles.
	// Get sorted history based on user preference
	const getSortedHistory = () => editorSearch.history.sorted();
	onMount(() => {
		const unsubscribe = editorSearch.history.subscribe(() => {
			if (!editorSearch.preferences().enableHistory) {
				historyNavigation.reset();
				return;
			}
			const text = historyNavigation.reconcile(getSortedHistory());
			if (text !== undefined) setFindText(text, false);
		});
		return () => {
			if (uiState.disposed) return;
			uiState.disposed = true;
			uiState.positionRequest++;
			const cleanup = new Disposables();
			cleanup.add(unsubscribe);
			cleanup.add(clearScope);
			cleanup.add(() => cancelEditing());
			cleanup.add(() => runtime.presentation.hideMenu());
			cleanup.dispose();
		};
	});
	// Continuous navigation counts once; explicit history reuse starts a new use.
	const recordSearchToHistory = (searchText: string, force = false) => {
		if (
			editorSearch.history.record(
				searchText,
				force || uiState.lastRecordedSearch !== searchText,
			)
		) {
			uiState.lastRecordedSearch = searchText;
		}
	};
	const syncFinderVisibility = () => {
		runtime.presentation.sync({
			visible: uiState.cache.visible,
			docked: uiState.docked,
			side: uiState.dockSide,
			autoDock: uiState.autoDock,
		});
	};
	function dockFinder(side: "left" | "right" = uiState.dockSide) {
		if (!uiState.cache.visible || uiState.replacementTask || uiState.disposed) return false;
		// Avoid queued navigation selecting/scrolling text after the user asks to
		// read it unobstructed; matching itself continues and keeps highlights.
		uiState.positionRequest++;
		queryLane.pauseNavigation();
		if (isReading()) editorSearch.reading().pauseNavigation();
		uiState.docked = true;
		uiState.dockSide = side;
		const intent = ++uiState.panelIntent;
		runtime.presentation.blur();
		syncFinderVisibility();
		void tick()
			.then(() => {
				if (
					!uiState.disposed &&
					uiState.panelIntent === intent &&
					uiState.cache.visible &&
					uiState.docked
				) {
					runtime.presentation.refresh();
					runtime.presentation.focusMarker();
				}
			})
			.catch(reportEditorError);
		return true;
	}
	function expandFinder() {
		if (!uiState.cache.visible || uiState.disposed) return;
		if (uiState.passiveEntry && !editorSearch.activate()) return;
		const activate = uiState.passiveEntry;
		uiState.passiveEntry = false;
		const intent = ++uiState.panelIntent;
		uiState.docked = false;
		syncFinderVisibility();
		if (activate) setFindText(uiState.cache.search, false);
		void tick()
			.then(() => {
				if (
					!uiState.disposed &&
					uiState.panelIntent === intent &&
					uiState.cache.visible &&
					!uiState.docked
				)
					runtime.presentation.refresh();
			})
			.catch(reportEditorError);
		// Do not focus/select the query: tapping the edge tab must not open a keyboard.
	}
	function showFloatingEntry() {
		if (uiState.disposed || uiState.cache.visible) return;
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
		const intent = ++uiState.panelIntent,
			file = runtime.editor.ownerFile(),
			doc = runtime.presentation.identity();
		syncFinderVisibility();
		// The first synchronous measurement can precede the compact DOM/layout.
		// Re-measure without resetting a marker the user has already moved.
		void tick()
			.then(() => {
				if (
					!uiState.disposed &&
					uiState.panelIntent === intent &&
					runtime.editor.ownerFile() === file &&
					runtime.presentation.identity() === doc &&
					uiState.cache.visible &&
					uiState.docked &&
					uiState.passiveEntry
				) {
					runtime.presentation.refresh();
				}
			})
			.catch(reportEditorError);
		// Unlike dockFinder(), do not focus the marker or initiate matching.
	}
	function resetFinderPosition() {
		if (uiState.docked && !uiState.passiveEntry) expandFinder();
		runtime.presentation.resetPosition();
	}
	function refreshToolbar() {
		uiState.searchToolbar =
			editorSearch.preferences().searchToolbar ?? defaultToolbar("search");
		uiState.replaceToolbar =
			editorSearch.preferences().replaceToolbar ?? defaultToolbar("replace");
		uiState.historyEnabled = editorSearch.preferences().enableHistory;
		uiState.autoDock = editorSearch.preferences().finderAutoDock ?? false;
	}
	const runToolbarAction = (action: ToolbarAction, focusQuery = true) => {
		if (action === "regex") toggleRegexMode(focusQuery);
		else if (action === "case") toggleMatchCaseMode(focusQuery);
		else if (action === "wholeWord") toggleWholeWordMode(focusQuery);
		else if (action === "selection") toggleFindInSelection();
		else if (action === "previous") toPreviousMatch();
		else if (action === "next") toNextMatch();
		else if (action === "history") editorSearch.openHistory();
		else if (action === "replace")
			void Promise.resolve(replaceOnce()).catch((error) =>
				editorSearch.reportError("search.EditorFailed", error),
			);
		else if (action === "replaceAll") replaceAll();
	};
	function getSearchCache(): Readonly<Omit<SearchCache, "options" | "matches">> & {
		readonly options: Readonly<SearchCache["options"]>;
		readonly matches: readonly Readonly<SearchCache["matches"][number]>[];
	} {
		return { ...uiState.cache, options: { ...uiState.cache.options } };
	}
	function focusInput(target: "search" | "replace", afterLayout: boolean) {
		const intent = uiState.panelIntent,
			file = runtime.editor.ownerFile(),
			reading = isReading();
		const doc = runtime.presentation.identity();
		const current = () =>
			!uiState.disposed &&
			uiState.panelIntent === intent &&
			uiState.cache.visible &&
			!uiState.docked &&
			runtime.editor.ownerFile() === file &&
			isReading() === reading &&
			runtime.presentation.identity() === doc &&
			(target !== "replace" || (!reading && !uiState.cache.collapse));
		runtime.presentation.focusInput(target, afterLayout, current);
	}
	function setVisible(
		flag: boolean,
		searchText?: string,
		historyIndexOverride?: number,
		focusTarget: "search" | "replace" = "search",
	) {
		runtime.presentation.hideMenu();
		const wasDocked = uiState.docked;
		uiState.positionRequest++;
		uiState.passiveEntry = false;
		uiState.docked = false;
		uiState.panelIntent++;
		uiState.cache.visible = flag;
		syncFinderVisibility();
		const settings = editorSearch.preferences();
		if (uiState.cache.visible) {
			if (!uiState.scopeEnabled) uiState.scopeBlocked = false;
			setFindText(searchText !== undefined ? searchText : uiState.cache.search);
			focusInput(focusTarget, wasDocked || focusTarget === "replace");
			if (historyIndexOverride !== undefined)
				historyNavigation.select(uiState.cache.search, getSortedHistory());
			else historyNavigation.reset();
		} else {
			cancelEditing();
			if (uiState.scopeEnabled) clearScope(true);
			uiState.readingRequest++;
			uiState.readingPending = false;
			uiState.readingUnsupported = false;
			uiState.readingError = undefined;
			editorSearch.clearReading();
			uiState.cache.collapse = true;
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
	function setVisibleFromHistory(searchText: string) {
		if (isReading() ? !editorSearch.canRead() : !getEditorContext()) return false;
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
		if (uiState.disposed || isReading()) return;
		// Expanding a compact session must not replace its query with a selection.
		const query = uiState.docked ? undefined : searchText;
		setCollapse(false);
		// Focus the replacement input directly, never the query as an intermediate
		// target (which could scroll ancestors or briefly open the wrong keyboard).
		setVisible(true, query, undefined, "replace");
	}
	function toggleReplaceFromCommand() {
		if (uiState.disposed || isReading()) return;
		if (!uiState.cache.visible || uiState.docked) showReplace();
		else toggleCollapse();
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
		editorSearch.clearReading();
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
		if (uiState.cache.visible && !uiState.docked) closeFinder();
		else setVisible(true);
	}
	function toggleCollapse() {
		setCollapse(!uiState.cache.collapse);
	}
	function isVisible() {
		return uiState.cache.visible;
	}
	function isDocked() {
		return uiState.docked;
	}
	const changeQuery = (text: string) => {
		historyNavigation.reset();
		setFindText(text);
	};
	const replaceAll = () => {
		void Promise.resolve(replaceAllMatchedText(uiState.cache.replace)).catch((error) =>
			editorSearch.reportError("search.EditorFailed", error),
		);
	};
	// All user-facing single-replace entry points share the same navigation policy.
	const replaceOnce = () => replaceMatches(uiState.cache.replace, false, true);
	const closeFinder = () => {
		if (!uiState.cache.visible) return;
		try {
			const activeEditor = getEditorContext();
			if (activeEditor) {
				const { sourceModeWhenSearch } = editorSearch.preferences();
				if (sourceModeWhenSearch) {
					void Promise.resolve(runtime.editor.restoreMode(activeEditor)).catch((error) =>
						editorSearch.reportError("search.EditorFailed", error),
					);
				}
			}
		} catch (error) {
			editorSearch.reportError("search.EditorFailed", error);
		} finally {
			setVisible(false);
		}
	};
	const toggleRegexMode = (focusQuery = true) => {
		uiState.cache.options.regexMode = !uiState.cache.options.regexMode;
		if (focusQuery) runtime.presentation.focusQuery();
		setFindText(uiState.cache.search);
	};
	const toggleMatchCaseMode = (focusQuery = true) => {
		uiState.cache.options.caseSensitive = !uiState.cache.options.caseSensitive;
		if (focusQuery) runtime.presentation.focusQuery();
		setFindText(uiState.cache.search);
	};
	const toggleWholeWordMode = (focusQuery = true) => {
		uiState.cache.options.wholeWord = !uiState.cache.options.wholeWord;
		if (focusQuery) runtime.presentation.focusQuery();
		setFindText(uiState.cache.search);
	};
	const searchKey = () => searchIdentity(uiState.cache.search, uiState.cache.options);
	const queryKey = () =>
		queryIdentity(
			uiState.cache.search,
			uiState.cache.options,
			uiState.scopeEpoch,
			scopeRanges(),
		);
	const getEditorContext = () => {
		const context = runtime.editor.current();
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
		return (
			current !== null &&
			current.view === context.view &&
			current.editorView === context.editorView &&
			current.editor === context.editor &&
			current.file === context.file &&
			current.doc === context.doc
		);
	};
	const rememberMatches = (context: EditorContext) => {
		if (
			uiState.matchedContext &&
			(uiState.matchedContext.file !== context.file ||
				uiState.matchedContext.editorView !== context.editorView)
		)
			uiState.cache.index = 0;
		uiState.matchedContext = context;
		uiState.matchedQuery = queryKey();
		if (uiState.cache.index < 0 || uiState.cache.index >= uiState.cache.matches.length)
			uiState.cache.index = 0;
	};
	const emitChange = (
		withCache: boolean = true,
		extraSpec?: { selection?: { anchor: number; head: number } | undefined },
		context: EditorContext | null = getEditorContext(),
	) => {
		if (context && isCurrentContext(context)) {
			const validMatches =
				uiState.matchedContext?.doc === context.doc &&
				uiState.matchedContext.file === context.file &&
				uiState.matchedContext.editorView === context.editorView &&
				uiState.matchedQuery === queryKey();
			runtime.editor.publish(
				context,
				withCache
					? {
							visible: uiState.cache.visible,
							index: uiState.cache.index,
							matches: validMatches
								? uiState.cache.matches.map((match) => ({ ...match }))
								: [],
						}
					: undefined,
				extraSpec?.selection,
			);
		}
	};
	const setFindText = (
		text: string,
		scroll: boolean = true,
		activeEditor = getEditorContext(),
		direction = 0,
		synchronous = false,
	) => {
		// Host editor-change/layout events can fire synchronously during our commit.
		// They must not cancel post-commit matching, or replay the edit.
		if (uiState.replacementTask?.phase === "committing") return;
		uiState.passiveEntry = false;
		if (
			uiState.replacementTask &&
			!scroll &&
			text === uiState.cache.search &&
			replacementCurrent(uiState.replacementTask)
		)
			return;
		if (uiState.replacementTask) cancelEditing();
		uiState.replacementRetry = null;
		uiState.replacementCommittedError = false;
		uiState.positionRequest++;
		uiState.statusContext = runtime.editor.ownerFile();
		// The view may update cache.search before the input handler.
		if (uiState.currentSearch !== text) uiState.lastRecordedSearch = null;
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
				editorSearch.clearReading();
				uiState.cache.matches = [];
				uiState.cache.index = 0;
				uiState.readingPending = false;
				return;
			}
			const request = ++uiState.readingRequest;
			if (uiState.scopeBlocked && !uiState.readingScope) {
				editorSearch.reading().blockScope();
				uiState.readingScope = true;
				uiState.scopeEnabled = true;
				uiState.scopeWindow = editorSearch.environment();
			}
			editorSearch.reading().search(
				text,
				uiState.cache.options,
				uiState.cache.index,
				scroll,
				(result) => {
					if (
						request !== uiState.readingRequest ||
						!uiState.cache.visible ||
						!isReading()
					)
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
				},
				direction,
			);
			return;
		}
		uiState.readingRequest++;
		editorSearch.clearReading();
		if (activeEditor && isCurrentContext(activeEditor)) {
			if (text) {
				const key = queryKey();
				const pending = queryLane.pending;
				const win = editorSearch.environment();
				if (
					!synchronous &&
					pending &&
					pending.key === key &&
					pending.window === win &&
					pending.context.doc === activeEditor.doc &&
					pending.context.file === activeEditor.file &&
					pending.context.editor === activeEditor.editor &&
					pending.context.editorView === activeEditor.editorView
				) {
					if (scroll) {
						pending.scroll = true;
						pending.direction += direction;
					}
					return;
				}
				if (queryLane.pending) cancelEditing();
				uiState.readingPending = false;
				const content = activeEditor.doc.toString();
				const apply = (
					result: MatchResult,
					shouldScroll: boolean,
					requestedDirection: number,
				) => {
					if (
						uiState.disposed ||
						!isCurrentContext(activeEditor) ||
						queryKey() !== key ||
						editorSearch.environment() !== win ||
						editorSearch.environmentClosed(win)
					)
						return;
					uiState.readingPending = false;
					if (result.status === "cancelled") return;
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
						uiState.cache.index =
							(((uiState.cache.index + requestedDirection) %
								uiState.cache.matches.length) +
								uiState.cache.matches.length) %
							uiState.cache.matches.length;
					if (uiState.cache.matches.length && shouldScroll)
						void scrollToMatch(activeEditor);
					else {
						if (!uiState.cache.matches.length) uiState.cache.index = 0;
						emitChange(true, undefined, activeEditor);
					}
				};
				if (!synchronous) queryLane.use(editorSearch.matcher());
				const ranges = scopeRanges();
				const result =
					!synchronous && queryLane.engine
						? queryLane.engine.match(content, text, uiState.cache.options, ranges)
						: {
								status: "completed" as const,
								matches: findTextOffsets(
									content,
									text,
									uiState.cache.options.regexMode,
									uiState.cache.options.caseSensitive,
									uiState.cache.options.wholeWord,
									ranges,
								),
								synchronous: true,
							};
				if (result instanceof Promise) {
					const computation = {
						context: activeEditor,
						key,
						window: win,
						scroll,
						direction,
					};
					uiState.readingPending = true;
					uiState.cache.matches = [];
					emitChange(true, undefined, activeEditor);
					queryLane.accept(computation, result, (value) => {
						apply(value, computation.scroll, computation.direction);
					});
				} else apply(result, scroll, direction);
			} else {
				resetMatches(true);
			}
		} else {
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
			if (
				uiState.cache.visible &&
				!uiState.readingUnsupported &&
				!uiState.readingError &&
				uiState.cache.search
			)
				recordSearchToHistory(uiState.cache.search);
			return;
		}
		const context = getEditorContext();
		if (!context) return;
		if (
			uiState.matchedContext?.doc !== context.doc ||
			uiState.matchedContext.file !== context.file ||
			uiState.matchedContext.editorView !== context.editorView ||
			uiState.matchedQuery !== queryKey() ||
			queryLane.pending
		) {
			setFindText(uiState.cache.search, true, context, direction);
			if (uiState.cache.search) recordSearchToHistory(uiState.cache.search);
			return;
		}
		if (uiState.cache.index < 0 || uiState.cache.index >= uiState.cache.matches.length)
			uiState.cache.index = 0;
		const matchSize = uiState.cache.matches.length;
		uiState.cache.index =
			matchSize === 0 ? 0 : (uiState.cache.index + direction + matchSize) % matchSize;
		void scrollToMatch(context);
		// Saving is not part of editor navigation and must not delay it.
		if (uiState.cache.search) {
			recordSearchToHistory(uiState.cache.search);
		}
	};
	const toNextMatch = () => navigateMatch(1);
	const toPreviousMatch = () => navigateMatch(-1);
	const scrollToMatch = (activeEditor = getEditorContext(), afterReplacement = false) => {
		if (uiState.disposed) return false;
		if (uiState.replacementTask?.phase === "prepare") {
			cancelEditing();
			uiState.readingPending = false;
		}
		if (isReading()) {
			setFindText(uiState.cache.search, true);
			return true;
		}
		try {
			if (!activeEditor || !isCurrentContext(activeEditor)) return false;
			if (
				uiState.matchedContext?.doc !== activeEditor.doc ||
				uiState.matchedQuery !== queryKey() ||
				uiState.matchedContext.file !== activeEditor.file ||
				uiState.matchedContext.editorView !== activeEditor.editorView
			) {
				setFindText(uiState.cache.search, true, activeEditor);
				return false;
			}
			const matched = uiState.cache.matches[uiState.cache.index];
			if (!matched) return true;
			const request = ++uiState.positionRequest;
			const requestQuery = queryKey();
			const requestIndex = uiState.cache.index;
			const visible = uiState.cache.visible;
			const { from, to } = matched;
			const { sourceModeWhenSearch, moveCursorToMatch } = editorSearch.preferences();
			const currentRequest = () =>
				!uiState.disposed &&
				uiState.positionRequest === request &&
				uiState.cache.visible === visible &&
				queryKey() === requestQuery &&
				uiState.cache.index === requestIndex &&
				runtime.editor.ownerFile() === activeEditor.file;
			return navigateToMatch({
				currentRequest,
				currentContext: () => isCurrentContext(activeEditor),
				refreshRebuiltContext() {
					const rebuilt = getEditorContext();
					if (rebuilt && rebuilt.editorView !== activeEditor.editorView)
						matchAgain(false);
				},
				reveal: () => runtime.editor.reveal(activeEditor, matched, sourceModeWhenSearch),
				publish: () =>
					emitChange(
						true,
						{ selection: moveCursorToMatch ? { anchor: from, head: to } : undefined },
						activeEditor,
					),
				failed: (error) =>
					editorSearch.reportError(
						afterReplacement
							? "search.ReplacedNavigationFailed"
							: "search.EditorFailed",
						error,
					),
				canReportAsyncFailure: () => !!getEditorContext(),
			});
		} catch (error) {
			editorSearch.reportError(
				afterReplacement ? "search.ReplacedNavigationFailed" : "search.EditorFailed",
				error,
			);
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
		editorSearch.clearReading();
		uiState.cache.matches = [];
		uiState.cache.index = 0;
		if (clearSearch) {
			historyNavigation.reset();
			uiState.cache.search = "";
			uiState.currentSearch = "";
			uiState.lastRecordedSearch = null;
		}
		if (clearReplace) uiState.cache.replace = "";
		emitChange();
	};
	const adjustReplaceText = (text: string) => {
		return decodeReplacementEscapes(text, editorSearch.preferences().useEscapeCharInReplace);
	};
	const replacementCurrent = (task: ReplacementTask) =>
		!uiState.disposed &&
		uiState.replacementTask === task &&
		!isReading() &&
		isCurrentContext(task.context) &&
		queryKey() === task.key &&
		task.context.file?.path === task.path &&
		editorSearch.environment() === task.window &&
		!editorSearch.environmentClosed(task.window) &&
		(task.phase === "committed" ||
			(uiState.cache.replace === task.replace &&
				editorSearch.preferences().useEscapeCharInReplace === task.escape));
	const replaceMatches = (
		inputText: string,
		all: boolean,
		advance = false,
		synchronous = false,
	): ReplaceResult | Promise<ReplaceResult> => {
		const result: ReplaceResult = {
			changed: false,
			changeCount: 0,
			search: uiState.cache.search,
			replace: uiState.cache.replace,
			beforeCount: 0,
			afterCount: 0,
			status: "cancelled",
		};
		if (uiState.disposed || isReading()) return result;
		if (uiState.docked) expandFinder();
		const context = getEditorContext();
		if (!context) return result;
		const index =
			uiState.matchedContext &&
			(uiState.matchedContext.file !== context.file ||
				uiState.matchedContext.editorView !== context.editorView)
				? 0
				: uiState.cache.index;
		cancelEditing(true);
		uiState.positionRequest++;
		const matcher = editorSearch.matcher();
		queryLane.use(matcher);
		const task: ReplacementTask = {
			context,
			key: queryKey(),
			window: editorSearch.environment(),
			path: context.file?.path,
			replace: uiState.cache.replace,
			escape: editorSearch.preferences().useEscapeCharInReplace,
			phase: "prepare",
			scopeEpoch: uiState.scopeEpoch,
			searchKey: searchKey(),
		};
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
				editorSearch.reportError("search.ReplacedNavigationFailed", error);
			} else {
				uiState.replacementRetry = (sync) => {
					if (
						!uiState.disposed &&
						isCurrentContext(context) &&
						queryKey() === task.key &&
						uiState.cache.replace === task.replace &&
						editorSearch.preferences().useEscapeCharInReplace === task.escape &&
						context.file?.path === task.path &&
						editorSearch.environment() === task.window
					) {
						void Promise.resolve(replaceMatches(inputText, all, advance, sync)).catch(
							reportEditorError,
						);
					} else setFindText(uiState.cache.search);
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
			} catch (error) {
				failed(error, true);
				return false;
			}
			const request = uiState.positionRequest;
			const complete = (success: boolean) => {
				result.navigationFailed = !success;
				if (
					success &&
					advance &&
					result.beforeCount === result.afterCount &&
					!uiState.disposed &&
					uiState.positionRequest === request &&
					isCurrentContext(task.context) &&
					queryKey() === task.key &&
					editorSearch.environment() === task.window
				)
					toNextMatch();
				return success;
			};
			return positioned instanceof Promise ? positioned.then(complete) : complete(positioned);
		};
		const engine = matcher;
		const replace = engine.replace;
		return runReplacement(
			task,
			uiState.cache.search,
			options,
			replacement,
			index,
			all,
			synchronous || !replace,
			result,
			{
				current: () => replacementCurrent(task),
				ranges: scopeRanges,
				prepared(prepared) {
					uiState.cache.matches = prepared.matches;
					rememberMatches(context);
				},
				commit: (changes) => runtime.editor.commit(context, changes),
				hasCommitted: () => runtime.editor.hasCommitted(context),
				committed() {
					const current = getEditorContext();
					if (
						!current ||
						current.file !== context.file ||
						current.editor !== context.editor ||
						current.editorView !== context.editorView ||
						uiState.replacementTask !== task ||
						uiState.scopeEpoch !== task.scopeEpoch ||
						searchKey() !== task.searchKey
					) {
						uiState.cache.matches = [];
						uiState.cache.index = 0;
						uiState.matchedContext = null;
						return null;
					}
					task.context = current;
					task.key = queryKey();
					uiState.cache.matches = [];
					uiState.readingPending = true;
					emitChange(true, undefined, current);
					return current;
				},
				pending() {
					uiState.readingPending = true;
				},
				finish: finishPosition,
				failed,
				clear() {
					if (uiState.replacementTask === task) {
						uiState.replacementTask = null;
						uiState.readingPending = false;
					}
				},
				noChanges: () => emitChange(true, undefined, context),
				commitFailed() {
					uiState.replacementRetry = null;
				},
				replace: (source, text) => {
					if (!replace) throw new Error("Replacement executor unavailable");
					return replace.call(
						engine,
						source,
						uiState.cache.search,
						text,
						options,
						index,
						all,
						scopeRanges(),
					);
				},
				match: (source) =>
					engine.match(source, uiState.cache.search, options, scopeRanges()),
			},
		);
	};
	const replaceMatchedText = (inputText: string) => replaceMatches(inputText, false);
	const replaceAllMatchedText = (inputText: string) => replaceMatches(inputText, true);
	const navigateHistory = (direction: -1 | 1) =>
		historyNavigation.move(direction, uiState.cache.search, getSortedHistory());
	const resetHistory = () => historyNavigation.reset();
	const matchAgain = (scroll = true) => {
		syncFinderVisibility();
		if (uiState.passiveEntry) {
			uiState.readingMode = isReading();
			return;
		}
		if (
			uiState.replacementTask?.phase === "committing" ||
			(!scroll && uiState.replacementTask && replacementCurrent(uiState.replacementTask))
		)
			return;
		const { search } = uiState.cache;
		if (uiState.cache.visible) {
			setFindText(search, scroll);
		} else {
			cancelEditing();
			uiState.readingRequest++;
			uiState.readingMode = isReading();
			uiState.readingPending = false;
			editorSearch.clearReading();
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
		if (isReading()) editorSearch.reading().retrySynchronously();
		setFindText(uiState.cache.search, true, getEditorContext(), 0, true);
	};
	const onReplaceChanged = () => {
		if (uiState.replacementTask?.phase === "prepare") {
			cancelEditing();
			uiState.readingPending = false;
		}
		uiState.replacementRetry = null;
	};
	const setReplacementText = (text: string) => {
		uiState.cache.replace = text;
		onReplaceChanged();
	};
	const retrySearch = () => {
		if (uiState.replacementRetry) uiState.replacementRetry(false);
		else setFindText(uiState.cache.search);
	};

	refreshToolbar();
	return {
		state: uiState,
		findInSelection,
		findInCapturedSelection,
		findSelectedText,
		toggleFindInSelection,
		hasSelectionScope,
		dockFinder,
		expandFinder,
		showFloatingEntry,
		resetFinderPosition,
		refreshToolbar,
		getSearchCache,
		setVisible,
		setVisibleFromHistory,
		setCollapse,
		showReplace,
		toggleReplaceFromCommand,
		resetAll,
		toggleVisible,
		toggleCollapse,
		isVisible,
		isDocked,
		replaceOnce,
		closeFinder,
		toggleRegexMode,
		toggleMatchCaseMode,
		toggleWholeWordMode,
		getEditorContext,
		emitChange,
		setFindText,
		toNextMatch,
		toPreviousMatch,
		scrollToMatch,
		resetMatches,
		replaceMatchedText,
		replaceAllMatchedText,
		matchAgain,
		changeQuery,
		onReplaceChanged,
		setReplacementText,
		navigateHistory,
		resetHistory,
		runToolbarAction,
		retrySynchronously,
		retrySearch,
		syncFinderVisibility,
	};
}
export type FinderSession = ReturnType<typeof createFinderSession>;
