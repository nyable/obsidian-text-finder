<script setup lang="ts">
defineProps<{ alternate: boolean; text: string }>();
</script>

<template>
	<section>
		<template v-if="alternate">
			<article><span>one</span><span>two</span></article>
			<svg><path d="M0 0L1 1" /></svg>
			<math><mi>x</mi></math>
			<select multiple>
				<option>one</option>
			</select>
		</template>
		<span v-else>{{ text }}</span>
	</section>
</template>
