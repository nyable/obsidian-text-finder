<script setup lang="ts">
import { shallowRef } from "vue";

import type { HistoryView, SearchHistoryItem } from "../application/history-view";
import HistoryList from "./HistoryList.vue";
import HistoryDetail from "./HistoryDetail.vue";
import { onBeforeUnmount } from "vue";

const { view, close } = defineProps<{ view: HistoryView; close: () => void }>();
const listSettings = shallowRef(view.preferences());
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

const unsubscribe = view.controller.subscribe(() => {
	history.value = view.controller.sorted();
	const texts = new Set(history.value.map((item) => item.text));
	selectedTexts.value = new Set([...selectedTexts.value].filter((text) => texts.has(text)));
	if (viewingItem.value)
		viewingItem.value =
			history.value.find((item) => item.text === viewingItem.value?.text) ?? null;
	// A new settings snapshot also refreshes capacity/sort props in the list.
	listSettings.value = { ...view.preferences() };
});
onBeforeUnmount(() => {
	disposed = true;
	unsubscribe();
});

const select = (item: SearchHistoryItem) => {
	if (disposed) return;

	try {
		if (!view.reuse(item.text)) {
			throw new Error("No searchable Markdown view for history reuse");
		}
		close();
	} catch (error) {
		view.reportError("history.ReuseFailed", error);
	}
};
const remove = (item: SearchHistoryItem) => {
	view.controller.remove(new Set([item.text]));
};
const removeSelected = () => {
	view.controller.remove(selectedTexts.value);
	selectedTexts.value = new Set();
};

const copy = async (item: SearchHistoryItem) => {
	try {
		await view.copy(item.text);
		// A late clipboard completion must not resurrect a deleted entry.
		if (disposed || view.isDisposed()) return;
		view.controller.record(item.text, true, true);
	} catch (error) {
		view.reportError("history.CopyFailed", error);
	}
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
			/> </template
		><template v-else>
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
