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
	import { MarkdownView } from "obsidian";
	import type { EditorView } from "@codemirror/view";
	import { findTextOffsets } from "./util/text-helper";
	import type { TransactionSpec } from "@codemirror/state";

	export let editorSearch: EditorSearch;

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

	$: isCollapsed = cache.collapse;
	$: finderTabIndex = cache.collapse ? 0 : 1;
	$: commonTabIndex = cache.collapse ? 0 : 2;
	$: replacerTabIndex = cache.collapse ? -1 : 1;

	let iconSize = 18;
	let searchEl: HTMLTextAreaElement;

	export function getSearchCache() {
		return cache;
	}

	export function setVisible(flag: boolean, searchText?: string) {
		cache.visible = flag;
		const settings = editorSearch.plugin.settings;
		if (cache.visible) {
			if (searchText) {
				cache.search = searchText;
			}
			setFindText(cache.search);
			//TODO: 感觉应该把当前index定位到离光标最近的那个
			searchEl.select();
		} else {
			cache.collapse = true;
			if (settings.clearAfterHidden) {
				resetMatches(true, true);
			} else {
				emitChange();
			}
		}
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

	export const toNextMatch = () => {
		const matchSize = cache.matches.length;
		if (matchSize == 0) {
			cache.index = 0;
		} else {
			cache.index = (cache.index + 1) % matchSize;
		}
		scrollToMatch();
	};

	export const toPreviousMatch = () => {
		const matchSize = cache.matches.length;
		if (matchSize == 0) {
			cache.index = 0;
		} else {
			cache.index = (cache.index - 1 + matchSize) % matchSize;
		}
		scrollToMatch();
	};

	export const scrollToMatch = () => {
		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const { editorView, editor } = activeEditor;

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

	export const replaceMatchedText = (replaceText: string): ReplaceResult => {
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

				let replaceStr = replaceText;
				if (regexMode) {
					const regex = new RegExp(
						search,
						"g" + caseSensitive ? "i" : "",
					);
					const rangeText = editor.getRange(
						editor.offsetToPos(current.from),
						editor.offsetToPos(current.to),
					);
					replaceStr = rangeText.replace(regex, replaceText);
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

	export const replaceAllMatchedText = (
		replacement: string,
	): ReplaceResult => {
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
						"g" + caseSensitive ? "i" : "",
					);

					changes = matches.map((item) => {
						let text = replacement;
						const rangeText = editor.getRange(
							editor.offsetToPos(item.from),
							editor.offsetToPos(item.to),
						);
						text = rangeText.replace(regex, replacement);
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
							insert: replacement,
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
	const enterOnFinder = (e: KeyboardEvent) => {
		const enableInputHotkeys =
			editorSearch.plugin.settings.enableInputHotkeys;
		const isEnterPress = ["Enter", "NumpadEnter"].includes(e.code);
		if (enableInputHotkeys && isEnterPress) {
			// 这里本来打算监听enter shift+enter ctrl+enter 但是加上修饰键 会和默认的快捷键有冲突.所以除了enter都用命令的快捷键算了
			if (!e.altKey && !e.ctrlKey && !e.shiftKey) {
				e.preventDefault();
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
</script>

<div
	class={`nya-finder ${cache.visible ? "nya-finder--active" : "nya-finder--hidden"} ${isCollapsed ? "nya-finder--collapsed" : ""}`}
>
	<div
		class={`toggle-btn nya-focus`}
		on:click={toggleCollapse}
		role="button"
		tabindex="0"
		title={i18n.t("search.tip.ToggleReplace")}
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
				on:keydown={enterOnFinder}
				rows="1"
				class="nya-input"
				bind:this={searchEl}
				bind:value={cache.search}
				placeholder={i18n.t("search.tip.FindPlaceholder")}
				tabindex={finderTabIndex}
			/>
			<div class="finder-act">
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
				<div
					class={`nya-btn nya-focus ${cache.options.regexMode ? "nya-btn--active" : ""}`}
					on:click={toggleRegexMode}
					role="button"
					tabindex={commonTabIndex}
					title={i18n.t("search.tip.UseRegularExpression")}
					on:keydown={defaultEnterEvent}
				>
					<Regex size={iconSize} />
				</div>
				<div
					class={`nya-btn nya-focus ${cache.options.caseSensitive ? "nya-btn--active" : ""}`}
					on:click={toggleMatchCaseMode}
					role="button"
					tabindex={commonTabIndex}
					title={i18n.t("search.tip.MatchCase")}
					on:keydown={defaultEnterEvent}
				>
					<CaseSensitive size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={toPreviousMatch}
					role="button"
					tabindex={commonTabIndex}
					title={i18n.t("search.tip.PreviousMatch")}
					on:keydown={defaultEnterEvent}
				>
					<ArrowUp size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={toNextMatch}
					role="button"
					tabindex={commonTabIndex}
					title={i18n.t("search.tip.NextMatch")}
					on:keydown={defaultEnterEvent}
				>
					<ArrowDown size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={closeFinder}
					role="button"
					tabindex={commonTabIndex}
					title={i18n.t("search.tip.Close")}
					on:keydown={defaultEnterEvent}
				>
					<X size={iconSize} />
				</div>
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
					title={i18n.t("search.tip.Replace")}
					on:keydown={defaultEnterEvent}
				>
					<Replace size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={replaceAll}
					tabindex={commonTabIndex}
					role="button"
					on:keydown={defaultEnterEvent}
					title={i18n.t("search.tip.ReplaceAll")}
				>
					<ReplaceAll xlink:title="Replace All" size={iconSize} />
				</div>
			</div>
		</div>
	</div>
</div>

<style lang="scss" global>
	$border-color: #2488db;
	.nya-finder {
		position: absolute;
		background-color: var(--background-primary);
		transition:
			transform 0.2s linear,
			opacity 0.2s linear,
			right 0.3s cubic-bezier(0.45, 0.05, 0.55, 0.95);
		height: 72px;
		min-width: 448px;
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

		.toggle-btn {
			width: 18px;
			height: 100%;
			margin-right: 4px;
			display: flex;
			justify-content: center;
			align-items: center;
			border-left: 3px solid #39c5bb;
		}

		.main-part {
			padding: 4px 0px;
			flex: 1;
			flex-direction: column;
			height: 100%;
			display: flex;

			.finder {
				display: flex;
				margin-bottom: 6px;
			}

			.replacer {
				display: flex;
			}

			.finder-act {
				display: flex;
				justify-content: center;
				align-items: center;
				height: 28px;
				flex: 1;
				padding-left: 4px;
			}
			.replacer-act {
				display: flex;
				justify-content: start;
				align-items: center;
				height: 28px;
				flex: 1;
				padding-left: 4px;
			}
		}
	}
	.nya-tip {
		font-size: 12px;
		text-align: left;
		flex: 1;
		padding: 0 4px;
		font-family: auto;
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
			border: 1px solid $border-color;
			background-color: rgba(36, 137, 219, 0.51);
			color: #fff;
		}
	}
	.nya-input {
		box-shadow: none;
		width: 177px;
		resize: none;
		height: 28px;
		scrollbar-width: none;
		&:focus {
			border-color: $border-color;
		}
	}
	.nya-focus {
		&:hover {
			background-color: rgba(90, 93, 94, 0.31);
		}
		&:focus {
			box-shadow: 0 0 0 1px $border-color;
		}
	}

	:global(.is-right-sidedock-open) {
		.nya-finder {
			right: 352px;
		}
	}

	:global(body) {
		.mod-root:has(
				.mod-active > .workspace-leaf-content[data-mode="preview"]
			)
			~ .nya-finder {
			visibility: hidden;
			user-select: none;
			pointer-events: none;
		}
	}
</style>
