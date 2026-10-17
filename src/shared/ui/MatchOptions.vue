<script setup lang="ts">
import { useId } from "vue";
import { Regex, CaseSensitive, WholeWord } from "lucide-vue-next";
import type { SearchOptions } from "../../core/search/types";
import { i18n } from "../../i18n";

const props = defineProps<{ options: Readonly<SearchOptions>; interactive?: boolean }>();
const emit = defineEmits<{ change: [options: SearchOptions] }>();
const id = useId();
const modes = [
	{ key: "regexMode", icon: Regex, label: "search.tip.UseRegularExpression" },
	{ key: "caseSensitive", icon: CaseSensitive, label: "search.tip.MatchCase" },
	{ key: "wholeWord", icon: WholeWord, label: "search.tip.MatchWholeWord" },
] as const;
const toggle = (key: keyof SearchOptions) =>
	emit("change", { ...props.options, [key]: !props.options[key] });
</script>

<template>
	<span
		class="nya-match-options"
		:role="interactive ? 'group' : undefined"
		:aria-labelledby="interactive ? `${id}-label` : undefined"
	>
		<span v-if="interactive" :id="`${id}-label`" class="nya-library-sr">{{
			i18n.t("library.MatchOptions")
		}}</span>
		<template v-for="mode in modes" :key="mode.key">
			<button
				v-if="interactive"
				type="button"
				class="nya-match-option"
				:aria-label="i18n.t(mode.label)"
				:aria-pressed="options[mode.key]"
				@click="toggle(mode.key)"
			>
				<component :is="mode.icon" :size="18" aria-hidden="true" />
			</button>
			<span
				v-else
				class="nya-match-option"
				:class="{ 'is-active': options[mode.key] }"
				role="img"
				:aria-labelledby="`${id}-${mode.key}`"
				:title="`${i18n.t(mode.label)}: ${options[mode.key] ? i18n.t('library.Enabled') : i18n.t('library.Disabled')}`"
				><component :is="mode.icon" :size="18" aria-hidden="true" /><span
					:id="`${id}-${mode.key}`"
					class="nya-library-sr"
					>{{ i18n.t(mode.label) }}:
					{{
						options[mode.key] ? i18n.t("library.Enabled") : i18n.t("library.Disabled")
					}}</span
				></span
			>
		</template>
	</span>
</template>
