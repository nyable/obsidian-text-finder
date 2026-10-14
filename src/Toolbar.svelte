<script context="module">
	let nextToolbarId = 0;
</script>

<script lang="ts">
	import { tick, beforeUpdate } from "svelte";
	import { ArrowDown, ArrowUp, ReplaceAll, Replace, Regex, CaseSensitive, WholeWord, TextSelect, History, Ellipsis } from "lucide-svelte";
	import { i18n } from "./i18n";
	import { toolbarLabels, type ToolbarItem, type ToolbarAction } from "./toolbar";
	import { mobileToolbar } from "./mobile-toolbar";
	export let items: ToolbarItem[];
	export let run: (action: ToolbarAction, focusQuery?: boolean) => void;
	export let regexMode = false;
	export let caseSensitive = false;
	export let wholeWord = false;
	export let selection = false;
	export let selectionUnavailable = false;
	export let readingMode = false;
	export let historyEnabled = true;
	export let tabindex = 0;
	export let visible = true;
	// Presentation-only branch: no controls, menu or document listeners.
	export let preview = false;
	export let inlineTarget: HTMLElement | undefined = undefined;
	const icons = { regex: Regex, case: CaseSensitive, wholeWord: WholeWord, selection: TextSelect, previous: ArrowUp, next: ArrowDown, history: History, replace: Replace, replaceAll: ReplaceAll };
	const isToggle = (id: ToolbarAction) => id === "regex" || id === "case" || id === "wholeWord" || id === "selection";
	let open = false;
	let root: HTMLDivElement;
	let trigger: HTMLDivElement;
	let previousItems: ToolbarItem[] | undefined;
	let executingToggle = false;
	beforeUpdate(() => {
		if (root && inlineTarget && previousItems !== items) {
			const more = root.querySelector(".nya-toolbar-overflow"), focused = root.ownerDocument.activeElement as HTMLElement | null;
			inlineTarget.querySelectorAll<HTMLElement>("[data-toolbar-action]").forEach((el) => root.insertBefore(el, more));
			if (focused && root.contains(focused)) focused.focus({ preventScroll: true });
		}
		previousItems = items;
	});
	const triggerId = `nya-toolbar-more-${++nextToolbarId}`;
	const panelId = `${triggerId}-panel`;
	const summaryId = `${triggerId}-summary`;
	const label = (id: ToolbarAction, unavailable: boolean) => i18n.t(id === "selection" && unavailable
		? "search.tip.FindInSelectionUnavailable" : toolbarLabels[id]);
	$: inline = items.filter((item) => item.placement === "inline" && !(readingMode && item.id === "selection"));
	$: more = items.filter((item) => item.placement === "more" && !(readingMode && item.id === "selection"));
	$: if (!visible || !more.length) open = false;
	$: controlTabIndex = visible ? tabindex : -1;
	$: activeIds = new Set<ToolbarAction>([...(regexMode ? ["regex" as const] : []), ...(caseSensitive ? ["case" as const] : []), ...(wholeWord ? ["wholeWord" as const] : []), ...(selection ? ["selection" as const] : [])]);
	$: activeMore = more.filter((item) => activeIds.has(item.id));
	$: moreSummary = i18n.t("search.tip.MoreActive", { modes: activeMore.map((item) => label(item.id, selectionUnavailable)).join(", ") });
	const execute = (id: ToolbarAction, control?: HTMLElement) => {
		if (preview) return;
		if (id !== "history" || historyEnabled) {
			if (control && isToggle(id)) {
				// Do not briefly focus the query (and summon the mobile keyboard)
				// while adjusting modes in the overflow panel.
				executingToggle = true;
				try { run(id, false); control.focus({ preventScroll: true }); }
				finally { executingToggle = false; }
			} else {
				if (open) trigger.focus({ preventScroll: true });
				open = false; run(id);
			}
		}
	};
	const activate = (event: KeyboardEvent) => {
		if (event.isComposing) return;
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
	function positionPanel(node: HTMLElement) {
		const win = node.ownerDocument.defaultView, finder = root.closest<HTMLElement>(".nya-finder");
		let dx = 0, dy = 0;
		const measure = () => {
			const owner = finder?.parentElement?.getBoundingClientRect(), viewport = win?.visualViewport;
			const left = Math.max(owner?.left ?? 0, viewport?.offsetLeft ?? 0) + 8;
			const right = Math.min(owner?.right || Infinity, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? win?.innerWidth ?? Infinity)) - 8;
			const top = Math.max(owner?.top ?? 0, viewport?.offsetTop ?? 0) + 8;
			const bottom = Math.min(owner?.bottom || Infinity, (viewport?.offsetTop ?? 0) + (viewport?.height ?? win?.innerHeight ?? Infinity)) - 8;
			node.style.maxWidth = `${Math.max(0, Math.min(300, right - left))}px`;
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
		if (open) {
			await tick();
			if (open && visible && root.isConnected) panelButtons()[0]?.focus({ preventScroll: true });
		}
	}
	const panelButtons = () => Array.from(root.querySelectorAll<HTMLElement>('.nya-toolbar-menu [role="button"]:not([aria-disabled="true"])'));
	function escapePanel(event: KeyboardEvent) {
		if (open && event.key === "Escape" && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey) {
			event.preventDefault(); event.stopPropagation(); open = false; trigger.focus({ preventScroll: true });
		}
	}
	function panelFocusOut(event: FocusEvent) {
		if (!executingToggle && event.relatedTarget !== trigger
			&& !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) open = false;
	}
	function panelKeys(event: KeyboardEvent) {
		if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
		if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
			const buttons = panelButtons();
			const index = buttons.indexOf(root.ownerDocument.activeElement as HTMLElement);
			const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
				: (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
			buttons[next]?.focus({ preventScroll: true });
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
			<span class="nya-btn nya-btn--more" aria-hidden="true" data-preview-action="more" data-has-active={activeMore.length > 0}>
				<Ellipsis size={18} />
				{#if activeMore.length}<span class="nya-toolbar-indicator" aria-hidden="true"></span>{/if}
			</span>
		{/if}
	{:else}
		{#each inline as item, index (item.id)}
			<div data-toolbar-action={item.id} data-toolbar-order={index} class="nya-btn nya-focus" class:nya-btn--active={activeIds.has(item.id)} class:nya-btn--disabled={item.id === "history" && !historyEnabled}
				role="button" tabindex={item.id === "history" && !historyEnabled ? -1 : controlTabIndex} aria-label={label(item.id, selectionUnavailable)}
				aria-pressed={isToggle(item.id) ? activeIds.has(item.id) : undefined}
				aria-disabled={item.id === "history" && !historyEnabled} on:click={() => execute(item.id)} on:keydown={activate}>
				<svelte:component this={icons[item.id]} size={18} aria-hidden="true" />
			</div>
		{/each}
		{#if more.length}
			<div class="nya-toolbar-overflow">
				<div class="nya-btn nya-focus nya-btn--more" class:nya-btn--open={open}
					role="button" tabindex={controlTabIndex} aria-label={i18n.t("search.tip.More")}
					id={triggerId} aria-controls={open ? panelId : undefined} aria-describedby={activeMore.length ? summaryId : undefined}
					aria-expanded={open} bind:this={trigger} on:click={toggle} on:keydown={(event) => { escapePanel(event); activate(event); }}>
					<Ellipsis size={18} aria-hidden="true" />
					{#if activeMore.length && !open}<span class="nya-toolbar-indicator" aria-hidden="true"></span>{/if}
				</div>
				{#if activeMore.length}<span id={summaryId} class="nya-toolbar-help">{moreSummary}</span>{/if}
				{#if open}
					<div id={panelId} class="nya-toolbar-menu" role="group" aria-labelledby={triggerId}
						on:focusout={panelFocusOut} use:positionPanel>
						{#each more as item (item.id)}
							<div class="nya-btn nya-focus" class:nya-btn--active={activeIds.has(item.id)} class:nya-btn--disabled={item.id === "history" && !historyEnabled}
								role="button" tabindex={item.id === "history" && !historyEnabled ? -1 : controlTabIndex}
								aria-label={label(item.id, selectionUnavailable)} aria-pressed={isToggle(item.id) ? activeIds.has(item.id) : undefined}
								aria-disabled={item.id === "history" && !historyEnabled} data-overflow-action={item.id}
								on:click={(event) => execute(item.id, event.currentTarget)}
								on:keydown={(event) => { escapePanel(event); panelKeys(event); activate(event); }}>
								<svelte:component this={icons[item.id]} size={18} aria-hidden="true" />
							</div>
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
		flex-shrink: 0;
		&--more { position: relative; }
		&--open { box-shadow: inset 0 0 0 1px var(--text-muted); }
		&--disabled { opacity: 0.4; }
	}
	.nya-focus {
		@include finder.focus($keyboardOnly: true);
	}
	.nya-toolbar-indicator {
		position: absolute; top: 1px; right: 1px; width: 5px; height: 5px;
		border-radius: 50%; background-color: var(--interactive-accent); pointer-events: none;
	}
	.nya-toolbar-overflow { position: relative; }
	.nya-toolbar-menu {
		display: flex; flex-wrap: wrap; width: max-content; box-sizing: border-box; overflow: auto;
		position: absolute; top: calc(100% + 6px); right: 0; z-index: 30;
		max-width: min(300px, 85vw); padding: 4px;
		background: var(--background-primary); color: var(--text-normal);
		border: 1px solid var(--modal-border-color); border-radius: 4px;
		box-shadow: 0 0 6px 1px rgba(0, 0, 0, 0.36);
	}
	.nya-toolbar-help { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
