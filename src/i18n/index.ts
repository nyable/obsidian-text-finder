import i18next from "i18next";
import * as en from "./locale/en.json";
import * as zh_cn from "./locale/zh_cn.json";
void i18next
	.init({
		lng: "en", // if you're using a language detector, do not define the lng option
		fallbackLng: "en",
		debug: false,
		resources: {
			en: {
				translation: en,
			},
			zh_cn: {
				translation: zh_cn,
			},
		},
	})
	.catch((error: unknown) => {
		console.error("Text Finder: translation initialization failed", error);
	});
export function initializeLanguage(locale: string | undefined) {
	if (locale)
		void i18next.changeLanguage(locale.replace("-", "_")).catch((error: unknown) => {
			console.error("Text Finder: language initialization failed", error);
		});
}
export const i18n = i18next;
