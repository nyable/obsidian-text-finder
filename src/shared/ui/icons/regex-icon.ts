import { createLucideIcon, type IconNode } from "lucide-vue-next";

/** Namespaced so registering it with Obsidian cannot shadow a host or plugin icon. */
export const REGEX_ICON_ID = "text-finder-regex";

/**
 * Derived from Lucide's `regex` icon (ISC; full notice in THIRD_PARTY_NOTICES.md,
 * also embedded in the distributed main.js). https://lucide.dev/icons/regex
 * The upstream rounded square reads as a hollow full stop
 * at 18px; lucide#4611 proposed this solid dot but upstream kept the square (lucide#3804).
 */
const regexIconNode: IconNode = [
	["path", { d: "M17 3v10" }],
	["path", { d: "m12.67 5.5 8.66 5" }],
	["path", { d: "m12.67 10.5 8.66-5" }],
	["circle", { cx: "6", cy: "18", r: "1" }],
];

export const RegexIcon = createLucideIcon("RegexIcon", regexIconNode);

const serialize = ([tag, attrs]: IconNode[number]) =>
	`<${tag}${Object.entries(attrs)
		.map(([key, value]) => ` ${key}="${value}"`)
		.join("")}/>`;

/**
 * addIcon wraps this fragment in a 100×100 SVG. Scale the shared 24×24 geometry,
 * without a nested SVG whose viewport would also be resized by host/plugin CSS.
 */
export const REGEX_ICON_SVG = `<g transform="scale(${100 / 24})" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${regexIconNode
	.map(serialize)
	.join("")}</g>`;
