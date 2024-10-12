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
	import { i18n } from "./i18n";

	// 想用store来管理变量但是感觉哪里怪怪的,先凑合实现功能再说
	// ts文件和svelte组件互相调用的太多太乱了,考虑把实现全都放到svelte中,ts中只调用组件里的方法.
	let searchKey: string = "";
	let replaceKey: string = "";

	let cache: SearchCache = {
		index: 0,
		matches: [],
		text: "",
	};

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
				searchKey = searchText;
			}
			if (settings.selectWhenDisplay) {
				searchInput.select();
			} else {
				searchEl.focus();
			}

			editorSearch.setFindText(searchKey);
		} else {
			if (settings.clearAfterHidden) {
				editorSearch.clearMatches(true);
				clearInput();
				clearReplace();
			}
		}
	}

	export function clearInput() {
		searchKey = "";
	}
	export function clearReplace() {
		replaceKey = "";
	}

	export function toggleVisible() {
		visible = !visible;
		setVisible(visible);
	}

	export function getVisible() {
		return visible;
	}

	export function getReplaceKey() {
		return replaceKey;
	}

	export function updateMatchedCache(searchCache: SearchCache) {
		cache = searchCache;
	}

	const onFindTextChanged = (e: Event) => {
		const target = e.target as HTMLInputElement;
		editorSearch.setFindText(target.value);
	};

	const clickNextMatch = () => {
		editorSearch.toNextMatch();
	};
	const clickPreviousMatch = () => {
		editorSearch.toPreviousMatch();
	};

	const clickReplaceAll = () => {
		editorSearch.replaceAllMatchedText(replaceKey);
	};
	const clickReplace = () => {
		editorSearch.replaceMatchedText(replaceKey).toNextMatch();
	};

	const clickClose = () => {
		visible = false;
	};
	const toggleRegexMode = (e: Event) => {
		editorSearch.options.enableRegexMode =
			!editorSearch.options.enableRegexMode;
		searchEl.focus();
		editorSearch.setFindText(cache.text);
	};

	const toggleMatchCaseMode = (e: Event) => {
		editorSearch.options.enableCaseSensitive =
			!editorSearch.options.enableCaseSensitive;
		searchEl.focus();
		editorSearch.setFindText(cache.text);
	};
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
	class={`nya-finder ${visible ? "nya-finder--active" : "nya-finder--hidden"} ${collapse ? "nya-finder--collapsed" : ""}`}
>
	<div
		class={`toggle-btn nya-focus`}
		on:click={() => (collapse = !collapse)}
		role="button"
		tabindex="0"
		title={i18n.t("search.tip.ToggleReplace")}
	>
		{#if collapse}
			<ChevronRight size={iconSize} />
		{:else}
			<ChevronDown size={iconSize} />
		{/if}
	</div>
	<div class="main">
		<div class="finder">
			<textarea
				wrap="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				on:input={onFindTextChanged}
				rows="1"
				class="nya-input"
				bind:this={searchEl}
				bind:value={searchKey}
				placeholder={i18n.t("search.tip.FindPlaceholder")}
			/>
			<div
				style="display: flex;justify-content: center;align-items: center;height: 28px;flex:1;padding-left:4px"
			>
				<div
					style="font-size: 12px;text-align: left;flex:1;padding-left:4px"
				>
					{#if cache.matches.length > 0}
						<div>
							{i18n.t("search.tip.HasResults", {
								current: cache.index + 1,
								total: cache.matches.length,
							})}
						</div>
					{:else}
						<div style:color={cache.text ? "red" : ""}>
							{i18n.t("search.tip.NoResults")}
						</div>
					{/if}
				</div>
				<div
					class={`nya-btn nya-focus ${editorSearch.options.enableRegexMode ? "nya-btn--active" : ""}`}
					on:click={toggleRegexMode}
					role="button"
					tabindex="0"
					title={i18n.t("search.tip.UseRegularExpression")}
				>
					<Regex size={iconSize} />
				</div>
				<div
					class={`nya-btn nya-focus ${editorSearch.options.enableCaseSensitive ? "nya-btn--active" : ""}`}
					on:click={toggleMatchCaseMode}
					role="button"
					tabindex="0"
					title={i18n.t("search.tip.MatchCase")}
				>
					<CaseSensitive size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={clickPreviousMatch}
					role="button"
					tabindex="0"
					title={i18n.t("search.tip.PreviousMatch")}
				>
					<ArrowUp size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={clickNextMatch}
					role="button"
					tabindex="0"
					title={i18n.t("search.tip.NextMatch")}
				>
					<ArrowDown size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={clickClose}
					role="button"
					tabindex="0"
					title={i18n.t("search.tip.Close")}
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
				bind:value={replaceKey}
				placeholder={i18n.t("search.tip.ReplacePlaceholder")}
			/>
			<div
				style="display: flex;justify-content: start;align-items: center;height: 28px;flex:1;padding-left:4px"
			>
				<div
					class="nya-btn nya-focus"
					on:click={clickReplace}
					tabindex="0"
					role="button"
					title={i18n.t("search.tip.Replace")}
				>
					<Replace size={iconSize} />
				</div>
				<div
					class="nya-btn nya-focus"
					on:click={clickReplaceAll}
					tabindex="0"
					role="button"
					title={i18n.t("search.tip.ReplaceAll")}
				>
					<ReplaceAll xlink:title="Replace All" size={iconSize} />
				</div>
			</div>
		</div>
	</div>
</div>

<style lang="scss" global>
	.nya-finder {
		position: absolute;
		background-color: var(--background-primary);
		transition:
			transform 0.2s linear,
			opacity 0.2s linear;
		height: 72px;
		min-width: 450px;
		top: 96px;
		right: 360px;
		// box-shadow: 0 0 1px #ababab;
		box-shadow: 0 0 6px 1px rgba(0, 0, 0, 0.36) !important;
		border: 1px solid var(--modal-border-color);

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
			border-left: 3px solid #454545;
		}
		.main {
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
		}
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
			border: 1px solid #2488db;
			background-color: rgba(36, 137, 219, 0.51);
			color: #fff;
		}
	}
	.nya-input {
		box-shadow: none;
		width: 192px;
		resize: none;
		height: 28px;
		scrollbar-width: none;
		&:focus {
			border-color: #2488db;
		}
	}
	.nya-focus {
		&:hover {
			background-color: rgba(90, 93, 94, 0.31);
		}
		&:focus {
			box-shadow: 0 0 0 1px #2488db;
		}
	}
</style>
