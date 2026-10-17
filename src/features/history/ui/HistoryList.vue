<script setup lang="ts">
import { Copy, Info, Trash2, CheckSquare, Square } from "lucide-vue-next";
import { useId } from "vue";
import { i18n } from "../../../i18n";
import type { HistoryViewPreferences, SearchHistoryItem } from "../application/history-view";
import { formatRelativeDate } from "../../../platform/obsidian/date-format";

defineProps<{
	history: SearchHistoryItem[];
	total?: number;
	settings: HistoryViewPreferences;
}>();
const selected = defineModel<Set<string>>("selectedTexts", { default: () => new Set() });
const id = useId();
const emit = defineEmits<{
	select: [item: SearchHistoryItem];
	viewDetails: [item: SearchHistoryItem];
	copy: [item: SearchHistoryItem];
	delete: [item: SearchHistoryItem];
}>();
const toggle = (text: string) => {
	const next = new Set(selected.value);
	if (next.has(text)) next.delete(text);
	else next.add(text);
	selected.value = next;
};
</script>

<template>
	<div class="nya-history-list">
		<p v-if="history.length === 0" class="nya-history-empty">
			{{ total ? i18n.t("library.NoResults") : i18n.t("history.Empty") }}
		</p>
		<div
			v-for="(item, index) in history"
			:key="item.text"
			class="nya-history-item"
			:class="{ selected: selected.has(item.text) }"
		>
			<button
				class="nya-history-checkbox"
				role="checkbox"
				:aria-checked="selected.has(item.text)"
				:aria-label="i18n.t('library.SelectQuery', { text: item.text })"
				@click="toggle(item.text)"
			>
				<component
					:is="selected.has(item.text) ? CheckSquare : Square"
					:size="16"
					aria-hidden="true"
				/>
			</button>
			<button
				class="nya-history-content"
				:aria-describedby="`${id}-meta-${index}`"
				@click="emit('select', item)"
			>
				<span class="nya-history-text">{{ item.text }}</span>
				<span v-if="/^\s+$/.test(item.text)" class="nya-library-hint">{{
					i18n.t("library.WhitespaceQuery", { count: item.text.length })
				}}</span>
			</button>
			<div class="nya-history-actions">
				<button
					class="nya-icon-btn"
					:aria-label="i18n.t('history.Details')"
					@click="emit('viewDetails', item)"
				>
					<Info :size="16" aria-hidden="true" />
				</button>
				<button
					class="nya-icon-btn"
					:aria-label="i18n.t('history.Copy')"
					@click="emit('copy', item)"
				>
					<Copy :size="16" aria-hidden="true" />
				</button>
				<button
					class="nya-icon-btn delete nya-library-delete-icon"
					:aria-label="i18n.t('history.Delete')"
					@click="emit('delete', item)"
				>
					<Trash2 :size="16" aria-hidden="true" />
				</button>
			</div>
			<div :id="`${id}-meta-${index}`" class="nya-history-meta">
				<span class="nya-history-usage">{{
					i18n.t("history.UsageCount", { count: item.count })
				}}</span>
				<span class="nya-history-length">{{
					i18n.t("history.Characters", { count: item.text.length })
				}}</span>
				<span class="nya-history-time-combined">
					<span class="nya-library-sr"
						>{{
							i18n.t(
								settings.historySortOrder === "createdAt"
									? "history.Created"
									: "history.LastUsed",
							)
						}}:
					</span>
					<span class="nya-history-time-value">{{
						formatRelativeDate(
							settings.historySortOrder === "createdAt"
								? item.createdAt
								: item.lastUsedAt,
						)
					}}</span>
				</span>
			</div>
		</div>
	</div>
</template>
