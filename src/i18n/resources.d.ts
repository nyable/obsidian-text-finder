import type en from "./locale/en.json";
import "i18next";

declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "translation";
		returnNull: false;
		resources: { translation: typeof en };
	}
}
