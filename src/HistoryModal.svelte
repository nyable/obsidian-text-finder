<script lang="ts">
	import type TextFinderPlugin from "./main";
	import type { SearchHistoryItem } from "./main";
	import type { Modal } from "obsidian";
	import HistoryList from "./HistoryList.svelte";
	import HistoryDetail from "./HistoryDetail.svelte";

	export let plugin: TextFinderPlugin;
	export let modal: Modal;
	let history: SearchHistoryItem[] = [];
	let selectedIndices: Set<number> = new Set();
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
				case "createdAt":
					return b.createdAt - a.createdAt;
				case "count":
					return (b.count || 0) - (a.count || 0);
				case "lastUsedAt":
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

			// Clear selection if needed (simplified logic: just clear all if any remove happens to avoid index mismatch)
			selectedIndices.clear();
			selectedIndices = selectedIndices;

			await plugin.saveSettings();
		}
	};
	const removeSelected = async () => {
		// Get items to remove based on current sorted history and selected indices
		const itemsToRemove = history.filter((_, index) =>
			selectedIndices.has(index),
		);

		for (const item of itemsToRemove) {
			const index = plugin.settings.searchHistory.findIndex(
				(h) => h.text === item.text,
			);
			if (index !== -1) {
				plugin.settings.searchHistory.splice(index, 1);
			}
		}
		plugin.settings.searchHistory = plugin.settings.searchHistory;
		selectedIndices = new Set();
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
			bind:selectedIndices
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
