<script context="module">
	let nextToolbarId = 0;
</script>

<script lang="ts">
	import { tick, beforeUpdate } from "svelte";
	import { ArrowDown, ArrowUp, ReplaceAll, Replace, Regex, CaseSensitive, WholeWord, History, Ellipsis } from "lucide-svelte";
	import { i18n } from "./i18n";
	import { toolbarLabels, type ToolbarItem, type ToolbarAction } from "./toolbar";
	import { mobileToolbar } from "./mobile-toolbar";
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
	export let inlineTarget: HTMLElement | undefined = undefined;
	const icons = { regex: Regex, case: CaseSensitive, wholeWord: WholeWord, previous: ArrowUp, next: ArrowDown, history: History, replace: Replace, replaceAll: ReplaceAll };
	const isToggle = (id: ToolbarAction) => id === "regex" || id === "case" || id === "wholeWord";
	let open = false;
	let root: HTMLDivElement;
	let trigger: HTMLDivElement;
	let previousItems: ToolbarItem[] | undefined;
	beforeUpdate(() => {
		if (root && inlineTarget && previousItems !== items) {
			const more = root.querySelector(".nya-toolbar-overflow"), focused = root.ownerDocument.activeElement as HTMLElement | null;
			inlineTarget.querySelectorAll<HTMLElement>("[data-toolbar-action]").forEach((el) => root.insertBefore(el, more));
			if (focused && root.contains(focused)) focused.focus({ preventScroll: true });
		}
		previousItems = items;
	});
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
	function ownerEvents(node: HTMLElement, _visible: boolean) {
		if (preview) return {};
		let doc = node.ownerDocument;
		doc.addEventListener("pointerdown", outside);
		return { update() {
			if (node.ownerDocument !== doc) {
				open = false; doc.removeEventListener("pointerdown", outside); doc = node.ownerDocument;
				doc.addEventListener("pointerdown", outside);
			}
		}, destroy() { doc.removeEventListener("pointerdown", outside); } };
	}
	function positionMenu(node: HTMLElement) {
		const win = node.ownerDocument.defaultView, finder = root.closest<HTMLElement>(".nya-finder");
		let dx = 0, dy = 0;
		const measure = () => {
			const owner = finder?.parentElement?.getBoundingClientRect(), viewport = win?.visualViewport;
			const left = Math.max(owner?.left ?? 0, viewport?.offsetLeft ?? 0) + 8;
			const right = Math.min(owner?.right || Infinity, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? win?.innerWidth ?? Infinity)) - 8;
			const top = Math.max(owner?.top ?? 0, viewport?.offsetTop ?? 0) + 8;
			const bottom = Math.min(owner?.bottom || Infinity, (viewport?.offsetTop ?? 0) + (viewport?.height ?? win?.innerHeight ?? Infinity)) - 8;
			node.style.maxWidth = `${Math.max(0, right - left)}px`; node.style.minWidth = `min(180px, ${Math.max(0, right - left)}px)`;
			node.style.maxHeight = `${Math.max(0, bottom - top)}px`;
			const box = node.getBoundingClientRect(), baseLeft = box.left - dx, baseTop = box.top - dy;
			dx = Math.max(left, Math.min(baseLeft, right - box.width)) - baseLeft;
			dy = (baseTop + box.height > bottom ? Math.max(top, (trigger.getBoundingClientRect().top - box.height - 6)) : Math.max(top, baseTop)) - baseTop;
			node.style.translate = `${dx}px ${dy}px`;
		};
		const observer = win && "ResizeObserver" in win ? new win.ResizeObserver(measure) : undefined;
		observer?.observe(node); win?.addEventListener("resize", measure); finder?.addEventListener("nya-finder-position", measure);
		win?.visualViewport?.addEventListener("resize", measure); win?.visualViewport?.addEventListener("scroll", measure); measure();
		return { destroy() {
			observer?.disconnect(); win?.removeEventListener("resize", measure); finder?.removeEventListener("nya-finder-position", measure);
			win?.visualViewport?.removeEventListener("resize", measure); win?.visualViewport?.removeEventListener("scroll", measure);
		} };
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

<div class="nya-toolbar" bind:this={root} use:ownerEvents={visible} use:mobileToolbar={preview ? undefined : inlineTarget}>
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
		{#each inline as item, index (item.id)}
			<div data-toolbar-action={item.id} data-toolbar-order={index} class="nya-btn nya-focus" class:nya-btn--active={activeIds.has(item.id)} class:nya-btn--disabled={item.id === "history" && !historyEnabled}
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
					<div class="nya-toolbar-menu" role="menu" tabindex="-1" aria-labelledby={triggerId} on:keydown={menuKeys} use:positionMenu>
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
		overflow-y: auto;
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
