<script setup lang="ts">
import { computed, toRefs } from "vue";
import TextRun from "./ui/TextRun";

	import { i18n } from "./i18n";
	import { Trash2, Copy, CheckSquare, Square, Info } from "lucide-vue-next";
	import type { PluginSettings } from "./settings";
	import type { SearchHistoryItem } from "./main";
	import { moment } from "obsidian";
	
	import { HistorySortOrder } from "./constants";

	const props = withDefaults(defineProps<{ history?: SearchHistoryItem[]; settings: PluginSettings }>(), {history: () => []});
const { history, settings } = toRefs(props);
const selectedTexts = defineModel<Set<string>>("selectedTexts", {default: () => new Set()});
const dispatch = defineEmits<{ deleteSelected: []; select: [item: SearchHistoryItem]; viewDetails: [item: SearchHistoryItem]; copy: [item: SearchHistoryItem]; delete: [item: SearchHistoryItem] }>();

	const allSelected = computed(() => history.value.length > 0 && history.value.every((item) => selectedTexts.value.has(item.text)));

	

	const formatTime = (timestamp: number) => {
		// @ts-ignore
		return moment(timestamp).format("YY-MM-DD HH:mm:ss");
	};

	const formatRelative = (timestamp: number) => {
		// @ts-ignore
		return moment(timestamp).fromNow();
	};

	const getTooltip = (item: SearchHistoryItem) => {
		return `${i18n.t("history.Length")}: ${item.text.length} | ${i18n.t("history.Count")}: ${item.count}\n${i18n.t("history.Created")}: ${formatTime(item.createdAt)}\n${i18n.t("history.LastUsed")}: ${formatTime(item.lastUsedAt)}\n\n${item.text}`;
	};

	const toggleSelect = (text: string) => {
		const nextSelection = new Set(selectedTexts.value);
		if (nextSelection.has(text)) {
			nextSelection.delete(text);
		} else {
			nextSelection.add(text);
		}
		selectedTexts.value = nextSelection;
	};

	const toggleSelectAll = () => {
		selectedTexts.value = allSelected.value ? new Set() : new Set(history.value.map((item) => item.text));
	};

	const removeSelected = () => {
		dispatch("deleteSelected");
	};

	const select = (item: SearchHistoryItem) => {
		dispatch("select", item);
	};

	const viewDetails = (item: SearchHistoryItem) => {
		dispatch("viewDetails", item);
	};

	const copy = (item: SearchHistoryItem) => {
		dispatch("copy", item);
	};

	const remove = (item: SearchHistoryItem) => {
		dispatch("delete", item);
	};
</script>

<template>

<div class="nya-history-header">
	<h2>
	12312312
		<TextRun :value="i18n.t('history.Title')" /><TextRun value="(" /><TextRun :value="history.length" /><TextRun value="/" /><TextRun :value="settings.historyMaxCount" /><TextRun value=")" />
	</h2>
</div>

<div class="nya-history-toolbar">
	<div class="nya-history-toolbar-actions">
		<template v-if="selectedTexts.size > 0">
			<button class="nya-history-btn delete" @click="removeSelected">
				<Trash2 :size="14" />
				{{ i18n.t("history.DeleteSelected") }} ({{ selectedTexts.size }})
			</button>
		</template>
		<button class="nya-history-btn" @click="toggleSelectAll">
			<template v-if="allSelected">
				<CheckSquare :size="14" />
				{{ i18n.t("history.UnselectAll") }}
			</template><template v-else>
				<Square :size="14" />
				{{ i18n.t("history.SelectAll") }}
			</template>
		</button>
	</div>
</div>

<div class="nya-history-list">
	<template v-if="history.length === 0">
		<div class="nya-history-empty">{{ i18n.t("history.Empty") }}</div>
	</template><template v-else>
		<template v-for="(item) in history" :key="item.text">
			<div :class="[{'selected': selectedTexts.has(item.text)}]"
				class="nya-history-item"
				
			>
				<div
					class="nya-history-checkbox"
					@click.stop="() => toggleSelect(item.text)"
					role="checkbox"
					:aria-checked="selectedTexts.has(item.text)"
					tabindex="0"
					@keydown="(e) => {
						if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect(item.text); }
					}"
				>
					<template v-if="selectedTexts.has(item.text)">
						<CheckSquare :size="16" />
					</template><template v-else>
						<Square :size="16" />
					</template>
				</div>
				<div
					class="nya-history-content"
					@click="() => select(item)"
					role="button"
					tabindex="0"
					@keydown.self="(e) => {
						if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(item); }
					}"
					:title="getTooltip(item)"
				>
					<div class="nya-history-top">
						<div class="nya-history-text">{{ item.text }}</div>
						<div class="nya-history-actions">
							<button
								class="nya-icon-btn"
								@click.stop="() =>
									viewDetails(item)"
								:title="i18n.t('history.Details')"
							>
								<Info :size="14" />
							</button>
							<button
								class="nya-icon-btn"
								@click.stop="() => copy(item)"
								:title="i18n.t('history.Copy')"
							>
								<Copy :size="14" />
							</button>
							<button
								class="nya-icon-btn delete"
								@click.stop="() => remove(item)"
								:title="i18n.t('history.Delete')"
							>
								<Trash2 :size="14" />
							</button>
						</div>
					</div>
					<div class="nya-history-bottom">
						<span class="nya-history-length"
							>{{ i18n.t("history.Characters", { count: item.text.length }) }}</span
						>
						<span class="nya-history-sep">|</span>
						<span class="nya-history-count"
							><TextRun :value="i18n.t('history.Count')" /><TextRun value=": " /><TextRun :value="item.count" /></span
						>
						<span class="nya-history-sep">|</span>
						<span class="nya-history-time-combined">
							<template v-if="settings.historySortOrder === HistorySortOrder.CREATED_AT">
								<TextRun :value="formatTime(item.createdAt)" /><TextRun value=" (" /><TextRun :value="formatRelative(item.createdAt)" /><TextRun value=")" />
							</template><template v-else>
								<TextRun :value="formatTime(item.lastUsedAt)" /><TextRun value=" (" /><TextRun :value="formatRelative(item.lastUsedAt)" /><TextRun value=")" />
							</template>
						</span>
					</div>
				</div>
			</div>
		</template>
	</template>
</div>

</template>
<style scoped lang="scss">
	.nya-history-length {
		color: var(--text-muted);
		font-weight: 500;
		font-size: 10px;
	}
	.nya-history-count {
		color: var(--text-accent);
		font-weight: 600;
	}
	.nya-history-sep {
		margin: 0 4px;
		color: var(--text-faint);
	}
	.nya-history-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
		padding-bottom: 8px;
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
		padding-bottom: 4px;
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
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
		color: var(--text-normal);
		box-shadow: none;
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
		&:focus-within .nya-history-actions { opacity: 1; }
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
	.nya-history-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 8px;
	}
	.nya-history-text {
		font-family: var(--font-monospace);
		font-size: 14px;
		color: var(--text-normal);
		flex: 1;

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
	.nya-history-bottom {
		font-size: 11px;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		margin-top: 4px;
	}
	.nya-history-time-combined {
		font-size: 10px;
		color: var(--text-faint);
		font-family: var(--font-monospace);
	}
	.nya-history-actions {
		display: flex;
		gap: 6px;
		opacity: 0; /* Hidden by default, shown on hover */
		transition: opacity 0.2s;
		flex-shrink: 0;
	}
	@media (hover: none) { .nya-history-actions { opacity: 1; } }
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
