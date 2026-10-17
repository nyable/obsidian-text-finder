<script setup lang="ts">
import { ChevronDown, ChevronRight, CornerDownLeft } from "lucide-vue-next";
import { computed } from "vue";
import { i18n } from "../../../i18n";
import type { ToolbarItem } from "../model/toolbar";
import type { SearchOptions } from "../../../core/search/types";
import Toolbar from "./FinderToolbar.vue";

// Presentation only. No owner, live session, matching or document operations.
const props = defineProps<{
	search: string;
	replacement: string | null;
	collapse: boolean;
	options: Readonly<SearchOptions>;
}>();
// A recipe summary, not a second Finder: show all and only persisted match modes.
const matchItems: readonly ToolbarItem[] = [
	{ id: "regex", placement: "inline" },
	{ id: "case", placement: "inline" },
	{ id: "wholeWord", placement: "inline" },
];
const rows = computed(() =>
	[
		{ key: "search", text: props.search },
		...(!props.collapse ? [{ key: "replacement", text: props.replacement ?? "" }] : []),
	].map((row) => {
		const lines = row.text.split(/\r\n|\r|\n/);
		return { ...row, firstLine: lines[0], lines: lines.length };
	}),
);
const noop = () => {};
</script>

<template>
	<span class="nya-recipe-finder" :class="{ 'is-collapsed': collapse }">
		<span class="nya-recipe-fold" aria-hidden="true"
			><component :is="collapse ? ChevronRight : ChevronDown" :size="18"
		/></span>
		<span class="nya-recipe-main">
			<span v-for="row in rows" :key="row.key" class="nya-recipe-row">
				<span class="nya-recipe-value">
					<span class="nya-recipe-text" aria-hidden="true">{{ row.firstLine }}</span>
					<span class="nya-library-sr">{{ row.text }}</span>
					<span v-if="row.lines > 1" class="nya-recipe-lines">
						<CornerDownLeft :size="12" aria-hidden="true" />
						{{ i18n.t("library.LineCount", { count: row.lines }) }}
					</span>
				</span>
				<span v-if="row.key === 'search'" class="nya-recipe-tools"
					><Toolbar
						:items="matchItems"
						:run="noop"
						:regex-mode="options.regexMode"
						:case-sensitive="options.caseSensitive"
						:whole-word="options.wholeWord"
						preview
				/></span>
			</span>
		</span>
	</span>
</template>

<style scoped lang="scss">
@use "../../../styles/finder-primitives" as finder;
.nya-recipe-finder {
	@include finder.surface;
	background: transparent;
	border-color: transparent;
	display: flex;
	width: 100%;
	min-width: 0;
	box-sizing: border-box;
	box-shadow: none;
	padding: 4px;
	container-type: inline-size;
	pointer-events: none;
}
.nya-recipe-fold {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	flex-shrink: 0;
	align-self: stretch;
	border: 0;
	background: transparent;
	padding: 0;
	color: var(--text-muted);
}
.nya-recipe-main {
	display: grid;
	flex: 1;
	grid-template-columns: minmax(0, 1fr) max-content;
	align-items: start;
	gap: 6px 4px;
	min-width: 0;
}
.nya-recipe-row {
	display: contents;
}
.nya-recipe-value {
	@include finder.input;
	display: flex;
	align-items: center;
	grid-column: 1;
	gap: 8px;
	box-sizing: border-box;
	min-width: 0;
	min-height: 28px;
	height: 28px;
	padding: 4px 8px;
	border-radius: 4px;
	background: var(--background-secondary);
	color: var(--text-normal);
	font: inherit;
	overflow: hidden;
	tab-size: 4;
}
.nya-recipe-text {
	display: block;
	flex: 1;
	min-width: 0;
	min-height: 20px;
	line-height: 20px;
	white-space: pre;
	text-overflow: ellipsis;
	overflow: hidden;
}
.nya-recipe-lines {
	display: flex;
	align-items: center;
	gap: 4px;
	color: var(--text-muted);
	font-size: 11px;
	line-height: 16px;
	white-space: nowrap;
	flex-shrink: 0;
}
.nya-recipe-tools {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	grid-column: 2;
	grid-row: 1;
}
@container (max-width: 400px) {
	.nya-recipe-main {
		grid-template-columns: minmax(0, 1fr);
	}
	.nya-recipe-tools {
		grid-column: 1;
		justify-content: flex-end;
		width: 100%;
	}
	.nya-recipe-tools :deep(.nya-toolbar) {
		flex-wrap: wrap;
		justify-content: flex-end;
	}
}
</style>
