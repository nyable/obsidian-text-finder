<script setup lang="ts">
import { nextTick, onBeforeUnmount, shallowRef, useId, watch } from "vue";
import { GripVertical, Pencil, Trash2 } from "lucide-vue-next";
import { FinderRecipeFrame } from "../../finder/ui";
import { i18n } from "../../../i18n";
import type { SearchPreset } from "../model/preset";

const props = defineProps<{
	items: SearchPreset[];
	filtered: boolean;
}>();
const emit = defineEmits<{
	apply: [item: SearchPreset];
	edit: [item: SearchPreset];
	delete: [item: SearchPreset];
	move: [id: string, before: string | null];
}>();
const id = useId();
const root = shallowRef<HTMLElement>();
const dragging = shallowRef<string | null>(null);
const boundary = shallowRef<string | null>(null);
const announcement = shallowRef("");
let cancel: (() => void) | undefined;
const move = (item: SearchPreset, before: string | null) => {
	const focused = root.value?.ownerDocument.activeElement as HTMLElement | null;
	emit("move", item.id, before);
	announcement.value = i18n.t("library.MovedPreset", { name: item.name });
	void nextTick(() => {
		if (focused?.isConnected && root.value?.contains(focused))
			focused.focus({ preventScroll: true });
	});
};
const keys = (event: KeyboardEvent, item: SearchPreset) => {
	if (
		props.filtered ||
		event.isComposing ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
	)
		return;
	event.preventDefault();
	event.stopPropagation();
	const index = props.items.findIndex((current) => current.id === item.id);
	if (event.key === "ArrowUp" && index > 0) move(item, props.items[index - 1]!.id);
	if (event.key === "ArrowDown" && index < props.items.length - 1)
		move(item, props.items[index + 2]?.id ?? null);
	if (event.key === "Home") move(item, props.items[0]?.id ?? null);
	if (event.key === "End") move(item, null);
};
const pointer = (event: PointerEvent, item: SearchPreset) => {
	if (props.filtered || (event.button !== 0 && event.pointerType !== "touch")) return;
	cancel?.();
	const handle = event.currentTarget as HTMLButtonElement;
	const doc = handle.ownerDocument,
		win = doc.defaultView;
	const scroll = root.value?.closest<HTMLElement>(".nya-library-content");
	if (!win || !scroll) return;
	event.preventDefault();
	handle.focus({ preventScroll: true });
	const startX = event.clientX,
		startY = event.clientY;
	let x = startX,
		y = startY,
		frame = 0,
		active = false;
	const locate = () => {
		const cards = [
			...(root.value?.querySelectorAll<HTMLElement>("[data-preset-id]") ?? []),
		].filter((card) => card.dataset.presetId !== item.id);
		boundary.value =
			cards.find((card) => {
				const box = card.getBoundingClientRect();
				return y < box.top + box.height / 2;
			})?.dataset.presetId ?? null;
	};
	const animate = () => {
		if (active) {
			const box = scroll.getBoundingClientRect();
			const speed =
				y < box.top + 36
					? -Math.min(12, (box.top + 36 - y) / 3)
					: y > box.bottom - 36
						? Math.min(12, (y - box.bottom + 36) / 3)
						: 0;
			if (speed) scroll.scrollTop += speed;
			locate();
		}
		frame = win.requestAnimationFrame(animate);
	};
	const update = (next: PointerEvent) => {
		if (next.pointerId !== event.pointerId) return;
		x = next.clientX;
		y = next.clientY;
		if (!active && Math.hypot(x - startX, y - startY) >= 5) {
			active = true;
			dragging.value = item.id;
		}
		if (active) {
			next.preventDefault();
			locate();
		}
	};
	const cleanup = () => {
		win.cancelAnimationFrame(frame);
		doc.removeEventListener("pointermove", update);
		doc.removeEventListener("pointerup", finish);
		doc.removeEventListener("pointercancel", abort);
		doc.removeEventListener("keydown", escape);
		win.removeEventListener("blur", cleanup);
		handle.removeEventListener("lostpointercapture", cleanup);
		dragging.value = null;
		boundary.value = null;
		cancel = undefined;
		if (handle.hasPointerCapture?.(event.pointerId))
			handle.releasePointerCapture(event.pointerId);
	};
	const finish = (next: PointerEvent) => {
		if (next.pointerId !== event.pointerId) return;
		if (active && !props.filtered && props.items.some((current) => current.id === item.id))
			move(item, boundary.value);
		cleanup();
	};
	const abort = (next: PointerEvent) => {
		if (next.pointerId === event.pointerId) cleanup();
	};
	const escape = (next: KeyboardEvent) => {
		if (next.key === "Escape") {
			next.preventDefault();
			next.stopPropagation();
			cleanup();
		}
	};
	doc.addEventListener("pointermove", update, { passive: false });
	doc.addEventListener("pointerup", finish);
	doc.addEventListener("pointercancel", abort);
	doc.addEventListener("keydown", escape);
	win.addEventListener("blur", cleanup);
	handle.addEventListener("lostpointercapture", cleanup);
	handle.setPointerCapture?.(event.pointerId);
	cancel = cleanup;
	frame = win.requestAnimationFrame(animate);
};
watch(
	() => [props.filtered, props.items.map((item) => item.id).join("\0")],
	() => cancel?.(),
);
onBeforeUnmount(() => cancel?.());
</script>

