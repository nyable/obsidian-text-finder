import { createTextVNode, defineComponent } from "vue";

/** Preserve legacy adjacent text-node shaping without introducing an element. */
export default defineComponent({
	props: { value: { type: [String, Number], required: true } },
	setup: (props) => () => createTextVNode(String(props.value)),
});
