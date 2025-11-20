<script lang="ts">
	import { i18n } from "./i18n";
	import {
		Trash2,
		Copy,
		ArrowLeft,
		Calendar,
		Clock,
		Hash,
		AlignLeft,
	} from "lucide-svelte";
	import type { SearchHistoryItem } from "./main";
	import { moment } from "obsidian";
	import { createEventDispatcher } from "svelte";

	export let item: SearchHistoryItem;

	const dispatch = createEventDispatcher();

	const formatDate = (timestamp: number) => {
		// @ts-ignore
		return moment(timestamp).format("YYYY-MM-DD HH:mm:ss");
	};

	const formatRelative = (timestamp: number) => {
		// @ts-ignore
		return moment(timestamp).fromNow();
	};

	const close = () => dispatch("close");
	const copy = () => dispatch("copy", item);
	const remove = () => dispatch("delete", item);
</script>

<div class="nya-history-header">
	<div class="nya-history-header-left">
		<button
			class="nya-icon-btn"
			on:click={close}
			title={i18n.t("history.Back")}
		>
			<ArrowLeft size={18} />
		</button>
		<h2>{i18n.t("history.Details")}</h2>
	</div>
</div>
<div class="nya-history-detail">
	<div class="nya-history-detail-meta">
		<div class="nya-history-detail-card">
			<div class="nya-history-card-icon">
				<Calendar size={14} />
			</div>
			<div class="nya-history-card-content">
				<span class="label">{i18n.t("history.Created")}</span>
				<div class="value-group">
					<span class="value"
						>{formatDate(item.createdAt || item.lastUsedAt)}</span
					>
					<span class="value sub"
						>({formatRelative(
							item.createdAt || item.lastUsedAt,
						)})</span
					>
				</div>
			</div>
		</div>
		<div class="nya-history-detail-card">
			<div class="nya-history-card-icon">
				<Clock size={14} />
			</div>
			<div class="nya-history-card-content">
				<span class="label">{i18n.t("history.LastUsed")}</span>
				<div class="value-group">
					<span class="value">{formatDate(item.lastUsedAt)}</span>
					<span class="value sub"
						>({formatRelative(item.lastUsedAt)})</span
					>
				</div>
			</div>
		</div>
		<div class="nya-history-detail-card">
			<div class="nya-history-card-icon">
				<Hash size={14} />
			</div>
			<div class="nya-history-card-content">
				<span class="label">{i18n.t("history.Count")}</span>
				<span class="value">{item.count || 1}</span>
			</div>
		</div>
		<div class="nya-history-detail-card">
			<div class="nya-history-card-icon">
				<AlignLeft size={14} />
			</div>
			<div class="nya-history-card-content">
				<span class="label">Length</span>
				<span class="value">{item.text.length}</span>
			</div>
		</div>
	</div>
	<div class="nya-history-detail-content-wrapper">
		<div class="nya-history-detail-content">
			{item.text}
		</div>
	</div>
	<div class="nya-history-detail-actions">
		<button class="nya-history-btn" on:click={copy}>
			<Copy size={14} />
			{i18n.t("history.Copy")}
		</button>
		<button class="nya-history-btn delete" on:click={remove}>
			<Trash2 size={14} />
			{i18n.t("history.Delete")}
		</button>
	</div>
</div>

<style lang="scss">
	.nya-history-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		h2 {
			margin: 0;
			font-size: 1.4em;
			font-weight: 600;
		}
	}
	.nya-history-header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.nya-history-detail {
		display: flex;
		flex-direction: column;
		gap: 16px;
		flex: 1;
		overflow: hidden;
	}
	.nya-history-detail-meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
		padding: 0 4px;
		flex-shrink: 0;
	}
	.nya-history-detail-card {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px;
		background-color: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		transition: all 0.2s;
		&:hover {
			border-color: var(--interactive-accent);
			background-color: var(--background-secondary-alt);
		}
	}
	.nya-history-card-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background-color: var(--background-primary);
		color: var(--text-muted);
		flex-shrink: 0;
	}
	.nya-history-card-content {
		display: flex;
		flex-direction: column;
		gap: 1px;
		overflow: hidden;
		min-width: 0; /* Fix flex child overflow */
		.label {
			font-size: 10px;
			color: var(--text-muted);
			font-weight: 500;
			text-transform: uppercase;
			letter-spacing: 0.5px;
		}
		.value-group {
			display: flex;
			flex-direction: column;
			line-height: 1.2;
		}
		.value {
			font-size: 12px;
			color: var(--text-normal);
			font-weight: 600;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			&.sub {
				font-size: 10px;
				color: var(--text-muted);
				font-weight: normal;
			}
		}
	}
	.nya-history-detail-content-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		margin-top: 8px;
	}
	.nya-history-detail-content {
		flex: 1;
		background-color: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		padding: 16px;
		white-space: pre-wrap;
		overflow-y: auto;
		font-family: var(--font-monospace);
		font-size: 13px;
		line-height: 1.5;
		user-select: text;
		color: var(--text-normal);
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.02);
	}
	.nya-history-detail-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 8px;
		border-top: 1px solid var(--background-modifier-border);
	}
	.nya-history-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
		background-color: var(--interactive-normal);
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
		color: var(--text-normal);
		box-shadow: none;
		&:hover {
			background-color: var(--interactive-hover);
		}
		&.delete {
			color: var(--text-error);
			border-color: var(--text-error);
			background-color: rgba(var(--text-error-rgb), 0.1);
			&:hover {
				background-color: var(--text-error);
				color: var(--text-on-accent);
			}
		}
	}
	.nya-icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.2s;
		&:hover {
			background-color: var(--background-modifier-active);
			color: var(--text-normal);
		}
	}
</style>