<template>
	<div ref="root" class="nya-preset-list" :class="{ 'is-dragging': dragging }">
		<span :id="`${id}-help`" class="nya-library-sr">{{ i18n.t("library.DragHelp") }}</span>
		<span class="nya-library-sr" role="status">{{ announcement }}</span>
		<p v-if="filtered" class="nya-library-hint">{{ i18n.t("library.FilteredOrder") }}</p>
		<div
			v-for="(item, index) in items"
			:key="item.id"
			:data-preset-id="item.id"
			class="nya-preset-item"
			:class="{
				'is-dragged': dragging === item.id,
				'is-drop-before': dragging && boundary === item.id,
			}"
		>
			<button
				type="button"
				class="nya-preset-grip nya-icon-btn"
				:disabled="filtered"
				:aria-labelledby="`${id}-grip-${index}`"
				:aria-describedby="`${id}-help`"
				@pointerdown="pointer($event, item)"
				@keydown="keys($event, item)"
			>
				<GripVertical :size="18" aria-hidden="true" />
				<span :id="`${id}-grip-${index}`" class="nya-library-sr">{{
					i18n.t("library.ReorderPreset", { name: item.name })
				}}</span>
			</button>
			<button type="button" class="nya-preset-apply" @click="emit('apply', item)">
				<span class="nya-preset-name">{{ item.name }}</span>
				<FinderRecipeFrame
					:search="item.search"
					:replacement="item.replacement?.text ?? null"
					:options="item.options"
					:collapse="item.collapse ?? !item.replacement"
				/>
				<span class="nya-library-sr"
					>{{
						i18n.t(
							(item.collapse ?? !item.replacement)
								? "library.Folded"
								: "library.Expanded",
						)
					}}; {{ i18n.t("search.tip.UseRegularExpression") }}:
					{{ i18n.t(item.options.regexMode ? "library.Enabled" : "library.Disabled") }};
					{{ i18n.t("search.tip.MatchCase") }}:
					{{
						i18n.t(item.options.caseSensitive ? "library.Enabled" : "library.Disabled")
					}}; {{ i18n.t("search.tip.MatchWholeWord") }}:
					{{
						i18n.t(item.options.wholeWord ? "library.Enabled" : "library.Disabled")
					}}</span
				>
			</button>
			<div class="nya-preset-actions">
				<button
					type="button"
					class="nya-icon-btn"
					:aria-label="i18n.t('library.Edit')"
					@click="emit('edit', item)"
				>
					<Pencil :size="16" aria-hidden="true" /></button
				><button
					type="button"
					class="nya-icon-btn nya-library-delete-icon"
					:aria-label="i18n.t('history.Delete')"
					@click="emit('delete', item)"
				>
					<Trash2 :size="16" aria-hidden="true" />
				</button>
			</div>
		</div>
		<div
			v-if="dragging && boundary === null"
			class="nya-preset-drop-end"
			aria-hidden="true"
		></div>
	</div>
</template>
