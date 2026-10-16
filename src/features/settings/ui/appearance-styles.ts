import {
	appearanceColors,
	colorKeys,
	colorWithOpacity,
	defaultScopeAppearance,
	normalizeAppearanceColors,
	normalizeColor,
	normalizeScopeAppearance,
	type AppearanceColorKey,
	type AppearanceColors,
} from "../model/appearance";

/** Resolve inherited CSS in the owner Document without changing its theme. */
export function resolvedAppearanceColor(root: HTMLElement, key: AppearanceColorKey): string {
	const definition = appearanceColors[key];
	const probe = root.ownerDocument.createElement("span");
	probe.style.color = `var(${definition.variable}, ${definition.default})`;
	probe.hidden = true;
	root.append(probe);
	try {
		const value = root.ownerDocument.defaultView?.getComputedStyle(probe).color ?? "";
		const hex = normalizeColor(value);
		if (hex) return hex;
		const rgb = value.match(
			/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
		);
		if (rgb) {
			const base =
				"#" +
				rgb
					.slice(1, 4)
					.map((channel) =>
						Math.round(Math.min(255, Math.max(0, Number(channel))))
							.toString(16)
							.padStart(2, "0"),
					)
					.join("");
			return colorWithOpacity(base, rgb[4] === undefined ? 100 : Number(rgb[4]) * 100);
		}
		return normalizeColor(definition.default) ?? "#00000000";
	} finally {
		probe.remove();
	}
}

export class AppearanceStyles {
	private documents = new Map<Document, { style?: HTMLStyleElement; cleanup: () => void }>();
	private closed = false;
	constructor(
		private colors: () => AppearanceColors,
		private scope: () => unknown = () => defaultScopeAppearance(),
	) {}
	addDocument(doc: Document) {
		if (this.closed || this.documents.has(doc)) return;
		const release = () => this.removeDocument(doc);
		doc.defaultView?.addEventListener("pagehide", release);
		this.documents.set(doc, {
			cleanup: () => doc.defaultView?.removeEventListener("pagehide", release),
		});
		this.refresh();
	}
	removeDocument(doc: Document) {
		const resource = this.documents.get(doc);
		resource?.style?.remove();
		resource?.cleanup();
		this.documents.delete(doc);
	}
	refresh() {
		if (this.closed) return;
		const colors = normalizeAppearanceColors(this.colors());
		const appearance = normalizeScopeAppearance(this.scope());
		const declarations = [
			...colorKeys
				.filter((key) => colors[key])
				.map((key) => `${appearanceColors[key].variable}: ${colors[key]} !important;`),
			...(appearance.border
				? [`--nya-scope-border-width: ${appearance.width}px !important;`]
				: []),
		].join("\n");
		for (const [doc, resource] of this.documents) {
			if (!declarations) {
				resource.style?.remove();
				delete resource.style;
			} else {
				if (!resource.style) {
					resource.style = doc.createElement("style");
					resource.style.dataset.nyaAppearance = "";
					(doc.head ?? doc.documentElement).append(resource.style);
				}
				resource.style.textContent = `body {\n${declarations}\n}`;
			}
			if (doc.defaultView)
				doc.dispatchEvent(new doc.defaultView.Event("nya-scope-style-change"));
		}
	}
	destroy() {
		this.closed = true;
		for (const doc of this.documents.keys()) this.removeDocument(doc);
	}
}
