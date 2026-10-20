<script setup lang="ts">
import "../../../styles/search-library.scss";
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useId, watch } from "vue";
import { Plus } from "lucide-vue-next";
import { i18n } from "../../../i18n";
import type { HistoryView, SearchHistoryItem } from "../application/history-view";
import { copyRecipe, type SearchPreset, type SearchRecipe } from "../../presets";
import { PresetEditor, PresetList } from "../../presets/ui";
import HistoryList from "./HistoryList.vue";
import HistoryDetail from "./HistoryDetail.vue";
import HistorySelectionBar from "./HistorySelectionBar.vue";

const props = withDefaults(
	defineProps<{
		view: HistoryView;
		close: () => void;
		initialTab?: "history" | "presets";
		initialRecipe?: SearchRecipe | null;
	}>(),
	{ initialTab: "history", initialRecipe: null },
);
const id = useId();
const root = shallowRef<HTMLElement>();
let releaseViewport: (() => void) | undefined;
const listSettings = shallowRef(props.view.preferences());
const history = shallowRef<SearchHistoryItem[]>([]);
const presets = shallowRef<SearchPreset[]>([]);
const selectedTexts = shallowRef<Set<string>>(new Set());
const viewingItem = shallowRef<SearchHistoryItem | null>(null);
const tab = shallowRef(props.initialTab);
const historyFilter = shallowRef("");
const presetFilter = shallowRef("");
const filter = computed({
	get: () => (tab.value === "history" ? historyFilter.value : presetFilter.value),
	set: (value: string) => {
		if (tab.value === "history") historyFilter.value = value;
		else presetFilter.value = value;
	},
});
const matches = (text: string) =>
	text.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase());
const filteredHistory = computed(() => history.value.filter((item) => matches(item.text)));
const filteredPresets = computed(() =>
	presets.value.filter((item) =>
		matches(`${item.name}\n${item.search}\n${item.replacement?.text ?? ""}`),
	),
);
const editing = shallowRef<{
	id?: string | undefined;
	name: string;
	recipe: SearchRecipe;
	expected?: SearchPreset | undefined;
} | null>(props.initialRecipe ? { name: "", recipe: copyRecipe(props.initialRecipe) } : null);
const editor = shallowRef<{ dirty(): boolean; focus(): void }>();
const discard = shallowRef<"back" | "close" | null>(null);
const error = shallowRef("");
const filterInput = shallowRef<HTMLInputElement>();
const list = shallowRef<HTMLElement>();
const deleted = shallowRef<SearchHistoryItem[]>([]);
const deletedPreset = shallowRef<SearchPreset | null>(null);
const undoError = shallowRef("");
const legacyDuplicateNames = computed(() => {
	const seen = new Set<string>();
	return presets.value.some((item) => {
		const name = item.name.trim();
		if (seen.has(name)) return true;
		seen.add(name);
		return false;
	});
});
let undoTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let scrollTop = 0;
let returnFocus: HTMLElement | null = null;
const remember = () => {
	scrollTop = list.value?.scrollTop ?? 0;
	returnFocus = list.value?.ownerDocument.activeElement as HTMLElement | null;
};
const restoreFocus = () => {
	void nextTick(() => {
		if (disposed || editing.value || viewingItem.value) return;
		if (list.value) list.value.scrollTop = scrollTop;
		if (returnFocus?.isConnected) returnFocus.focus();
		else filterInput.value?.focus();
	});
};
const unsubscribe = props.view.controller.subscribe(() => {
	history.value = props.view.controller.sorted();
	const texts = new Set(history.value.map((item) => item.text));
	selectedTexts.value = new Set([...selectedTexts.value].filter((text) => texts.has(text)));
	if (viewingItem.value) {
		viewingItem.value =
			history.value.find((item) => item.text === viewingItem.value?.text) ?? null;
		if (!viewingItem.value) restoreFocus();
	}
	listSettings.value = { ...props.view.preferences() };
});
const unsubscribePresets = props.view.presets?.subscribe(() => {
	presets.value = props.view.presets?.list() ?? [];
});
onBeforeUnmount(() => {
	disposed = true;
	unsubscribe();
	unsubscribePresets?.();
	clearTimeout(undoTimer);
	releaseViewport?.();
});
onMounted(() => {
	// Use the owner's visual viewport: a mobile keyboard can reduce it without
	// resizing the layout viewport. Never borrow the main window in a pop-out.
	const viewport = root.value?.ownerDocument.defaultView?.visualViewport;
	if (viewport) {
		const resize = () => {
			root.value?.style.setProperty("--nya-library-viewport-height", `${viewport.height}px`);
			root.value?.classList.toggle("nya-library--compact", viewport.height <= 420);
		};
		resize();
		viewport.addEventListener("resize", resize);
		releaseViewport = () => viewport.removeEventListener("resize", resize);
	}
	if (!editing.value) filterInput.value?.focus();
});

