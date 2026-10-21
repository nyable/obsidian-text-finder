<script setup lang="ts">
import { shallowReactive, toRefs, computed, watchEffect, onBeforeUnmount } from "vue";
import { actionDirective } from "../../../shared/ui/dom-action";
import { i18n } from "../../../i18n";
const local = shallowReactive<{
	delayed: boolean;
	timer: ReturnType<typeof setTimeout> | undefined;
	previousQuery: string;
	previousContext: unknown;
	above: boolean;
}>({
	delayed: false,
	timer: undefined,
	previousQuery: "",
	previousContext: undefined,
	above: false,
});
const props = withDefaults(
	defineProps<{
		visible: boolean;
		pending: boolean;
		unsupported: boolean;
		error?: "failed" | "timeout" | undefined;
		query: string;
		context: unknown;
		retry: () => void;
		nativeFind: () => void;
		readingMode?: boolean;
		workerError?: boolean;
		committed?: boolean;
		modified?: boolean;
		replacing?: boolean;
		rematching?: boolean;
		synchronousRetry?: () => void;
		cancel?: () => void;
	}>(),
	{
		readingMode: true,
		workerError: false,
		committed: false,
		modified: false,
		replacing: false,
		rematching: false,
		synchronousRetry: () => {},
		cancel: () => {},
	},
);
function update(show: boolean, text: string, owner: unknown) {
	if (!show || text !== local.previousQuery || owner !== local.previousContext) {
		clearTimeout(local.timer);
		local.timer = undefined;
		local.delayed = false;
	}
	local.previousQuery = text;
	local.previousContext = owner;
	if (show && !local.delayed && local.timer === undefined)
		local.timer = setTimeout(() => {
			local.timer = undefined;
			local.delayed = true;
		}, 400);
}
function position(node: HTMLElement) {
	const parent = node.parentElement!;
	let win = node.ownerDocument.defaultView;
	let observer: ResizeObserver | undefined;
	let disposed = false;
	const measure = () => {
		if (disposed) return;
		if (win !== node.ownerDocument.defaultView) connect();
		const box = parent.getBoundingClientRect();
		const viewport = win?.visualViewport;
		const owner = parent.parentElement?.getBoundingClientRect();
		const top = Math.max(owner?.top ?? 0, viewport?.offsetTop ?? 0) + 8;
		const bottom =
			Math.min(
				owner?.bottom || Infinity,
				(viewport?.offsetTop ?? 0) + (viewport?.height ?? win?.innerHeight ?? Infinity),
			) - 8;
		const belowSpace = Math.max(0, bottom - box.bottom - 6),
			aboveSpace = Math.max(0, box.top - top - 6);
		local.above = node.scrollHeight > belowSpace && aboveSpace > belowSpace;
		node.style.maxHeight = `${Math.max(0, local.above ? aboveSpace : belowSpace)}px`;
	};
	const disconnect = () => {
		observer?.disconnect();
		win?.removeEventListener("resize", measure);
		win?.visualViewport?.removeEventListener("resize", measure);
		win?.visualViewport?.removeEventListener("scroll", measure);
	};
	const connect = () => {
		disconnect();
		win = node.ownerDocument.defaultView;
		observer = win && "ResizeObserver" in win ? new win.ResizeObserver(measure) : undefined;
		observer?.observe(node);
		win?.addEventListener("resize", measure);
		win?.visualViewport?.addEventListener("resize", measure);
		win?.visualViewport?.addEventListener("scroll", measure);
	};
	connect();
	parent.addEventListener("nya-finder-position", measure);
	measure();
	return {
		update: measure,
		destroy() {
			disposed = true;
			disconnect();
			parent.removeEventListener("nya-finder-position", measure);
		},
	};
}
onBeforeUnmount(() => clearTimeout(local.timer));
const message = computed(() =>
	props.modified
		? "search.ReplacementModified"
		: props.committed
			? "search.ReplacedNavigationFailed"
			: props.workerError
				? "search.WorkerFailed"
				: props.error
					? props.error === "timeout"
						? "search.ReadingTimeout"
						: "search.ReadingFailed"
					: props.unsupported
						? "search.ReadingUnsupported"
						: props.replacing
							? "search.ReplacementPending"
							: props.rematching
								? "search.ReplacementRematching"
								: props.readingMode
									? "search.ReadingPending"
									: "search.MatchPending",
);
watchEffect(() => update(props.visible && props.pending, props.query, props.context));
const { delayed, above } = toRefs(local);
const {
	visible,
	pending,
	unsupported,
	error,
	retry,
	nativeFind,
	workerError,
	synchronousRetry,
	cancel,
} = toRefs(props);
const vPosition = actionDirective(position);
</script>

<template>
	<template v-if="visible && (error || unsupported || (pending && delayed))">
		<div
			:class="[
				{ 'nya-search-status--above': above },
				{ 'nya-search-status--error': error || unsupported },
			]"
			class="nya-search-status"
			role="status"
			aria-live="polite"
			v-position
		>
			<span>{{ i18n.t(message) }}</span>
			<template v-if="error || unsupported">
				<div class="nya-status-actions">
					<template v-if="error"
						><button type="button" @click="retry">
							{{ i18n.t("search.Retry") }}
						</button></template
					>
					<button type="button" @click="nativeFind">
						{{ i18n.t("search.UseNativeFind") }}
					</button>
				</div>
			</template>
			<template v-if="workerError">
				<div class="nya-status-actions">
					<button type="button" @click="synchronousRetry">
						{{ i18n.t("search.SynchronousRetry") }}
					</button>
				</div>
			</template>
			<template v-if="pending">
				<div class="nya-status-actions">
					<button type="button" @click="cancel">
						{{ i18n.t("search.CancelSearch") }}
					</button>
				</div>
			</template>
		</div>
	</template>
</template>
<style scoped>
.nya-search-status {
	overflow-y: auto;
	position: absolute;
	top: calc(100% + 6px);
	left: 22px;
	right: 4px;
	padding: 3px 6px;
	font-size: 12px;
	line-height: 1.5;
	color: var(--text-muted);
	background: var(--background-primary);
	background: color-mix(in srgb, var(--background-primary) 88%, transparent);
	border-radius: 2px;
	pointer-events: none;
	overflow-wrap: anywhere;
}
.nya-search-status--above {
	top: auto;
	bottom: calc(100% + 6px);
}
.nya-search-status--error {
	pointer-events: auto;
	color: var(--text-normal);
}
.nya-status-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 4px;
	pointer-events: auto;
}
.nya-status-actions button {
	font-size: 12px;
	height: auto;
	padding: 3px 6px;
}
</style>
