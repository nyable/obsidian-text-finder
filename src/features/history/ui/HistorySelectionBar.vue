<script setup lang="ts">
import { computed } from "vue";
import { CheckSquare, Square, Trash2, X } from "lucide-vue-next";
import { i18n } from "../../../i18n";
import type { SearchHistoryItem } from "../model/history";

const props = defineProps<{ history: SearchHistoryItem[]; total: number; limit: number }>();
const selected = defineModel<Set<string>>("selectedTexts", { default: () => new Set() });
const emit = defineEmits<{ deleteSelected: [] }>();
const allSelected = computed(
	() => props.history.length > 0 && props.history.every((item) => selected.value.has(item.text)),
);
const toggleAll = () => {
	const next = new Set(selected.value);
	for (const item of props.history) {
		if (allSelected.value) next.delete(item.text);
		else next.add(item.text);
	}
	selected.value = next;
};
</script>

<template>
	<div class="nya-history-toolbar">
		<span class="nya-library-hint" role="status">{{
			selected.size
				? i18n.t("library.SelectedCount", { count: selected.size })
				: `${total} / ${limit}`
		}}</span>
		<div class="nya-history-toolbar-actions">
			<button
				v-if="selected.size"
				class="nya-icon-btn delete"
				:aria-label="i18n.t('history.DeleteSelected')"
				@click="emit('deleteSelected')"
			>
				<Trash2 :size="16" aria-hidden="true" />
			</button>
			<button
				v-if="selected.size"
				class="nya-icon-btn nya-history-clear"
				:aria-label="i18n.t('library.ClearSelection')"
				@click="selected = new Set()"
			>
				<X :size="16" aria-hidden="true" />
			</button>
			<button
				class="nya-history-btn nya-history-select-all"
				:disabled="history.length === 0"
				@click="toggleAll"
			>
				<component
					:is="allSelected ? CheckSquare : Square"
					:size="16"
					aria-hidden="true"
				/>{{ allSelected ? i18n.t("history.UnselectAll") : i18n.t("history.SelectAll") }}
			</button>
		</div>
	</div>
</template>
