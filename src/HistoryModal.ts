import { Modal, App } from "obsidian";
import HistoryModalComponent from "./HistoryModal.vue";
import { mountView, type MountedView } from "./ui/mount";
import type TextFinderPlugin from "./main";

export class HistoryModal extends Modal {
    plugin: TextFinderPlugin;
    component: MountedView<Record<string, unknown>> | undefined;

    constructor(app: App, plugin: TextFinderPlugin, private closed: () => void = () => {}) {
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
        contentEl.style.padding = "0"; // The Vue view owns the content padding.

        this.component = mountView(HistoryModalComponent, contentEl, {
                plugin: this.plugin,
                modal: this,
        });
    }

    onClose() {
        if (this.component) {
            this.component.destroy();
            this.component = undefined;
        }
        const { contentEl } = this;
        contentEl.empty();
        this.closed();
    }
}
