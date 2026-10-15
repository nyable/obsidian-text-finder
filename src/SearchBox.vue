<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, shallowReactive, watchEffect, watchPostEffect, toRefs } from "vue";
import { X, ChevronDown, ChevronRight, Search } from "lucide-vue-next";
import type { EditorSearch } from "./editor-extension";
import type { MarkdownView } from "obsidian";
import { i18n } from "./i18n";
import { createFinderSession } from "./finder-session";
import { actionDirective } from "./ui/dom-action";
import Toolbar from "./Toolbar.vue";
import SearchStatus from "./SearchStatus.vue";
import { defaultToolbar } from "./toolbar";
const props = defineProps<{editorSearch: EditorSearch; ownerView: MarkdownView; cid: string}>();
let cleanup: (() => void) | void;
const session = createFinderSession(props.editorSearch, props.ownerView, props.cid, {
 reactive: shallowReactive, tick: nextTick,
 onMount(callback) { onMounted(() => { cleanup = callback(); }); }
});
onBeforeUnmount(() => cleanup?.());
const {state} = session;
const {readingMode, readingPending, readingUnsupported, readingError, workerError, replacementTask,
 replacementCommittedError, docked, dockSide, mobileInlineTarget, autoDock, statusContext,
 scopeEnabled, scopeBlocked, scopeEmpty, cache, searchToolbar, replaceToolbar, historyEnabled,
 replaceOffset, searchActionsWidth} = toRefs(state);
const {editorSearch, ownerView, cid} = props;
const {isMobile, iconSize, onSearchChanged, onReplaceChanged, onFinderKeyDown, enterOnReplacer, defaultEnterEvent,
 runToolbarAction, retrySynchronously, retrySearch, expandFromClick, dockMenu, moveFinderKey, closeFinder, toggleCollapse, setVisible} = session;
const isCollapsed = computed(() => state.readingMode || cache.value.collapse);
const expanded = computed(() => cache.value.visible && !state.docked);
const finderTabIndex = computed(() => !expanded.value ? -1 : isCollapsed.value ? 0 : 1);
const commonTabIndex = computed(() => !expanded.value ? -1 : isCollapsed.value ? 0 : 2);
const replacerTabIndex = computed(() => !expanded.value || isCollapsed.value ? -1 : 1);
const customToolbar = computed(() => {
 // Detect layout against the original defaults, not the current saved layout.
 return state.searchToolbar.some((item,index) => item.id !== defaultToolbar("search")[index]?.id || item.placement !== defaultToolbar("search")[index]?.placement)
 || state.replaceToolbar.some((item,index) => item.id !== defaultToolbar("replace")[index]?.id || item.placement !== defaultToolbar("replace")[index]?.placement);
});
watchEffect(() => { if (state.readingMode || isCollapsed.value || customToolbar.value) { state.replaceOffset = undefined; state.searchActionsWidth = undefined; } });
watchPostEffect(() => { if (state.finderEl) session.syncFinderVisibility(); });
const vGuardHiddenFocus = actionDirective(session.guardHiddenFocus);
const vPositionFinder = actionDirective(session.positionFinder);
const vAlignRows = actionDirective(session.alignRows);
const vDragToMove = actionDirective(session.dragToMove);
const vTrackComposition = actionDirective((node) => session.trackComposition(node as HTMLTextAreaElement));
defineExpose(session);
</script>

<template>

<div :class="[`nya-finder ${cache.visible ? 'nya-finder--active' : 'nya-finder--hidden'}`, {'nya-finder--collapsed': isCollapsed}, {'nya-finder--reading': readingMode}, {'nya-mobile': isMobile}, {'nya-finder--custom-toolbar': customToolbar}, {'nya-finder--docked': docked}, {'nya-finder--dock-left': dockSide === 'left'}]" :style="[{'visibility': cache.visible ? 'visible' : 'hidden'}]"
	:ref="(node) => state.finderEl = node as HTMLDivElement"
	v-guardHiddenFocus
	:aria-hidden="!cache.visible"
	:data-cid="cid"
	v-positionFinder="{ visible: cache.visible, docked, side: dockSide, toolsHeight: isMobile ? 40 : 0, autoDock }"
	v-alignRows="[isCollapsed, customToolbar, searchToolbar, replaceToolbar]"
