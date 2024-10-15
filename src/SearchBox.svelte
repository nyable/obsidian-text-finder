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
	import { type EditorSearch } from "./editor-extension";
	import { i18n } from "./i18n";
	import { MarkdownView } from "obsidian";
	import type { EditorView } from "@codemirror/view";
	import { findTextOffsets } from "./util/text-helper";

	const cache: SearchCache = {
		index: 0,
		matches: [],
		search: "",
		replace: "",
	};
	export function getSearchCache() {
		return cache;
	}

	const options: SearchOptions = {
		enableRegexMode: false,
		enableCaseSensitive: false,
	};
	export function getSearchOptions() {
		return options;
	}

	let iconSize = 18;
	let visible = false;
	let searchEl: HTMLElement;
	let collapse = true;

	export let editorSearch: EditorSearch;

	export function setVisible(flag: boolean, searchText?: string) {
		const searchInput = searchEl as HTMLInputElement;
		visible = flag;
		const settings = editorSearch.plugin.settings;
		if (visible) {
			if (searchText) {
				cache.search = searchText;
			}
			setFindText(cache.search);
			searchInput.select();
		} else {
			collapse = true;
			if (settings.clearAfterHidden) {
				clearMatches(true);
				clearInput();
				clearReplace();
			}
		}
	}
	export function setCollapse(flag: boolean) {
		collapse = flag;
	}
	export function clearInput() {
		cache.search = "";
	}
	export function clearReplace() {
		cache.replace = "";
	}

	export function toggleVisible() {
		setVisible(!visible);
	}
	export function toggleCollapse() {
		setCollapse(!collapse);
	}

	export function isVisible() {
		return visible;
	}

	const onFindTextChanged = (e: Event) => {
		const target = e.target as HTMLInputElement;
		setFindText(target.value);
	};

	const clickNextMatch = () => {
		toNextMatch();
	};
	const clickPreviousMatch = () => {
		toPreviousMatch();
	};

	const clickReplaceAll = () => {
		replaceAllMatchedText(cache.replace);
	};
	const clickReplace = () => {
		replaceMatchedText(cache.replace);
	};

	export const closeSearch = () => {
		setVisible(false);
		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const state = activeEditor.view.getState();
			const { sourceModeWhenSearch } = editorSearch.plugin.settings;
			if (state.mode === "source" && sourceModeWhenSearch) {
				state.source = !isLivePreview();
				activeEditor.view.setState(state, { history: false });
			}
		}
	};
	export const toggleRegexMode = (e: Event) => {
		options.enableRegexMode = !options.enableRegexMode;
		searchEl.focus();
		setFindText(cache.search);
	};

	export const toggleMatchCaseMode = (e: Event) => {
		options.enableCaseSensitive = !options.enableCaseSensitive;
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

	export const setFindText = (text: string, scroll: boolean = true) => {
		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const { editor } = activeEditor;
			const { enableRegexMode, enableCaseSensitive } = options;
			cache.search = text;
			if (text) {
				const content = editor.getValue();
				cache.matches = findTextOffsets(
					content,
					text,
					enableRegexMode,
					enableCaseSensitive,
				);
				if (cache.index > cache.matches.length - 1) {
					cache.index = 0;
				}
				if (cache.matches.length > 0) {
					if (scroll) {
						scrollToMatch();
					} else {
						editor.setCursor(editor.getCursor());
					}
				} else {
					clearMatches();
				}
			} else {
				clearMatches(true);
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
				if (moveCursorToMatch) {
					editorView.dispatch({
						selection: { anchor: from, head: to },
					});
				}
			}
		}
	};

	export const clearMatches = (clearText = false) => {
		cache.matches = [];
		cache.index = 0;
		if (clearText) {
			cache.search = "";
		}

		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const editor = activeEditor.editor;
			editor.setCursor(editor.getCursor());
		}
	};

	export const replaceMatchedText = (replaceText: string) => {
		const { matches, search: text, index } = cache;
		const { enableRegexMode, enableCaseSensitive } = options;
		if (matches.length > 0) {
			const activeEditor = getActiveEditor();
			if (activeEditor) {
				const { editor, editorView } = activeEditor;
				const current = matches[index];
				if (enableRegexMode) {
					const regex = new RegExp(
						text,
						"g" + enableCaseSensitive ? "i" : "",
					);
					const rangeText = editor.getRange(
						editor.offsetToPos(current.from),
						editor.offsetToPos(current.to),
					);
					const replaceStr = rangeText.replace(regex, replaceText);
					editorView.dispatch({
						changes: {
							from: current.from,
							to: current.to,
							insert: replaceStr,
						},
					});
				} else {
					editorView.dispatch({
						changes: {
							from: current.from,
							to: current.to,
							insert: replaceText,
						},
					});
				}
				setFindText(text);
			}
		}
	};

	export const replaceAllMatchedText = (replaceText: string) => {
		const activeEditor = getActiveEditor();
		if (activeEditor) {
			const { editor, editorView } = activeEditor;
			const { matches, search: text } = cache;
			const { enableRegexMode, enableCaseSensitive } = options;
			if (matches.length > 0) {
				let result = [];
				if (enableRegexMode) {
					const regex = new RegExp(
						text,
						"g" + enableCaseSensitive ? "i" : "",
					);
					result = matches.map((item) => {
						let replaceContent = replaceText;
						if (enableRegexMode) {
							const rangeText = editor.getRange(
								editor.offsetToPos(item.from),
								editor.offsetToPos(item.to),
							);
							replaceContent = rangeText.replace(
								regex,
								replaceText,
							);
						}
						return {
							from: item.from,
							to: item.to,
							insert: replaceContent,
						};
					});
				} else {
					result = matches.map((item) => {
						return {
							from: item.from,
							to: item.to,
							insert: replaceText,
						};
					});
				}

				editorView.dispatch({
					changes: result,
				});
				setFindText(text);
			}
		}
	};
	const enterOnFindHandle = (e: KeyboardEvent) => {
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
	const enterOnReplaceHandle = (e: KeyboardEvent) => {
		const enableInputHotkeys =
			editorSearch.plugin.settings.enableInputHotkeys;
		const isEnterPress = ["Enter", "NumpadEnter"].includes(e.code);
		if (enableInputHotkeys && isEnterPress) {
			if (!e.altKey && !e.ctrlKey && !e.shiftKey) {
				e.preventDefault();
				clickReplace();
			}
		}
	};

	const isLivePreview = (): boolean => {
		return (editorSearch.plugin.app.vault as any).getConfig("livePreview");
	};

	const defaultKeyPressHandler = (e: KeyboardEvent) => {
		const isEnterPress = ["Enter", "NumpadEnter"].includes(e.code);
		if (isEnterPress) {
			(e.target as HTMLElement).click();
		}
	};
</script>

<div
	class={`nya-finder ${visible ? "nya-finder--active" : "nya-finder--hidden"} ${collapse ? "nya-finder--collapsed" : ""}`}
>
	<div
		class={`toggle-btn nya-focus`}
		on:click={() => (collapse = !collapse)}
		role="button"
		tabindex="0"
		title={i18n.t("search.tip.ToggleReplace")}
		on:keypress={defaultKeyPressHandler}
	>
		{#if collapse}
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
				on:input={onFindTextChanged}
				on:keypress={enterOnFindHandle}
				rows="1"
				class="nya-input"
				bind:this={searchEl}
				bind:value={cache.search}
				placeholder={i18n.t("search.tip.FindPlaceholder")}
				tabindex={collapse ? 0 : 1}
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
					class={`nya-btn nya-focus ${options.enableRegexMode ? "nya-btn--active" : ""}`}
					on:click={toggleRegexMode}
					role="button"
					tabindex={collapse ? 0 : 2}
					title={i18n.t("search.tip.UseRegularExpression")}
					on:keypress={defaultKeyPressHandler}
				>
					<Regex size={iconSize} />
				</div>
				<div
					class={`nya-btn nya-focus ${options.enableCaseSensitive ? "nya-btn--active" : ""}`}
					on:click={toggleMatchCaseMode}
					role="button"
					tabindex={collapse ? 0 : 2}
					title={i18n.t("search.tip.MatchCase")}
					on:keypress={defaultKeyPressHandler}
				>
					<CaseSensitive size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={clickPreviousMatch}
					role="button"
					tabindex={collapse ? 0 : 2}
					title={i18n.t("search.tip.PreviousMatch")}
					on:keypress={defaultKeyPressHandler}
				>
					<ArrowUp size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={clickNextMatch}
					role="button"
					tabindex={collapse ? 0 : 2}
					title={i18n.t("search.tip.NextMatch")}
					on:keypress={defaultKeyPressHandler}
				>
					<ArrowDown size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={closeSearch}
					role="button"
					tabindex={collapse ? 0 : 2}
					title={i18n.t("search.tip.Close")}
					on:keypress={defaultKeyPressHandler}
				>
					<X size={iconSize} />
				</div>
			</div>
		</div>
		<div class="replacer" style={collapse ? "display: none" : ""}>
			<textarea
				wrap="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				rows="1"
				class="nya-input"
				bind:value={cache.replace}
				on:keypress={enterOnReplaceHandle}
				placeholder={i18n.t("search.tip.ReplacePlaceholder")}
				tabindex={collapse ? -1 : 1}
			/>
			<div class="replacer-act">
				<div
					class="nya-btn nya-focus"
					on:click={clickReplace}
					tabindex={collapse ? 0 : 2}
					role="button"
					title={i18n.t("search.tip.Replace")}
					on:keypress={defaultKeyPressHandler}
				>
					<Replace size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={clickReplaceAll}
					tabindex={collapse ? 0 : 2}
					role="button"
					on:keypress={defaultKeyPressHandler}
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
		// box-shadow: 0 0 1px #ababab;
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
			// transform: translateY(-100vh);
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
			// justify-content: center;

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

	// @media screen and (max-width: 1200px) {
	// 	.nya-finder {
	// 		right: 64px;
	// 	}
	// }
</style>
