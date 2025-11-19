import { Modal, App } from "obsidian";
import HistoryModalComponent from "./HistoryModal.svelte";
import type TextFinderPlugin from "./main";

export class HistoryModal extends Modal {
    plugin: TextFinderPlugin;
    component: HistoryModalComponent | undefined;

    constructor(app: App, plugin: TextFinderPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Fix double scrollbar issue
        contentEl.style.overflow = "hidden";
        contentEl.style.display = "flex";
        contentEl.style.flexDirection = "column";
        contentEl.style.height = "100%";
        contentEl.style.padding = "0"; // Move padding to Svelte component

        this.component = new HistoryModalComponent({
            target: contentEl,
            props: {
                plugin: this.plugin,
                modal: this,
            },
        });
    }

    onClose() {
        if (this.component) {
            this.component.$destroy();
        }
        const { contentEl } = this;
        contentEl.empty();
    }
}
