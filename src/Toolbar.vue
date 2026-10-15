<script setup lang="ts">
import { nextTick as tick, onBeforeUpdate, shallowReactive, toRefs, computed, watchEffect, useId } from "vue";
import { actionDirective } from "./ui/dom-action";
import { ArrowDown, ArrowUp, ReplaceAll, Replace, Regex, CaseSensitive, WholeWord, TextSelect, History, Ellipsis } from "lucide-vue-next";
import { i18n } from "./i18n";
import { toolbarLabels, type ToolbarItem, type ToolbarAction } from "./toolbar";
import { mobileToolbar } from "./mobile-toolbar";
const local = shallowReactive({open: false, root: undefined as unknown as HTMLDivElement, trigger: undefined as unknown as HTMLDivElement, previousItems: undefined as ToolbarItem[] | undefined, executingToggle: false});
const props = withDefaults(defineProps<{
    items: ToolbarItem[];
    run: (action: ToolbarAction, focusQuery?: boolean) => void;
    regexMode?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    selection?: boolean;
    selectionUnavailable?: boolean;
    readingMode?: boolean;
    historyEnabled?: boolean;
    tabindex?: number;
    visible?: boolean;
    preview?: boolean;
    inlineTarget?: HTMLElement;
}>(), { regexMode: false, caseSensitive: false, wholeWord: false, selection: false, selectionUnavailable: false, readingMode: false, historyEnabled: true, tabindex: 0, visible: true, preview: false });
const icons = { regex: Regex, case: CaseSensitive, wholeWord: WholeWord, selection: TextSelect, previous: ArrowUp, next: ArrowDown, history: History, replace: Replace, replaceAll: ReplaceAll };
const isToggle = (id: ToolbarAction) => id === "regex" || id === "case" || id === "wholeWord" || id === "selection";
onBeforeUpdate(() => {
    if (local.root && props.inlineTarget && local.previousItems !== props.items) {
        const more = local.root.querySelector(".nya-toolbar-overflow"), focused = local.root.ownerDocument.activeElement as HTMLElement | null;
        props.inlineTarget.querySelectorAll<HTMLElement>("[data-toolbar-action]").forEach((el) => local.root.insertBefore(el, more));
        if (focused && local.root.contains(focused))
            focused.focus({ preventScroll: true });
    }
    local.previousItems = props.items;
});
const triggerId = `nya-toolbar-more-${useId()}`;
const panelId = `${triggerId}-panel`;
const summaryId = `${triggerId}-summary`;
const label = (id: ToolbarAction, unavailable: boolean) => i18n.t(id === "selection" && unavailable
    ? "search.tip.FindInSelectionUnavailable" : toolbarLabels[id]);
const execute = (id: ToolbarAction, control?: HTMLElement) => {
    if (props.preview)
        return;
    if (id !== "history" || props.historyEnabled) {
        if (control && isToggle(id)) {
            // Do not briefly focus the query (and summon the mobile keyboard)
            // while adjusting modes in the overflow panel.
            local.executingToggle = true;
            try {
                props.run(id, false);
                control.focus({ preventScroll: true });
            }
            finally {
                local.executingToggle = false;
            }
        }
        else {
            if (local.open)
                local.trigger.focus({ preventScroll: true });
            local.open = false;
            props.run(id);
        }
    }
};
const activate = (event: KeyboardEvent) => {
    if (event.isComposing)
        return;
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        (event.currentTarget as HTMLElement).click();
    }
};
function outside(event: PointerEvent) { if (local.open && !local.root.contains(event.target as Node))
    local.open = false; }
