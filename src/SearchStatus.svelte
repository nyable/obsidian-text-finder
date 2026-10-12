<script lang="ts">
	import { onDestroy } from "svelte";
	import { i18n } from "./i18n";
	export let visible: boolean;
	export let pending: boolean;
	export let unsupported: boolean;
	export let error: "failed" | "timeout" | undefined;
	export let query: string;
	export let context: unknown;
	export let retry: () => void;
	export let nativeFind: () => void;
	export let readingMode = true;
	export let workerError = false;
	export let synchronousRetry: () => void = () => {};
	export let cancel: () => void = () => {};
	let delayed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let previousQuery = "";
	let previousContext: unknown;
	let above = false;
	function update(show: boolean, text: string, owner: unknown) {
		if (!show || text !== previousQuery || owner !== previousContext) {
			clearTimeout(timer); timer = undefined; delayed = false;
		}
		previousQuery = text; previousContext = owner;
		if (show && !delayed && timer === undefined) timer = setTimeout(() => { timer = undefined; delayed = true; }, 400);
	}
	$: update(visible && pending, query, context);
	$: message = workerError ? "search.WorkerFailed" : error ? (error === "timeout" ? "search.ReadingTimeout" : "search.ReadingFailed")
		: unsupported ? "search.ReadingUnsupported" : readingMode ? "search.ReadingPending" : "search.MatchPending";
	function position(node: HTMLElement) {
		const parent = node.parentElement!;
		const measure = () => {
			const box = parent.getBoundingClientRect();
			const height = node.offsetHeight;
			above = box.bottom + height + 8 > (node.ownerDocument.defaultView?.innerHeight ?? Infinity)
				&& box.top > height + 8;
		};
		const win = node.ownerDocument.defaultView;
		const observer = win && "ResizeObserver" in win ? new win.ResizeObserver(measure) : undefined;
		observer?.observe(node); win?.addEventListener("resize", measure); measure();
		return { destroy() { observer?.disconnect(); win?.removeEventListener("resize", measure); } };
	}
	onDestroy(() => clearTimeout(timer));
</script>

{#if visible && (error || unsupported || (pending && delayed))}
	<div class="nya-search-status" class:nya-search-status--above={above} class:nya-search-status--error={error || unsupported}
		role="status" aria-live="polite" use:position>
		<span>{i18n.t(message)}</span>
		{#if error || unsupported}
			<div class="nya-status-actions">
				{#if error}<button type="button" on:click={retry}>{i18n.t("search.Retry")}</button>{/if}
				<button type="button" on:click={nativeFind}>{i18n.t("search.UseNativeFind")}</button>
			</div>
		{/if}
		{#if workerError}
			<div class="nya-status-actions"><button type="button" on:click={synchronousRetry}>{i18n.t("search.SynchronousRetry")}</button></div>
		{/if}
		{#if pending}
			<div class="nya-status-actions"><button type="button" on:click={cancel}>{i18n.t("search.CancelSearch")}</button></div>
		{/if}
	</div>
{/if}

<style>
	.nya-search-status {
		position: absolute; top: calc(100% + 6px); left: 22px; right: 4px;
		padding: 3px 6px; font-size: 12px; line-height: 1.5;
		color: var(--text-muted); background: var(--background-primary);
		background: color-mix(in srgb, var(--background-primary) 88%, transparent);
		border-radius: 2px; pointer-events: none; overflow-wrap: anywhere;
	}
	.nya-search-status--above { top: auto; bottom: calc(100% + 6px); }
	.nya-search-status--error { pointer-events: auto; color: var(--text-normal); }
	.nya-status-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; pointer-events: auto; }
	.nya-status-actions button { font-size: 12px; height: auto; padding: 3px 6px; }
</style>
