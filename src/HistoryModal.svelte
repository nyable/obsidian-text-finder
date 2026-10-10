<script lang="ts">
	import type TextFinderPlugin from "./main";
	import type { SearchHistoryItem } from "./main";
	import type { Modal } from "obsidian";
	import HistoryList from "./HistoryList.svelte";
	import HistoryDetail from "./HistoryDetail.svelte";
	import { onDestroy } from "svelte";

	export let plugin: TextFinderPlugin;
	export let modal: Modal;
	let listSettings = plugin.settings;
	let history: SearchHistoryItem[] = [];
	// History is deduplicated by its exact text; display order is not identity.
	let selectedTexts: Set<string> = new Set();
	let viewingItem: SearchHistoryItem | null = null;

	const viewDetails = (event: CustomEvent<SearchHistoryItem>) => {
		viewingItem = event.detail;
	};

	const closeDetails = () => {
		viewingItem = null;
	};

	const unsubscribe = plugin.history.subscribe(() => {
		history = plugin.history.sorted();
		const texts = new Set(history.map((item) => item.text));
		selectedTexts = new Set([...selectedTexts].filter((text) => texts.has(text)));
		if (viewingItem) viewingItem = history.find((item) => item.text === viewingItem?.text) ?? null;
		// A new settings snapshot also refreshes capacity/sort props in the list.
		listSettings = { ...plugin.settings };
	});
	onDestroy(unsubscribe);

	const select = (event: CustomEvent<SearchHistoryItem>) => {
		const item = event.detail;
		try {
			const finder = plugin.editorSearch?.getFinder();
			if (!finder || !finder.setVisibleFromHistory(item.text)) {
				throw new Error("No searchable Markdown view for history reuse");
			}
			modal.close();
		} catch (error) { plugin.reportError("history.ReuseFailed", error); }
	};
	const remove = (event: CustomEvent<SearchHistoryItem>) => {
		plugin.history.remove(new Set([event.detail.text]));
	};
	const removeSelected = () => {
		plugin.history.remove(selectedTexts);
		selectedTexts = new Set();
	};

	const copy = async (event: CustomEvent<SearchHistoryItem>) => {
		const item = event.detail;
		try {
			await navigator.clipboard.writeText(item.text);
			// A late clipboard completion must not resurrect a deleted entry.
			plugin.history.record(item.text, true, true);
		} catch (error) { plugin.reportError("history.CopyFailed", error); }
	};

	const handleRemoveFromDetail = (event: CustomEvent<SearchHistoryItem>) => {
		remove(event);
		closeDetails();
	};
</script>

<div class="nya-history-modal">
	{#if viewingItem}
		<HistoryDetail
			item={viewingItem}
			on:close={closeDetails}
			on:copy={copy}
			on:delete={handleRemoveFromDetail}
		/>
	{:else}
		<HistoryList
			{history}
			settings={listSettings}
			bind:selectedTexts
			on:viewDetails={viewDetails}
			on:select={select}
			on:copy={copy}
			on:delete={remove}
			on:deleteSelected={removeSelected}
		/>
	{/if}
</div>

<style lang="scss">
	.nya-history-modal {
		display: flex;
		flex-direction: column;
		height: 70vh; /* Set explicit height to trigger internal scrolling */
		padding: 24px; /* Restore padding removed from contentEl */
	}
</style>
