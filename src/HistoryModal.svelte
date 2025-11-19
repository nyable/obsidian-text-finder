<script lang="ts">
	import { i18n } from "./i18n";
	import { Trash2, Copy, CheckSquare, Square } from "lucide-svelte";
	import type TextFinderPlugin from "./main";
	import type { SearchHistoryItem } from "./main";
	import type { Modal } from "obsidian";
	import { moment } from "obsidian";
	export let plugin: TextFinderPlugin;
	export let modal: Modal;
	let history: SearchHistoryItem[] = [];
	let selectedIndices: Set<number> = new Set();

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

	const select = (item: SearchHistoryItem) => {
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
	const remove = async (item: SearchHistoryItem) => {
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
	const toggleSelect = (index: number) => {
		if (selectedIndices.has(index)) {
			selectedIndices.delete(index);
		} else {
			selectedIndices.add(index);
		}
		selectedIndices = selectedIndices;
	};
	const toggleSelectAll = () => {
		if (selectedIndices.size === history.length) {
			selectedIndices = new Set();
		} else {
			selectedIndices = new Set(history.map((_, i) => i));
		}
	};
	const copy = (item: SearchHistoryItem) => {
		navigator.clipboard.writeText(item.text);
		updateUsage(item);
	};
	const formatTime = (timestamp: number) => {
		// @ts-ignore
		return `${moment(timestamp).format("YYYY-MM-DD HH:mm:ss")} (${moment(timestamp).fromNow()})`;
	};
	const getTooltip = (item: SearchHistoryItem) => {
		return `${item.text}\n\n${i18n.t("history.Created")}: ${formatTime(item.createdAt || item.lastUsedAt)}\n${i18n.t("history.LastUsed")}: ${formatTime(item.lastUsedAt)}\n${i18n.t("history.Count")}: ${item.count || 1}`;
	};
</script>

<div class="nya-history-modal">
	<div class="nya-history-header">
		<h2>
			{i18n.t("history.Title")}({history.length}/{plugin.settings
				.historyMaxCount})
		</h2>
	</div>

	<div class="nya-history-toolbar">
		<div class="nya-history-toolbar-actions">
			{#if selectedIndices.size > 0}
				<button
					class="nya-history-btn delete"
					on:click={removeSelected}
				>
					<Trash2 size={14} />
					{i18n.t("history.DeleteSelected")} ({selectedIndices.size})
				</button>
			{/if}
			<button class="nya-history-btn" on:click={toggleSelectAll}>
				{#if selectedIndices.size === history.length && history.length > 0}
					<CheckSquare size={14} />
					{i18n.t("history.UnselectAll")}
				{:else}
					<Square size={14} />
					{i18n.t("history.SelectAll")}
				{/if}
			</button>
		</div>
	</div>

	<div class="nya-history-list">
		{#if history.length === 0}
			<div class="nya-history-empty">{i18n.t("history.Empty")}</div>
		{:else}
			{#each history as item, index}
				<div
					class="nya-history-item"
					class:selected={selectedIndices.has(index)}
				>
					<div
						class="nya-history-checkbox"
						on:click|stopPropagation={() => toggleSelect(index)}
						role="checkbox"
						aria-checked={selectedIndices.has(index)}
						tabindex="0"
						on:keydown={(e) =>
							e.key === "Enter" && toggleSelect(index)}
					>
						{#if selectedIndices.has(index)}
							<CheckSquare size={16} />
						{:else}
							<Square size={16} />
						{/if}
					</div>
					<div
						class="nya-history-content"
						on:click={() => select(item)}
						role="button"
						tabindex="0"
						on:keydown={(e) => e.key === "Enter" && select(item)}
						title={getTooltip(item)}
					>
						<div class="nya-history-text">{item.text}</div>
						<div class="nya-history-time">
							<span class="nya-history-count"
								>Used: {item.count || 1}</span
							>
							<span class="nya-history-sep">|</span>
							{#if plugin.settings.historySortOrder === "createdAt"}
								<span class="nya-history-label">Created:</span>
								{formatTime(item.createdAt || item.lastUsedAt)}
							{:else}
								{formatTime(item.lastUsedAt)}
							{/if}
						</div>
					</div>
					<div class="nya-history-actions">
						<button
							class="nya-icon-btn"
							on:click|stopPropagation={() => copy(item)}
							title={i18n.t("history.Copy")}
						>
							<Copy size={14} />
						</button>
						<button
							class="nya-icon-btn delete"
							on:click|stopPropagation={() => remove(item)}
							title={i18n.t("history.Delete")}
						>
							<Trash2 size={14} />
						</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style lang="scss">
	.nya-history-count {
		color: var(--text-accent);
		font-weight: 600;
	}
	.nya-history-sep {
		margin: 0 4px;
		color: var(--text-faint);
	}
	.nya-history-modal {
		display: flex;
		flex-direction: column;
		height: 70vh; /* Set explicit height to trigger internal scrolling */
		padding: 24px; /* Restore padding removed from contentEl */
	}
	.nya-history-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		h2 {
			margin: 0;
			font-size: 1.4em;
			font-weight: 600;
		}
	}
	.nya-history-toolbar {
		display: flex;
		justify-content: flex-end;
		margin: 8px 0;
	}
	.nya-history-toolbar-actions {
		display: flex;
		gap: 8px;
	}
	.nya-history-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
		background-color: var(--interactive-normal);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		color: var(--text-normal);
		transition: all 0.2s;
		&:hover {
			background-color: var(--interactive-hover);
		}
		&.delete {
			color: var(--text-error);
			border-color: var(--text-error);
			background-color: rgba(var(--text-error-rgb), 0.1);
			&:hover {
				background-color: var(--text-error);
				color: var(--text-on-accent);
			}
		}
	}
	.nya-history-list {
		padding: 4px;
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.nya-history-empty {
		text-align: center;
		color: var(--text-muted);
		padding: 40px;
		font-style: italic;
	}
	.nya-history-item {
		display: flex;
		align-items: flex-start; /* Align items to top for multi-line text */
		padding: 10px 12px;
		border-radius: 6px;
		background-color: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		transition: all 0.2s;
		&:hover {
			background-color: var(--background-modifier-hover);
			border-color: var(--interactive-accent);
			transform: translateY(-1px);
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);

			.nya-history-actions {
				opacity: 1;
			}
		}
		&.selected {
			background-color: rgba(var(--interactive-accent-rgb), 0.1);
			border-color: var(--interactive-accent);
		}
	}
	.nya-history-checkbox {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-right: 12px;
		margin-top: 2px; /* Align with first line of text */
		cursor: pointer;
		color: var(--text-muted);
		transition: color 0.2s;
		&:hover {
			color: var(--interactive-accent);
		}
	}
	.nya-history-content {
		flex: 1;
		overflow: hidden;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.nya-history-text {
		font-family: var(--font-monospace);
		font-size: 14px;
		color: var(--text-normal);

		/* Multi-line truncation */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: normal;
		word-break: break-all;
		line-height: 1.4;
	}
	.nya-history-time {
		font-size: 11px;
		color: var(--text-muted);
	}
	.nya-history-label {
		color: var(--text-faint);
		font-weight: 500;
	}
	.nya-history-actions {
		display: flex;
		gap: 6px;
		opacity: 0; /* Hidden by default, shown on hover */
		transition: opacity 0.2s;
		margin-left: 12px;
		margin-top: 2px; /* Align with first line */
	}
	.nya-icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.2s;
		&:hover {
			background-color: var(--background-modifier-active);
			color: var(--text-normal);
		}
		&.delete:hover {
			color: var(--text-error);
			background-color: rgba(var(--text-error-rgb), 0.1);
		}
	}
</style>