const select = (item: SearchHistoryItem) => {
	if (disposed) return;
	try {
		if (!props.view.reuse(item.text)) throw new Error("No searchable view");
		props.close();
	} catch (cause) {
		props.view.reportError("history.ReuseFailed", cause);
	}
};
const copy = async (item: SearchHistoryItem) => {
	try {
		await props.view.copy(item.text);
	} catch (cause) {
		if (!disposed && !props.view.isDisposed())
			props.view.reportError("history.CopyFailed", cause);
	}
};
const removeTexts = (texts: Set<string>) => {
	undoError.value = "";
	deletedPreset.value = null;
	deleted.value = history.value
		.filter((item) => texts.has(item.text))
		.map((item) => ({ ...item }));
	props.view.controller.remove(texts);
	clearTimeout(undoTimer);
	undoTimer = setTimeout(() => {
		deleted.value = [];
	}, 8000);
};
const removePreset = (item: SearchPreset) => {
	undoError.value = "";
	deleted.value = [];
	deletedPreset.value = item;
	props.view.presets?.remove(item.id);
	clearTimeout(undoTimer);
	undoTimer = setTimeout(() => {
		deletedPreset.value = null;
	}, 8000);
};
const undo = () => {
	const items = deleted.value,
		preset = deletedPreset.value;
	if (preset && !props.view.presets?.restore(preset)) {
		undoError.value = i18n.t("library.UndoNameConflict");
		return;
	}
	deleted.value = [];
	deletedPreset.value = null;
	undoError.value = "";
	clearTimeout(undoTimer);
	if (!preset) props.view.controller.restore(items);
};
const back = () => {
	if (editor.value?.dirty()) {
		discard.value = "back";
		return;
	}
	editing.value = null;
	viewingItem.value = null;
	error.value = "";
	restoreFocus();
};
const canClose = () => {
	if (editing.value && editor.value?.dirty()) {
		discard.value = "close";
		return false;
	}
	return true;
};
defineExpose({ canClose });
const discardDraft = () => {
	const closing = discard.value === "close";
	discard.value = null;
	editing.value = null;
	error.value = "";
	if (closing) props.close();
	else restoreFocus();
};
const start = (recipe: SearchRecipe, name = "", expected?: SearchPreset) => {
	if (!viewingItem.value) remember();
	viewingItem.value = null;
	editing.value = {
		name,
		recipe: copyRecipe(recipe),
		id: expected?.id,
		expected: expected ? { ...expected, ...copyRecipe(expected) } : undefined,
	};
	error.value = "";
};
const create = () => {
	const recipe = props.view.capture?.() ?? {
		search: "",
		options: { regexMode: false, caseSensitive: false, wholeWord: false },
		replacement: null,
	};
	start(recipe);
};
const fromHistory = (item: SearchHistoryItem) =>
	start({
		search: item.text,
		options: { regexMode: false, caseSensitive: false, wholeWord: false },
		replacement: null,
	});
const save = (name: string, recipe: SearchRecipe, copy: boolean) => {
	if (
		!props.view.presets?.put(
			name,
			recipe,
			copy ? undefined : editing.value?.id,
			copy ? undefined : editing.value?.expected,
		)
	) {
		error.value = i18n.t(
			props.view.presets?.nameTaken(name, copy ? undefined : editing.value?.id)
				? "library.DuplicateName"
				: "library.SaveConflict",
		);
		return;
	}
	editing.value = null;
	discard.value = null;
	tab.value = "presets";
	error.value = "";
	restoreFocus();
};
const apply = (item: SearchPreset) => {
	try {
		if (!props.view.apply?.(item)) throw new Error("No searchable view");
		props.close();
	} catch (cause) {
		props.view.reportError("history.ReuseFailed", cause);
	}
};
const showDetails = (item: SearchHistoryItem) => {
	remember();
	viewingItem.value = item;
};
const tabScroll = { history: 0, presets: 0 };
const switchTab = (value: "history" | "presets") => {
	if (tab.value === value) return;
	tabScroll[tab.value] = list.value?.scrollTop ?? 0;
	tab.value = value;
	selectedTexts.value = new Set();
	void nextTick(() => {
		if (!disposed && list.value) list.value.scrollTop = tabScroll[value];
	});
};
const tabKey = (event: KeyboardEvent) => {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	switchTab(
		event.key === "Home"
			? "presets"
			: event.key === "End"
				? "history"
				: tab.value === "history"
					? "presets"
					: "history",
	);
	(event.currentTarget as HTMLElement).parentElement
		?.querySelector<HTMLButtonElement>(`#${id}-${tab.value}`)
		?.focus();
};
const confirmButton = shallowRef<HTMLButtonElement>();
const keepEditing = () => {
	discard.value = null;
	void nextTick(() => editor.value?.focus());
};
watch(discard, (value) => {
	if (value) void nextTick(() => confirmButton.value?.focus());
});
</script>

