// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Toolbar from "../../src/features/finder/ui/FinderToolbar.vue";
import MatchOptions from "../../src/shared/ui/MatchOptions.vue";

vi.mock("../../src/i18n", () => ({ i18n: { t: (key: string) => key } }));

const expectSolidDot = (svg: Element | null) => {
	expect(svg).not.toBeNull();
	expect(svg!.querySelector('circle[cx="6"][cy="18"][r="1"]')).not.toBeNull();
	expect(svg!.querySelector('path[d^="M9 17"]')).toBeNull();
};

it("uses the local solid-dot regex icon in the toolbar", () => {
	const view = mount(Toolbar, {
		props: { items: [{ id: "regex", placement: "inline" }], run: vi.fn() },
	});
	expectSolidDot(view.get('[data-toolbar-action="regex"] svg').element);
	view.unmount();
});

it("uses the same regex icon in match options", () => {
	const view = mount(MatchOptions, {
		props: {
			options: { regexMode: false, caseSensitive: false, wholeWord: false },
			interactive: true,
		},
	});
	expectSolidDot(view.get(".nya-match-option svg").element);
	view.unmount();
});
