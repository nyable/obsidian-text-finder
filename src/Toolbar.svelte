<script context="module">
	let nextToolbarId = 0;
</script>

<script lang="ts">
	import { tick } from "svelte";
	import { ArrowDown, ArrowUp, ReplaceAll, Replace, Regex, CaseSensitive, WholeWord, History, Ellipsis } from "lucide-svelte";
	import { i18n } from "./i18n";
	import { toolbarLabels, type ToolbarItem, type ToolbarAction } from "./toolbar";
	export let items: ToolbarItem[];
	export let run: (action: ToolbarAction) => void;
	export let regexMode = false;
	export let caseSensitive = false;
	export let wholeWord = false;
	export let historyEnabled = true;
	export let tabindex = 0;
	export let visible = true;
	// Presentation-only branch: no controls, menu or document listeners.
	export let preview = false;
	const icons = { regex: Regex, case: CaseSensitive, wholeWord: WholeWord, previous: ArrowUp, next: ArrowDown, history: History, replace: Replace, replaceAll: ReplaceAll };
	const isToggle = (id: ToolbarAction) => id === "regex" || id === "case" || id === "wholeWord";
	let open = false;
	let root: HTMLDivElement;
	let trigger: HTMLDivElement;
	const triggerId = `nya-toolbar-more-${++nextToolbarId}`;
	$: inline = items.filter((item) => item.placement === "inline");
	$: more = items.filter((item) => item.placement === "more");
	$: if (!visible || !more.length) open = false;
	$: controlTabIndex = visible ? tabindex : -1;
	$: activeIds = new Set<ToolbarAction>([...(regexMode ? ["regex" as const] : []), ...(caseSensitive ? ["case" as const] : []), ...(wholeWord ? ["wholeWord" as const] : [])]);
	const execute = (id: ToolbarAction) => {
		if (preview) return;
		if (id !== "history" || historyEnabled) {
			if (open) trigger.focus();
			open = false; run(id);
		}
	};
	const activate = (event: KeyboardEvent) => {
		if (event.key === "Enter" || event.key === " ") { event.preventDefault(); (event.currentTarget as HTMLElement).click(); }
	};
	function outside(event: PointerEvent) { if (open && !root.contains(event.target as Node)) open = false; }
	function ownerEvents(node: HTMLElement) {
		if (preview) return {};
		const doc = node.ownerDocument;
		doc.addEventListener("pointerdown", outside);
		return { destroy() { doc.removeEventListener("pointerdown", outside); } };
	}
	async function toggle() {
		open = !open;
		if (open) { await tick(); root.querySelector<HTMLButtonElement>('.nya-toolbar-menu button:not(:disabled)')?.focus(); }
	}
	function menuKeys(event: KeyboardEvent) {
		if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); open = false; trigger.focus(); }
		else if (event.key === "Tab") { open = false; trigger.focus(); }
		else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.nya-toolbar-menu button:not(:disabled)'));
			const index = buttons.indexOf(root.ownerDocument.activeElement as HTMLButtonElement);
			const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
				: (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
			buttons[next]?.focus();
		}
	}
</script>

<div class="nya-toolbar" bind:this={root} use:ownerEvents>
	{#if preview}
		{#each inline as item (item.id)}
			<span class="nya-btn" class:nya-btn--active={activeIds.has(item.id)} class:nya-btn--disabled={item.id === "history" && !historyEnabled}
				aria-hidden="true" data-preview-action={item.id} data-active={activeIds.has(item.id)}>
				<svelte:component this={icons[item.id]} size={18} />
			</span>
		{/each}
		{#if more.length}
			<span class="nya-btn" aria-hidden="true" data-preview-action="more"><Ellipsis size={18} /></span>
		{/if}
	{:else}
		{#each inline as item (item.id)}
			<div class="nya-btn nya-focus" class:nya-btn--active={activeIds.has(item.id)} class:nya-btn--disabled={item.id === "history" && !historyEnabled}
				role="button" tabindex={item.id === "history" && !historyEnabled ? -1 : controlTabIndex} aria-label={i18n.t(toolbarLabels[item.id])}
				aria-pressed={isToggle(item.id) ? activeIds.has(item.id) : undefined}
				aria-disabled={item.id === "history" && !historyEnabled} on:click={() => execute(item.id)} on:keydown={activate}>
				<svelte:component this={icons[item.id]} size={18} />
			</div>
		{/each}
		{#if more.length}
			<div class="nya-toolbar-overflow">
				<div class="nya-btn nya-focus" role="button" tabindex={controlTabIndex} aria-label={i18n.t("search.tip.More")}
					id={triggerId}
					aria-haspopup="menu" aria-expanded={open} bind:this={trigger} on:click={toggle} on:keydown={activate}>
					<Ellipsis size={18} />
				</div>
				{#if open}
					<div class="nya-toolbar-menu" role="menu" tabindex="-1" aria-labelledby={triggerId} on:keydown={menuKeys}>
						{#each more as item (item.id)}
							<button type="button" role={isToggle(item.id) ? "menuitemcheckbox" : "menuitem"}
								aria-checked={isToggle(item.id) ? activeIds.has(item.id) : undefined}
								disabled={item.id === "history" && !historyEnabled} on:click={() => execute(item.id)}>
								<svelte:component this={icons[item.id]} size={18} />
								<span>{i18n.t(toolbarLabels[item.id])}</span><span class="nya-menu-check">{activeIds.has(item.id) ? "✓" : ""}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style lang="scss">
	@use "./styles/finder-primitives" as finder;
	.nya-toolbar { display: flex; align-items: center; }
	.nya-btn {
		@include finder.button;
		&--disabled { opacity: 0.4; }
	}
	.nya-focus {
		@include finder.focus;
	}
	.nya-toolbar-overflow { position: relative; }
	.nya-toolbar-menu {
		position: absolute; top: calc(100% + 6px); right: 0; z-index: 30;
		min-width: 180px; max-width: min(300px, 85vw); padding: 4px;
		background: var(--background-primary); color: var(--text-normal);
		border: 1px solid var(--modal-border-color); border-radius: 4px;
		box-shadow: 0 0 6px 1px rgba(0, 0, 0, 0.36);
		button {
			display: flex; align-items: center; gap: 8px; width: 100%; height: auto;
			padding: 6px 8px; text-align: left; background: transparent; box-shadow: none; border: 0;
			&:hover, &:focus-visible { background: var(--background-modifier-hover); }
		}
	}
	.nya-menu-check { margin-left: auto; min-width: 12px; }
</style>