<template>
	<div
		ref="root"
		class="nya-history-modal nya-library"
		:class="{ 'nya-library--editing': editing, 'nya-library--detail': viewingItem }"
	>
		<div v-if="discard" class="nya-library-confirm" role="alert">
			<p>{{ i18n.t("library.Unsaved") }}</p>
			<div class="nya-library-actions">
				<button ref="confirmButton" class="nya-library-secondary" @click="keepEditing">
					{{ i18n.t("library.KeepEditing") }}</button
				><button class="mod-warning nya-library-danger" @click="discardDraft">
					{{ i18n.t("library.Discard") }}
				</button>
			</div>
		</div>
		<template v-if="editing">
			<div class="nya-library-header">
				<h2>{{ editing.id ? i18n.t("library.Edit") : i18n.t("library.Save") }}</h2>
			</div>
			<p v-if="error" role="alert" class="nya-library-error">{{ error }}</p>
			<PresetEditor
				ref="editor"
				:name="editing.name"
				:recipe="editing.recipe"
				:presets="presets"
				:preset-id="editing.id"
				@save="save"
				@cancel="back"
			/>
		</template>
		<HistoryDetail
			v-else-if="viewingItem"
			:item="viewingItem"
			@close="back"
			@copy="copy"
			@reuse="select"
			@preset="fromHistory"
			@delete="
				(item) => {
					removeTexts(new Set([item.text]));
					viewingItem = null;
					restoreFocus();
				}
			"
		/>
		<div v-show="!editing && !viewingItem" class="nya-library-browser">
			<span :id="`${id}-title`" class="nya-library-sr">{{ i18n.t("library.Title") }}</span>
			<div
				v-if="view.presets"
				class="nya-library-tabs"
				role="tablist"
				:aria-labelledby="`${id}-title`"
			>
				<button
					v-for="value in ['presets', 'history'] as const"
					:id="`${id}-${value}`"
					:key="value"
					role="tab"
					:aria-selected="tab === value"
					:tabindex="tab === value ? 0 : -1"
					:aria-controls="`${id}-panel`"
					@click="switchTab(value)"
					@keydown="tabKey"
				>
					{{ value === "presets" ? i18n.t("library.Presets") : i18n.t("history.Title") }}
				</button>
			</div>
			<label class="nya-library-filter"
				><span class="nya-library-sr">{{ i18n.t("library.Filter") }}</span
				><input
					ref="filterInput"
					v-model="filter"
					type="search"
					:placeholder="i18n.t('library.Filter')"
			/></label>
			<HistorySelectionBar
				v-if="tab === 'history'"
				:history="filteredHistory"
				:total="history.length"
				:limit="listSettings.historyMaxCount"
				v-model:selected-texts="selectedTexts"
				@delete-selected="() => removeTexts(selectedTexts)"
			/>
			<div v-else class="nya-history-toolbar nya-preset-toolbar">
				<button
					v-if="view.presets"
					type="button"
					class="nya-icon-btn nya-library-new"
					:aria-label="i18n.t('library.New')"
					@click="create"
				>
					<Plus :size="20" aria-hidden="true" />
				</button>
				<span class="nya-library-hint">{{
					i18n.t("library.PresetCount", { count: filteredPresets.length })
				}}</span>
			</div>
			<div
				:id="`${id}-panel`"
				ref="list"
				class="nya-library-content"
				:role="view.presets ? 'tabpanel' : undefined"
				:aria-labelledby="view.presets ? `${id}-${tab}` : undefined"
			>
				<HistoryList
					v-if="tab === 'history'"
					:history="filteredHistory"
					:total="history.length"
					:settings="listSettings"
					v-model:selected-texts="selectedTexts"
					@view-details="showDetails"
					@select="select"
					@copy="copy"
					@delete="(item) => removeTexts(new Set([item.text]))"
				/>
				<template v-else>
					<p v-if="legacyDuplicateNames" class="nya-library-hint" role="status">
						{{ i18n.t("library.LegacyDuplicateNames") }}
					</p>
					<p v-if="filteredPresets.length === 0" class="nya-history-empty">
						{{ filter ? i18n.t("library.NoResults") : i18n.t("library.EmptyPresets") }}
					</p>
					<PresetList
						:items="filteredPresets"
						:filtered="!!filter"
						@apply="apply"
						@edit="(item) => start(item, item.name, item)"
						@delete="removePreset"
						@move="(id, before) => view.presets?.move(id, before)"
					/>
				</template>
			</div>
			<div v-if="deleted.length || deletedPreset" class="nya-library-list-feedback">
				<div class="nya-library-undo" role="status">
					<span>{{
						undoError || i18n.t("library.Deleted", { count: deleted.length || 1 })
					}}</span
					><button @click="undo">{{ i18n.t("library.Undo") }}</button>
				</div>
			</div>
		</div>
	</div>
</template>
