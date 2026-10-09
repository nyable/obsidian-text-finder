<script lang="ts">
	import type TextFinderPlugin from "./main";
	import type { SearchHistoryItem } from "./main";
	import type { Modal } from "obsidian";
	import HistoryList from "./HistoryList.svelte";
	import HistoryDetail from "./HistoryDetail.svelte";
	import { HistorySortOrder } from "./constants";

	export let plugin: TextFinderPlugin;
	export let modal: Modal;
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

	// Sort based on user preference
	$: {
		const sortOrder = plugin.settings.historySortOrder;
		history = [...plugin.settings.searchHistory].sort((a, b) => {
			switch (sortOrder) {
				case HistorySortOrder.CREATED_AT:
					return b.createdAt - a.createdAt;
				case HistorySortOrder.COUNT:
					// Primary sort: by count (descending)
					const countDiff = (b.count || 0) - (a.count || 0);
					// Secondary sort: if count is same, sort by lastUsedAt (descending)
					if (countDiff === 0) {
						return b.lastUsedAt - a.lastUsedAt;
					}
					return countDiff;
				case HistorySortOrder.LAST_USED_AT:
				default:
					return b.lastUsedAt - a.lastUsedAt;
			}
		});
	}

	const updateUsage = async (item: SearchHistoryItem) => {
		const index = plugin.settings.searchHistory.findIndex(
			(h) => h.text === item.text,
		);
		if (index !== -1) {
			const updatedItem = {
				...plugin.settings.searchHistory[index],
				lastUsedAt: Date.now(),
				count: (plugin.settings.searchHistory[index].count || 0) + 1,
			};
			plugin.settings.searchHistory.splice(index, 1);
			plugin.settings.searchHistory.push(updatedItem);
			plugin.settings.searchHistory = plugin.settings.searchHistory; // Trigger update

			// Update viewingItem if it matches
			if (viewingItem && viewingItem.text === item.text) {
				viewingItem = updatedItem;
			}

			await plugin.saveSettings();
		}
	};

	const select = (event: CustomEvent<SearchHistoryItem>) => {
		const item = event.detail;
		// Update usage
		updateUsage(item);

		// Close modal first
		modal.close();

		// Open finder with the selected text
		// Use setVisibleFromHistory to maintain history position
		const editorSearch = plugin.editorSearch;
		if (editorSearch) {
			const finder = editorSearch.getFinder();
			finder.setVisibleFromHistory(item.text);
		}
	};
	const remove = async (event: CustomEvent<SearchHistoryItem>) => {
		const item = event.detail;
		const index = plugin.settings.searchHistory.findIndex(
			(h) => h.text === item.text,
		);
		if (index !== -1) {
			plugin.settings.searchHistory.splice(index, 1);
			plugin.settings.searchHistory = plugin.settings.searchHistory; // Trigger update

			selectedTexts.delete(item.text);
			selectedTexts = new Set(selectedTexts);

			await plugin.saveSettings();
		}
	};
	const removeSelected = async () => {
		plugin.settings.searchHistory = plugin.settings.searchHistory.filter(
			(item) => !selectedTexts.has(item.text),
		);
		selectedTexts = new Set();
		await plugin.saveSettings();
	};

	const copy = (event: CustomEvent<SearchHistoryItem>) => {
		const item = event.detail;
		navigator.clipboard.writeText(item.text);
		updateUsage(item);
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
			{plugin}
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
