<script setup lang="ts">
import { shallowRef } from "vue";

	import type TextFinderPlugin from "./main";
	import type { SearchHistoryItem } from "./main";
	import type { Modal } from "obsidian";
	import HistoryList from "./HistoryList.vue";
	import HistoryDetail from "./HistoryDetail.vue";
	import { onBeforeUnmount } from "vue";

	const { plugin, modal } = defineProps<{ plugin: TextFinderPlugin; modal: Modal }>();
	const listSettings = shallowRef(plugin.settings);
	const history = shallowRef<SearchHistoryItem[]>([]);
	// History is deduplicated by its exact text; display order is not identity.
	const selectedTexts = shallowRef<Set<string>>(new Set());
	const viewingItem = shallowRef<SearchHistoryItem | null>(null);
	let disposed = false;

	const viewDetails = (item: SearchHistoryItem) => {
		viewingItem.value = item;
	};

	const closeDetails = () => {
		viewingItem.value = null;
	};

	const unsubscribe = plugin.history.subscribe(() => {
		history.value = plugin.history.sorted();
		const texts = new Set(history.value.map((item) => item.text));
		selectedTexts.value = new Set([...selectedTexts.value].filter((text) => texts.has(text)));
		if (viewingItem.value) viewingItem.value = history.value.find((item) => item.text === viewingItem.value?.text) ?? null;
		// A new settings snapshot also refreshes capacity/sort props in the list.
		listSettings.value = { ...plugin.settings };
	});
	onBeforeUnmount(() => { disposed = true; unsubscribe(); });

	const select = (item: SearchHistoryItem) => {
		if (disposed) return;
		
		try {
			const finder = plugin.editorSearch?.getFinder();
			if (!finder || !finder.setVisibleFromHistory(item.text)) {
				throw new Error("No searchable Markdown view for history reuse");
			}
			modal.close();
		} catch (error) { plugin.reportError("history.ReuseFailed", error); }
	};
	const remove = (item: SearchHistoryItem) => {
		plugin.history.remove(new Set([item.text]));
	};
	const removeSelected = () => {
		plugin.history.remove(selectedTexts.value);
		selectedTexts.value = new Set();
	};

	const copy = async (item: SearchHistoryItem) => {
		
		try {
			await modal.contentEl.ownerDocument.defaultView!.navigator.clipboard.writeText(item.text);
			// A late clipboard completion must not resurrect a deleted entry.
			if (disposed || plugin.isUnloaded()) return;
			plugin.history.record(item.text, true, true);
		} catch (error) { plugin.reportError("history.CopyFailed", error); }
	};

	const handleRemoveFromDetail = (item: SearchHistoryItem) => {
		remove(item);
		closeDetails();
	};
</script>

<template>

<div class="nya-history-modal">
	<template v-if="viewingItem">
		<HistoryDetail
			:item="viewingItem"
			@close="closeDetails"
			@copy="copy"
			@delete="handleRemoveFromDetail"
		/>
	</template><template v-else>
		<HistoryList
			:history="history"
			:settings="listSettings"
			v-model:selected-texts="selectedTexts"
			@viewDetails="viewDetails"
			@select="select"
			@copy="copy"
			@delete="remove"
			@deleteSelected="removeSelected"
		/>
	</template>
</div>

</template>
<style scoped lang="scss">
	.nya-history-modal {
		display: flex;
		flex-direction: column;
		height: 70vh; /* Set explicit height to trigger internal scrolling */
		padding: 24px; /* Restore padding removed from contentEl */
	}
</style>