>
	<SearchStatus :visible="expanded" :pending="readingPending" :unsupported="readingUnsupported"
		:error="readingError" :query="cache.search" :context="statusContext" :retry="retrySearch"
		:readingMode="readingMode" :workerError="workerError" :synchronousRetry="retrySynchronously" :cancel="() => setVisible(false)"
		:committed="replacementCommittedError"
		:replacing="replacementTask?.phase === 'prepare'" :rematching="replacementTask?.phase === 'committed'"
		:nativeFind="() => editorSearch.openNativeSearch(ownerView)" />
	<template v-if="docked">
		<div class="nya-dock-tab">
			<button type="button" class="nya-dock-expand" :tabindex="cache.visible ? 0 : -1" @click="expandFromClick" v-dragToMove="cache.visible"
				@keydown="moveFinderKey" @contextmenu="dockMenu"
				:aria-labelledby="`nya-expand-label-${cid}`" aria-expanded="false" :aria-busy="readingPending">
				<span :id="`nya-expand-label-${cid}`" class="nya-move-help">{{ i18n.t("search.tip.ExpandFinder") }}</span>
				<Search :size="16" aria-hidden="true" />
				<template v-if="readingPending || readingError || readingUnsupported">
					<span class="nya-dock-state" role="status" :aria-label="i18n.t(readingPending ? 'search.MatchPending' : 'search.StatusError')">{{ readingPending ? "…" : "!" }}</span>
				</template>
			</button>
		</div>
	</template>
	<template v-if="!isMobile">
		<div class="nya-dragger nya-drag-handle" v-dragToMove="expanded" role="button" :tabindex="expanded ? 0 : -1"
			:aria-labelledby="`nya-move-label-${cid}`" @keydown="moveFinderKey">
			<span :id="`nya-move-label-${cid}`" class="nya-move-help">{{ i18n.t("search.tip.MoveFinder") }}</span>
		</div>
	</template><template v-else>
		<div class="nya-dragger"></div>
	</template>
	<template v-if="!readingMode">
	<div :class="[`nya-toggle nya-focus`]"
		
		@click="toggleCollapse"
		role="button"
		:tabindex="expanded ? 0 : -1"
		:aria-label="i18n.t('search.tip.ToggleReplace')"
		@keydown="defaultEnterEvent"
	>
		<template v-if="isCollapsed">
			<ChevronRight :size="iconSize" />
		</template><template v-else>
			<ChevronDown :size="iconSize" />
		</template>
	</div>
	</template>
	<div class="main-part">
		<div class="finder">
			<textarea
				v-trackComposition
				wrap="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				@input="onSearchChanged"
				@keydown="onFinderKeyDown"
				rows="1"
				class="nya-input"
				:ref="(node) => state.searchEl = node as HTMLTextAreaElement"
				:value="cache.search"
				:placeholder="i18n.t('search.tip.FindPlaceholder')"
				:tabindex="finderTabIndex"
			/>
			<template v-if="isMobile">
				<div class="nya-float-act">
					<button type="button" class="nya-move-handle nya-focus" :tabindex="commonTabIndex"
						:aria-labelledby="`nya-move-label-${cid}`" v-dragToMove="expanded" @keydown="moveFinderKey">
						<span :id="`nya-move-label-${cid}`" class="nya-move-help">{{ i18n.t("search.tip.MoveFinder") }}</span>
						<span class="nya-move-bar" aria-hidden="true"></span>
					</button>
					<div class="nya-float-tip">
						<template v-if="readingPending || readingUnsupported || readingError">
							<div :aria-label="i18n.t(readingPending ? (readingMode ? 'search.ReadingPending' : 'search.MatchPending') : 'search.StatusError')" :title="i18n.t(readingPending ? (readingMode ? 'search.ReadingPendingDetail' : 'search.MatchPending') : 'search.StatusError')" :aria-busy="readingPending">{{ readingPending ? "…" : "!" }}</div>
						</template><template v-else-if="cache.matches.length > 0">
							<div>
								{{ i18n.t("search.tip.HasResults", {
									current: cache.index + 1,
									total: cache.matches.length,
								}) }}
							</div>
						</template><template v-else>
							<div :style="[cache.search ? 'color:red' : '']" >
								{{ i18n.t("search.tip.NoResults") }}
							</div>
						</template>
					</div>
					<div class="nya-mobile-actions">
						<div class="nya-mobile-inline" :ref="(node) => state.mobileInlineTarget = node as HTMLDivElement"></div>
						<div :class="[{'nya-mobile-close': isMobile}]"
							class="nya-btn nya-focus"
							
							@click="closeFinder"
							role="button"
							:tabindex="commonTabIndex"
							@keydown="defaultEnterEvent"
							:aria-label="i18n.t('search.tip.Close')"
						>
							<X :size="iconSize" />
						</div>
					</div>
				</div>
			</template><template v-else>
				<div class="nya-tip">
					<template v-if="readingPending || readingUnsupported || readingError">
						<div :aria-label="i18n.t(readingPending ? (readingMode ? 'search.ReadingPending' : 'search.MatchPending') : 'search.StatusError')" :title="i18n.t(readingPending ? (readingMode ? 'search.ReadingPendingDetail' : 'search.MatchPending') : 'search.StatusError')" :aria-busy="readingPending">{{ readingPending ? "…" : "!" }}</div>
					</template><template v-else-if="cache.matches.length > 0">
						<div>
							{{ i18n.t("search.tip.HasResults", {
								current: cache.index + 1,
								total: cache.matches.length,
							}) }}
						</div>
					</template><template v-else>
						<div :style="[cache.search ? 'color:red' : '']" >
							{{ i18n.t("search.tip.NoResults") }}
						</div>
					</template>
				</div>
			</template>
			<div class="finder-act">
				<Toolbar :items="searchToolbar" :run="runToolbarAction" :regexMode="cache.options.regexMode"
					:caseSensitive="cache.options.caseSensitive" :wholeWord="cache.options.wholeWord" :historyEnabled="historyEnabled" :tabindex="commonTabIndex" :visible="expanded"
					:selection="scopeEnabled || scopeBlocked" :selectionUnavailable="scopeBlocked || scopeEmpty" :readingMode="readingMode"
					:inlineTarget="isMobile ? mobileInlineTarget : undefined" />
				<template v-if="!isMobile">
					<div
						class="nya-btn nya-focus"
						@click="closeFinder"
						role="button"
						:tabindex="commonTabIndex"
						@keydown="defaultEnterEvent"
						:aria-label="i18n.t('search.tip.Close')"
					>
						<X :size="iconSize" />
					</div>
				</template>
			</div>
		</div>
		<div :style="[isCollapsed ? 'display: none' : '']" class="replacer" >
			<textarea
				:ref="(node) => state.replaceEl = node as HTMLTextAreaElement"
				v-trackComposition
				wrap="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				rows="1"
				class="nya-input"
				:value="cache.replace"
				@input="(event) => { cache.replace = (event.target as HTMLTextAreaElement).value; onReplaceChanged(); }"
				@keydown="enterOnReplacer"
				:placeholder="i18n.t('search.tip.ReplacePlaceholder')"
				:tabindex="replacerTabIndex"
			/>
			<div :style="[{'padding-right': replaceOffset === undefined ? undefined : `${replaceOffset}px`}, {'--nya-search-actions-width': searchActionsWidth === undefined ? undefined : `${searchActionsWidth}px`}]" class="replacer-act"
				
				>
				<Toolbar :items="replaceToolbar" :run="runToolbarAction" :tabindex="commonTabIndex" :visible="expanded && !isCollapsed" />
			</div>
		</div>
	</div>
