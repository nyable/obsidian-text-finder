// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Toolbar from "../../src/features/finder/ui/FinderToolbar.vue";

vi.mock("../../src/i18n", () => ({ i18n: { t: (key: string) => key } }));

it("compiles the actual Vue toolbar without a legacy component constructor", () => {
	const view = mount(Toolbar, { props: { items: [], run: vi.fn() } });
	expect(view.find(".nya-toolbar").exists()).toBe(true);
	view.unmount();
});
