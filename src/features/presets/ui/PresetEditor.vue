<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, useId } from "vue";
import { i18n } from "../../../i18n";
import { copyRecipe, presetNameTaken, type SearchPreset, type SearchRecipe } from "../model/preset";
import type { SearchOptions } from "../../../core/search/types";
import MatchOptions from "../../../shared/ui/MatchOptions.vue";

const props = defineProps<{
	name: string;
	recipe: SearchRecipe;
	presets: readonly SearchPreset[];
	presetId?: string | undefined;
}>();
const emit = defineEmits<{
	save: [name: string, recipe: SearchRecipe, copy: boolean];
	cancel: [];
}>();
const id = useId();
const name = shallowRef(props.name);
const search = shallowRef(props.recipe.search);
const options = shallowRef<SearchOptions>({ ...props.recipe.options });
const includeReplacement = shallowRef(props.recipe.replacement !== null);
const collapse = shallowRef(props.recipe.collapse ?? !props.recipe.replacement);
const replacement = shallowRef(props.recipe.replacement?.text ?? "");
// Preserve the legacy storage field without exposing or applying a preset-level override.
const legacyInterpretEscapes = props.recipe.replacement?.interpretEscapes ?? true;
const nameInput = shallowRef<HTMLInputElement>();
const copyInput = shallowRef<HTMLInputElement>();
const copying = shallowRef(false);
const copyName = shallowRef("");
const duplicateName = computed(() => presetNameTaken(props.presets, name.value, props.presetId));
const duplicateCopyName = computed(() => presetNameTaken(props.presets, copyName.value));
const draftRecipe = computed<SearchRecipe>(() => ({
	search: search.value,
	collapse: collapse.value,
	options: { ...options.value },
	replacement: includeReplacement.value
		? { text: replacement.value, interpretEscapes: legacyInterpretEscapes }
		: null,
}));
// Compare the visible draft too: toggling a field off must not silently discard edited text.
const snapshot = () => JSON.stringify([name.value, draftRecipe.value, replacement.value]);
const initial = snapshot();
const dirty = () => snapshot() !== initial || copying.value;
const focus = () => (copying.value ? copyInput.value : nameInput.value)?.focus();
defineExpose({ dirty, focus });
onMounted(() => nameInput.value?.focus());
const save = () => {
	const value = copying.value ? copyName.value : name.value;
	if (
		value.trim() &&
		search.value !== "" &&
		!(copying.value ? duplicateCopyName.value : duplicateName.value)
	)
		emit("save", value, copyRecipe(draftRecipe.value), copying.value);
};
const startCopy = () => {
	copyName.value = name.value;
	copying.value = true;
	void nextTick(() => {
		copyInput.value?.focus();
		copyInput.value?.select();
	});
};
const backToEditor = () => {
	copying.value = false;
	void nextTick(() => nameInput.value?.focus());
};
</script>

<template>
	<form class="nya-recipe-form" @submit.prevent="save()">
		<div
			v-if="copying"
			class="nya-recipe-fields nya-recipe-copy"
			:aria-labelledby="`${id}-copy-title`"
		>
			<h3 :id="`${id}-copy-title`">{{ i18n.t("library.SaveAs") }}</h3>
			<label class="nya-recipe-field">
				<span>{{ i18n.t("library.NewName") }}</span>
				<input
					ref="copyInput"
					v-model="copyName"
					autocomplete="off"
					required
					:aria-invalid="duplicateCopyName"
					:aria-describedby="duplicateCopyName ? `${id}-copy-error` : undefined"
				/>
			</label>
			<p
				v-if="duplicateCopyName"
				:id="`${id}-copy-error`"
				class="nya-library-error"
				role="status"
			>
				{{ i18n.t("library.DuplicateName") }}
			</p>
		</div>
		<div v-show="!copying" class="nya-recipe-fields">
			<label class="nya-recipe-field"
				><span>{{ i18n.t("library.Name") }}</span
				><input
					ref="nameInput"
					v-model="name"
					autocomplete="off"
					:required="!copying"
					:aria-invalid="duplicateName"
					:aria-describedby="duplicateName ? `${id}-name-error` : undefined"
			/></label>
			<p
				v-if="duplicateName"
				:id="`${id}-name-error`"
				class="nya-library-error"
				role="status"
			>
				{{ i18n.t("library.DuplicateName") }}
			</p>
			<section class="nya-recipe-options" :aria-labelledby="`${id}-options`">
				<h3 :id="`${id}-options`">{{ i18n.t("library.MatchOptions") }}</h3>
				<MatchOptions :options="options" interactive @change="options = $event" />
			</section>
			<label class="nya-recipe-field">
				<span>{{ i18n.t("search.tip.FindPlaceholder") }}</span>
				<textarea
					v-model="search"
					rows="4"
					spellcheck="false"
					autocorrect="off"
					autocapitalize="off"
					required
				/>
			</label>
			<label class="nya-recipe-field">
				<span>{{ i18n.t("search.tip.ReplacePlaceholder") }}</span>
				<textarea
					v-model="replacement"
					rows="4"
					spellcheck="false"
					autocorrect="off"
					autocapitalize="off"
					:aria-describedby="`${id}-replacement-help`"
				/>
			</label>
			<section class="nya-recipe-other" :aria-labelledby="`${id}-other`">
				<h3 :id="`${id}-other`">{{ i18n.t("library.OtherSettings") }}</h3>
				<label class="nya-recipe-check"
					><input
						v-model="includeReplacement"
						type="checkbox"
						:aria-describedby="`${id}-replacement-help`"
					/>{{ i18n.t("library.IncludeReplacement") }}</label
				>
				<p :id="`${id}-replacement-help`" class="nya-library-hint">
					{{
						includeReplacement
							? i18n.t("library.EmptyReplacement")
							: i18n.t("library.ReplacementNotSaved")
					}}
				</p>
				<label class="nya-recipe-check"
					><input
						v-model="collapse"
						type="checkbox"
						:aria-describedby="`${id}-collapse-help`"
					/>{{ i18n.t("library.CollapseOnApply") }}</label
				>
				<p :id="`${id}-collapse-help`" class="nya-library-hint">
					{{ i18n.t("library.CollapseOnApplyHint") }}
				</p>
			</section>
		</div>
		<div class="nya-library-footer">
			<div v-if="copying" class="nya-library-actions">
				<button
					type="submit"
					class="mod-cta"
					:disabled="!copyName.trim() || duplicateCopyName || search === ''"
				>
					{{ i18n.t("library.CreatePreset") }}
				</button>
				<button type="button" class="nya-library-secondary" @click="backToEditor">
					{{ i18n.t("library.BackToEditor") }}
				</button>
			</div>
			<div v-else class="nya-library-actions">
				<button
					type="submit"
					class="mod-cta"
					:disabled="!name.trim() || duplicateName || search === ''"
				>
					{{ i18n.t("library.SaveAction") }}
				</button>
				<button type="button" class="nya-library-secondary" @click="emit('cancel')">
					{{ i18n.t("settings.Appearance.cancel") }}
				</button>
				<button
					type="button"
					class="nya-library-secondary"
					:disabled="search === ''"
					@click="startCopy"
				>
					{{ i18n.t("library.SaveAs") }}
				</button>
			</div>
		</div>
	</form>
</template>