</div>

</template>
<style scoped lang="scss">
	@use "./styles/finder-primitives" as finder;
	.nya-finder {
		@include finder.surface;
		position: absolute;
		transition:
			transform 0.2s linear,
			opacity 0.2s linear,
			right 0.3s cubic-bezier(0.45, 0.05, 0.55, 0.95);
		height: 72px;
		min-width: min(var(--nya-default-width), var(--nya-available-width, 100vw));
		max-width: var(--nya-available-width, calc(100vw - 16px));
		top: 88px;
		right: 48px;
		z-index: 20;
		display: flex;
		flex-direction: row;
		justify-content: center;
		align-items: center;
		&--dragging { transition: opacity 0.12s ease; opacity: 0.8; user-select: none; cursor: grabbing; }
		&[data-dock-preview="left"] { border-left-color: var(--interactive-accent); box-shadow: -3px 0 0 var(--interactive-accent); }
		&[data-dock-preview="right"] { border-right-color: var(--interactive-accent); box-shadow: 3px 0 0 var(--interactive-accent); }
		&.nya-finder--docked {
			min-width: 0; width: 30px !important;
			background-color: var(--background-secondary);
			border-color: var(--background-modifier-border);
			border-radius: 8px; box-shadow: none;
			// Compact positioning must not sample a moving transform/right offset.
			transition: opacity 0.12s ease;
			.main-part, .nya-toggle, .nya-dragger, .nya-float-act { display: none !important; }
		}
		.nya-dock-tab button {
			display: flex; align-items: center; justify-content: center; margin: 0; padding: 0;
			width: 32px; height: 100%; border: 0; border-radius: inherit;
			box-shadow: none; background: transparent; color: var(--text-normal);
			&:hover { background: var(--background-modifier-hover); }
			&:active { background: var(--background-modifier-active-hover, var(--background-modifier-hover)); }
			&:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
		}
		.nya-drag-handle, .nya-move-handle, .nya-dock-expand { touch-action: none; cursor: grab; }
		&--dragging .nya-drag-handle, &--dragging .nya-move-handle, &--dragging .nya-dock-expand { cursor: grabbing; }
		.nya-drag-handle { position: relative; outline-offset: 2px; }
		.nya-drag-handle::after { content: ""; position: absolute; left: -6px; right: -2px; top: 0; bottom: 0; }
		.nya-drag-handle:focus-visible { outline: 2px solid var(--interactive-accent); }
		.nya-dock-tab { display: flex; width: 100%; height: 100%; border-radius: inherit; }
		.nya-dock-tab button { width: 100%; }
		.nya-dock-tab .nya-dock-expand { position: relative; }
		.nya-dock-state { position: absolute; top: 0; right: 2px; font-size: 12px; }
		// overflow: hidden;

		&--collapsed {
			height: 38px;
		}
		&.nya-finder--docked { height: 30px; }

		&--hidden {
			transform: translateY(-100%);
			opacity: 0;
			user-select: none;
			pointer-events: none;
		}

		&--active {
			transform: translateY(0);
		}

		// 切换按钮
		.nya-toggle {
			width: 16px;
			height: calc(100% - 4px);
			margin-right: 2px;
			margin-left: 2px;
			display: flex;
			justify-content: center;
			align-items: center;
		}
		//拖拽按钮
		.nya-dragger {
			width: 1px;
			height: 100%;
			border-left: 3px solid var(--nya-dragger-color);
			border-radius: 4px 0 0 4px;
			// cursor: ew-resize;
			&:active {
				filter: brightness(1.3);
			}
		}

		.main-part {
			min-width: 0;
			padding: 4px 0px;
			flex: 1;
			flex-direction: column;
			height: 100%;
			display: flex;
			// 搜索框容器
			.finder {
				display: flex;
				margin-bottom: 6px;
			}
			// 替换框容器
			.replacer {
				display: flex;
			}
			// 搜索框的操作区
			.finder-act {
				display: flex;
				justify-content: flex-end;
				align-items: center;
				height: 28px;
				min-width: 140px;
				margin-left: 4px;
			}
			// 替换框的操作区
			.replacer-act {
				display: flex;
				justify-content: flex-end;
				align-items: center;
				height: 28px;
				min-width: 140px;
				// Legacy fallback: counter gutter + search actions, minus replacement actions.
				padding-right: calc(108px + var(--nya-search-actions-width, 140px) - 64px);
				margin-left: 4px;
			}
		}

		&.nya-finder--reading .main-part {
			padding-left: 8px;
		}

		&.nya-finder--custom-toolbar .main-part {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto auto;
			grid-template-rows: 28px 28px;
			row-gap: 6px;
			.finder, .replacer { display: contents; }
			.finder .nya-input { grid-column: 1; grid-row: 1; }
			.finder .nya-tip { grid-column: 2; grid-row: 1; }
			.finder-act { grid-column: 3; grid-row: 1; min-width: 0; }
			.replacer .nya-input { grid-column: 1; grid-row: 2; }
			.replacer-act { grid-column: 2 / 4; grid-row: 2; padding-right: 0; min-width: 0; justify-content: flex-start; }
		}
	}
	.nya-tip {
		@include finder.counter;
	}

	.nya-btn {
		@include finder.button;
	}
	.nya-input {
		@include finder.input;
		min-width: 0; flex: 1;
	}
	.nya-focus {
		@include finder.focus;
	}
	.nya-move-help { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

	.is-mobile {
		.nya-finder.nya-mobile {
			.nya-move-handle, .nya-dock-expand { -webkit-touch-callout: none; user-select: none; }
			// Expansion changes right/transform; measuring an animated base would
			// leave a stale translate that pushes the panel out after the animation.
			transition: opacity 0.2s linear;
			&.nya-finder--dragging, &.nya-finder--docked { transition: opacity 0.12s ease; }
			box-sizing: border-box;
			height: auto;
			min-width: 0;
			max-width: min(416px, var(--nya-available-width, calc(100vw - 16px)));
			width: 100%;
			right: 50%;
			transform: translateX(50%);
			&.nya-finder--docked {
				width: 40px !important; height: 40px;
				right: 8px; transform: none;
				&.nya-finder--dock-left { left: 8px; right: auto; }
			}
			.main-part {
				height: auto; padding: 0; gap: 0;
				.finder, .replacer {
					box-sizing: border-box; min-height: 38px; padding: 4px 0;
					margin: 0; align-items: center;
				}
			}
			.nya-tip {
				background-color: var(--background-primary);
				top: -22px;
				position: absolute;
				right: 0px;
				padding: 2px 4px;
				text-align: center;
				border-radius: 2px;
				border: 1px solid var(--modal-border-color);
			}

			.nya-float-act {
				font-size: 12px;
				background-color: var(--background-primary);
				bottom: 100%; left: -1px; top: auto;
				position: absolute;
				right: -1px;
				border-radius: 4px 4px 0 0;
				border: 1px solid var(--modal-border-color);
				box-sizing: border-box; min-height: 40px; padding: 4px;
				height: auto;
				display: grid;
				grid-template-columns: minmax(0, 1fr) 72px minmax(0, 1fr);
				align-items: center;
				.nya-move-handle {
					grid-column: 2; grid-row: 1; align-self: start;
					box-sizing: border-box; width: 72px; height: 30px; min-height: 0;
					margin: 0; padding: 4px 0 0; display: flex; align-items: flex-start; justify-content: center;
					border: 0; border-radius: 4px; box-shadow: none; background: transparent;
					color: var(--text-muted); cursor: grab;
					&:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
				}
				.nya-move-bar { width: 32px; height: 4px; border-radius: 2px; background: currentColor; pointer-events: none; }
				.nya-mobile-actions {
					grid-column: 3; grid-row: 1; min-width: 0; display: flex;
					justify-content: flex-end; align-items: center; flex-wrap: wrap;
					> .nya-btn { flex-shrink: 0; }
				}
				.nya-mobile-inline { display: flex; flex-wrap: wrap; align-items: center; min-width: 0; }
				.nya-mobile-inline { flex-shrink: 1; max-width: calc(100% - 28px); }
				.nya-float-tip {
					grid-column: 1; grid-row: 1;
					display: flex;
					align-items: center;
					font-size: 12px;
					text-align: left;
					font-family: auto;
					min-width: 0;
					flex: 1; max-width: 100%;
					overflow: hidden;
					text-wrap: nowrap;
					padding: 0 4px;
					> div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				}
			}

			.nya-input {
				box-sizing: border-box; min-width: 0; min-height: 0;
				height: 30px; margin: 0; padding: 4px 6px;
				font-family: var(--font-interface); font-size: 16px; line-height: 20px;
				border-width: 1px; border-style: solid; border-color: var(--background-modifier-border);
				overflow: auto; overscroll-behavior: contain;
				&:focus { border-color: var(--nya-focus-border-color); }
				&::-webkit-scrollbar {
					display: none;
				}
			}
			.finder-act {
				height: 30px;
				min-width: unset;
				width: auto;
				flex-shrink: 0;
			}
			.replacer-act {
				height: 30px;
				min-width: unset;
				width: 112px;
				justify-content: flex-start;
				padding-right: unset;
			}
			&.nya-finder--custom-toolbar .main-part {
				display: flex;
				.finder, .replacer { display: flex; }
				.finder-act { width: auto; }
				.replacer-act { width: auto; justify-content: flex-start; }
			}
		}
	}
	@media (prefers-reduced-motion: reduce) { .nya-finder { transition: none !important; } }
</style>
