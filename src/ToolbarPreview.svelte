<script context="module">
	let nextPreviewId = 0;
</script>

<script lang="ts">
	import { ChevronDown, X } from "lucide-svelte";
	import { i18n } from "./i18n";
	import type { ToolbarItem } from "./toolbar";
	import Toolbar from "./Toolbar.svelte";

	export let searchToolbar: ToolbarItem[];
	export let replaceToolbar: ToolbarItem[];
	export let defaultRegexMode = false;
	export let defaultCaseSensitive = false;
	export let historyEnabled = true;
	const noop = () => {};
	const titleId = `nya-toolbar-preview-title-${++nextPreviewId}`;
</script>

<div class="nya-toolbar-preview">
	<h3 id={titleId}>{i18n.t("settings.Toolbar.preview")}</h3>
	<div class="nya-preview-stage">
		<div class="nya-finder-preview" role="img" aria-labelledby={titleId}>
			<div class="nya-preview-dragger" aria-hidden="true"></div>
			<div class="nya-preview-toggle" aria-hidden="true"><ChevronDown size={18} /></div>
			<div class="nya-preview-main">
				<div class="nya-preview-input nya-preview-find">text</div>
				<div class="nya-preview-count">{i18n.t("search.tip.HasResults", { current: 1, total: 3 })}</div>
				<div class="nya-preview-search-actions">
					<Toolbar items={searchToolbar} run={noop} regexMode={defaultRegexMode} caseSensitive={defaultCaseSensitive}
						{historyEnabled} preview />
					<div class="nya-preview-close" aria-hidden="true"><X size={18} /></div>
				</div>
				<div class="nya-preview-input nya-preview-replace"><span class="nya-preview-placeholder">{i18n.t("search.tip.ReplacePlaceholder")}</span></div>
				<div class="nya-preview-replace-actions">
					<Toolbar items={replaceToolbar} run={noop} {historyEnabled} preview />
				</div>
			</div>
		</div>
	</div>
	<div class="nya-preview-text" lang="en">
		<div>Find <span class="nya-text-finder-match nya-text-finder-match-current">text</span>, highlight <span class="nya-text-finder-match">text</span>, and replace <span class="nya-text-finder-match">text</span>.</div>
	</div>
</div>

<style lang="scss">
	@use "./styles/finder-primitives" as finder;
	.nya-toolbar-preview { margin-bottom: 16px; container-type: inline-size; }
	h3 { margin-top: 0; font-family: var(--font-interface); font-size: var(--font-ui-medium); font-weight: var(--font-semibold); }
	.nya-preview-stage { padding: 8px 4px; }
	.nya-finder-preview {
		@include finder.surface;
		display: flex; align-items: center; width: 100%; min-width: 0;
		pointer-events: none; user-select: none;
	}
	.nya-preview-dragger {
		width: 1px; align-self: stretch; border-left: 3px solid var(--nya-dragger-color); border-radius: 4px 0 0 4px;
	}
	.nya-preview-toggle {
		display: flex; align-items: center; justify-content: center;
		width: 16px; align-self: stretch; height: auto; margin: 2px; padding: 0;
		background: transparent; border: 0; box-shadow: none; flex-shrink: 0; color: var(--text-normal);
	}
	.nya-preview-main {
		display: grid; grid-template-columns: minmax(177px, 1fr) auto auto;
		grid-template-rows: 28px 28px; gap: 6px 0; padding: 4px 0; flex: 1; min-width: 0;
	}
	.nya-preview-input {
		@include finder.input;
		display: flex; align-items: center; box-sizing: border-box;
		width: 100%; padding: 0 8px;
		background: var(--background-modifier-form-field); color: var(--text-normal);
		border: 1px solid var(--background-modifier-border); border-radius: var(--input-radius);
		font-family: var(--font-interface); font-size: var(--font-ui-small); line-height: var(--line-height-normal);
		overflow: hidden; white-space: nowrap;
	}
	.nya-preview-placeholder { color: var(--text-faint); font: inherit; }
	.nya-preview-text {
		box-sizing: border-box; margin: 8px 4px 0; padding: 6px 12px;
		background: var(--background-primary); color: var(--text-normal);
		border: 1px solid var(--background-modifier-border); border-radius: 4px;
		font-family: var(--font-text); font-size: var(--font-text-size); line-height: var(--line-height-normal);
		overflow-wrap: anywhere; pointer-events: none; user-select: none;
	}
	.nya-preview-find { grid-column: 1; grid-row: 1; border-color: var(--nya-focus-border-color); }
	.nya-preview-replace { grid-column: 1; grid-row: 2; }
	.nya-preview-count { @include finder.counter; grid-column: 2; grid-row: 1; }
	.nya-preview-search-actions, .nya-preview-replace-actions {
		display: flex; align-items: center; height: 28px; margin-left: 4px;
	}
	.nya-preview-search-actions { grid-column: 3; grid-row: 1; justify-content: flex-end; }
	.nya-preview-replace-actions { grid-column: 2 / 4; grid-row: 2; }
	.nya-preview-close { @include finder.button(false); }
	@container (max-width: 480px) {
		.nya-preview-main { grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 24px 28px 28px; }
		.nya-preview-count { grid-column: 1 / 3; grid-row: 1; justify-content: flex-end; }
		.nya-preview-find { grid-row: 2; }
		.nya-preview-search-actions { grid-column: 2; grid-row: 2; }
		.nya-preview-replace { grid-row: 3; }
		.nya-preview-replace-actions { grid-column: 2; grid-row: 3; }
		.nya-preview-input { min-width: 0; }
	}
</style>