function ownerEvents(node: HTMLElement, _visible: boolean) {
    if (props.preview)
        return {};
    let doc = node.ownerDocument;
    doc.addEventListener("pointerdown", outside);
    return { update() {
            if (node.ownerDocument !== doc) {
                local.open = false;
                doc.removeEventListener("pointerdown", outside);
                doc = node.ownerDocument;
                doc.addEventListener("pointerdown", outside);
            }
        }, destroy() { doc.removeEventListener("pointerdown", outside); } };
}
function positionPanel(node: HTMLElement) {
    const win = node.ownerDocument.defaultView, finder = local.root.closest<HTMLElement>(".nya-finder");
    let dx = 0, dy = 0;
    const measure = () => {
        const owner = finder?.parentElement?.getBoundingClientRect(), viewport = win?.visualViewport;
        const left = Math.max(owner?.left ?? 0, viewport?.offsetLeft ?? 0) + 8;
        const right = Math.min(owner?.right || Infinity, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? win?.innerWidth ?? Infinity)) - 8;
        const top = Math.max(owner?.top ?? 0, viewport?.offsetTop ?? 0) + 8;
        const bottom = Math.min(owner?.bottom || Infinity, (viewport?.offsetTop ?? 0) + (viewport?.height ?? win?.innerHeight ?? Infinity)) - 8;
        node.style.maxWidth = `${Math.max(0, Math.min(300, right - left))}px`;
        node.style.maxHeight = `${Math.max(0, bottom - top)}px`;
        const box = node.getBoundingClientRect(), baseLeft = box.left - dx, baseTop = box.top - dy;
        dx = Math.max(left, Math.min(baseLeft, right - box.width)) - baseLeft;
        dy = (baseTop + box.height > bottom ? Math.max(top, (local.trigger.getBoundingClientRect().top - box.height - 6)) : Math.max(top, baseTop)) - baseTop;
        node.style.translate = `${dx}px ${dy}px`;
    };
    const observer = win && "ResizeObserver" in win ? new win.ResizeObserver(measure) : undefined;
    observer?.observe(node);
    win?.addEventListener("resize", measure);
    finder?.addEventListener("nya-finder-position", measure);
    win?.visualViewport?.addEventListener("resize", measure);
    win?.visualViewport?.addEventListener("scroll", measure);
    measure();
    return { destroy() {
            observer?.disconnect();
            win?.removeEventListener("resize", measure);
            finder?.removeEventListener("nya-finder-position", measure);
            win?.visualViewport?.removeEventListener("resize", measure);
            win?.visualViewport?.removeEventListener("scroll", measure);
        } };
}
async function toggle() {
    local.open = !local.open;
    if (local.open) {
        await tick();
        if (local.open && props.visible && local.root.isConnected)
            panelButtons()[0]?.focus({ preventScroll: true });
    }
}
const panelButtons = () => Array.from(local.root.querySelectorAll<HTMLElement>('.nya-toolbar-menu [role="button"]:not([aria-disabled="true"])'));
function escapePanel(event: KeyboardEvent) {
    if (local.open && event.key === "Escape" && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        local.open = false;
        local.trigger.focus({ preventScroll: true });
    }
}
function panelFocusOut(event: FocusEvent) {
    if (!local.executingToggle && event.relatedTarget !== local.trigger
        && !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
        local.open = false;
}
function panelKeys(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
        return;
    if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const buttons = panelButtons();
        const index = buttons.indexOf(local.root.ownerDocument.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
    }
}

const inline = computed(() => props.items.filter(item => item.placement === "inline"));
const more = computed(() => props.items.filter(item => item.placement === "more"));
watchEffect(() => {if (!props.visible || !more.value.length) local.open = false;});
const controlTabIndex = computed(() => props.visible ? props.tabindex : -1);
const activeIds = computed(() => new Set<ToolbarAction>([...(props.regexMode ? ["regex" as const] : []), ...(props.caseSensitive ? ["case" as const] : []), ...(props.wholeWord ? ["wholeWord" as const] : []), ...(props.selection ? ["selection" as const] : [])]));
const activeMore = computed(() => more.value.filter(item => activeIds.value.has(item.id)));
const moreSummary = computed(() => i18n.t("search.tip.MoreActive", {modes: activeMore.value.map(item => label(item.id, props.selectionUnavailable)).join(", ")}));
const {open, root, trigger} = toRefs(local);
const {items, run, regexMode, caseSensitive, wholeWord, selection, selectionUnavailable, readingMode, historyEnabled, tabindex, visible, preview, inlineTarget} = toRefs(props);
const vOwnerEvents = actionDirective(ownerEvents);
const vMobileToolbar = actionDirective(mobileToolbar);
const vPositionPanel = actionDirective(positionPanel);
</script>

<template>

<div class="nya-toolbar" :data-reading="readingMode" :ref="(node) => local.root = node as HTMLDivElement" v-ownerEvents="visible" v-mobileToolbar="preview ? undefined : inlineTarget">
	<template v-if="preview">
		<template v-for="(item) in inline" :key="item.id">
			<span :class="[{'nya-btn--active': activeIds.has(item.id)}, {'nya-btn--disabled': item.id === 'history' && !historyEnabled}]" class="nya-btn"  
				aria-hidden="true" :data-preview-action="item.id" :data-active="activeIds.has(item.id)">
				<component :is="icons[item.id]" :size="18" />
			</span>
		</template>
		<template v-if="more.length">
			<span class="nya-btn nya-btn--more" aria-hidden="true" data-preview-action="more" :data-has-active="activeMore.length > 0">
				<Ellipsis :size="18" />
				<template v-if="activeMore.length"><span class="nya-toolbar-indicator" aria-hidden="true"></span></template>
			</span>
		</template>
	</template><template v-else>
		<template v-for="(item, index) in inline" :key="item.id">
			<div :class="[{'nya-btn--active': activeIds.has(item.id)}, {'nya-btn--disabled': item.id === 'history' && !historyEnabled}]" :data-toolbar-action="item.id" :data-toolbar-order="index" class="nya-btn nya-focus"  
				role="button" :tabindex="item.id === 'history' && !historyEnabled ? -1 : controlTabIndex" :aria-label="label(item.id, selectionUnavailable)"
				:aria-pressed="isToggle(item.id) ? activeIds.has(item.id) : undefined"
				:aria-disabled="item.id === 'history' && !historyEnabled" @click="() => execute(item.id)" @keydown="activate">
				<component :is="icons[item.id]" :size="18" aria-hidden="true" />
			</div>
		</template>
		<template v-if="more.length">
			<div class="nya-toolbar-overflow">
				<div :class="[{'nya-btn--open': open}]" class="nya-btn nya-focus nya-btn--more" 
					role="button" :tabindex="controlTabIndex" :aria-label="i18n.t('search.tip.More')"
					:id="triggerId" :aria-controls="open ? panelId : undefined" :aria-describedby="activeMore.length ? summaryId : undefined"
					:aria-expanded="open" :ref="(node) => local.trigger = node as HTMLDivElement" @click="toggle" @keydown="(event) => { escapePanel(event); activate(event); }">
					<Ellipsis :size="18" aria-hidden="true" />
					<template v-if="activeMore.length && !open"><span class="nya-toolbar-indicator" aria-hidden="true"></span></template>
				</div>
				<template v-if="activeMore.length"><span :id="summaryId" class="nya-toolbar-help">{{ moreSummary }}</span></template>
				<template v-if="open">
					<div :id="panelId" class="nya-toolbar-menu" role="group" :aria-labelledby="triggerId"
						@focusout="panelFocusOut" v-positionPanel>
						<template v-for="(item) in more" :key="item.id">
							<div :class="[{'nya-btn--active': activeIds.has(item.id)}, {'nya-btn--disabled': item.id === 'history' && !historyEnabled}]" class="nya-btn nya-focus"  
								role="button" :tabindex="item.id === 'history' && !historyEnabled ? -1 : controlTabIndex"
								:aria-label="label(item.id, selectionUnavailable)" :aria-pressed="isToggle(item.id) ? activeIds.has(item.id) : undefined"
								:aria-disabled="item.id === 'history' && !historyEnabled" :data-overflow-action="item.id"
								@click="(event) => execute(item.id, event.currentTarget as HTMLElement)"
								@keydown="(event) => { escapePanel(event); panelKeys(event); activate(event); }">
								<component :is="icons[item.id]" :size="18" aria-hidden="true" />
							</div>
						</template>
					</div>
				</template>
			</div>
		</template>
	</template>
</div>

</template>
<style scoped lang="scss">
	@use "./styles/finder-primitives" as finder;
	.nya-toolbar { display: flex; align-items: center; }
	.nya-btn {
		@include finder.button;
		flex-shrink: 0;
		&--more { position: relative; }
		&--open { box-shadow: inset 0 0 0 1px var(--text-muted); }
		&--disabled { opacity: 0.4; }
	}
	.nya-focus {
		@include finder.focus($keyboardOnly: true);
	}
	.nya-toolbar-indicator {
		position: absolute; top: 1px; right: 1px; width: 5px; height: 5px;
		border-radius: 50%; background-color: var(--interactive-accent); pointer-events: none;
	}
	.nya-toolbar-overflow { position: relative; }
	.nya-toolbar-menu {
		display: flex; flex-wrap: wrap; width: max-content; box-sizing: border-box; overflow: auto;
		position: absolute; top: calc(100% + 6px); right: 0; z-index: 30;
		max-width: min(300px, 85vw); padding: 4px;
		background: var(--background-primary); color: var(--text-normal);
		border: 1px solid var(--modal-border-color); border-radius: 4px;
		box-shadow: 0 0 6px 1px rgba(0, 0, 0, 0.36);
	}
	.nya-toolbar-help { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
