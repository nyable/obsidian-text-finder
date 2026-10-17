<script setup lang="ts">
import { onMounted, shallowRef } from "vue";
import { i18n } from "../../../i18n";
import { formatDate } from "../../../platform/obsidian/date-format";
import type { SearchHistoryItem } from "../application/history-view";

defineProps<{ item: SearchHistoryItem }>();
const emit = defineEmits<{
	close: [];
	copy: [item: SearchHistoryItem];
	delete: [item: SearchHistoryItem];
	reuse: [item: SearchHistoryItem];
	preset: [item: SearchHistoryItem];
}>();
const back = shallowRef<HTMLButtonElement>();
onMounted(() => back.value?.focus());
</script>

<template>
	<div class="nya-library-header">
		<button ref="back" class="nya-library-secondary" @click="emit('close')">
			{{ i18n.t("history.Back") }}
		</button>
		<h2>{{ i18n.t("history.Details") }}</h2>
	</div>
	<div class="nya-history-detail">
		<dl class="nya-history-detail-meta">
			<dt>{{ i18n.t("history.Count") }}</dt>
			<dd>{{ item.count }}</dd>
			<dt>{{ i18n.t("history.Length") }}</dt>
			<dd>{{ i18n.t("history.Characters", { count: item.text.length }) }}</dd>
			<dt>{{ i18n.t("history.Created") }}</dt>
			<dd>{{ formatDate(item.createdAt, "YYYY-MM-DD HH:mm:ss") }}</dd>
			<dt>{{ i18n.t("history.LastUsed") }}</dt>
			<dd>{{ formatDate(item.lastUsedAt, "YYYY-MM-DD HH:mm:ss") }}</dd>
		</dl>
		<div class="nya-history-detail-body">
			<pre class="nya-history-detail-text" tabindex="0">{{ item.text }}</pre>
		</div>
		<div class="nya-library-footer">
			<div class="nya-library-actions">
				<button class="nya-library-secondary" @click="emit('copy', item)">
					{{ i18n.t("history.Copy") }}</button
				><button class="nya-library-secondary" @click="emit('preset', item)">
					{{ i18n.t("library.Save") }}</button
				><button class="mod-warning nya-library-danger" @click="emit('delete', item)">
					{{ i18n.t("history.Delete") }}
				</button>
			</div>
			<button class="mod-cta" @click="emit('reuse', item)">
				{{ i18n.t("library.Reuse") }}
			</button>
		</div>
	</div>
</template>
