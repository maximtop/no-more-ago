/**
 * @file Canonical registry of the extension's supported UI languages.
 */

import type { Locale } from "@adguard/translate";

/**
 * One supported extension UI language.
 */
export interface UiLocale {
    /**
     * WebExtension `_locales` directory code, such as `pt_BR`.
     */
    readonly code: string;

    /**
     * Locale `@adguard/translate` uses for plural rules and validation.
     */
    readonly adguardCode: Locale;

    /**
     * English language name used by tooling output and documentation.
     */
    readonly englishName: string;

    /**
     * Whether the language is written right to left.
     */
    readonly rtl: boolean;
}

/**
 * Catalog authored by hand and used whenever a message or locale is missing.
 */
export const BASE_UI_LOCALE = "en";

/**
 * Extra catalog directory the Chromium store dashboards expect, copied from a
 * registry entry. Chromium's runtime reports Norwegian as `nb`, while the Web
 * Store and Edge Add-ons document `no`; there is no second translation.
 */
export const CHROMIUM_LOCALE_ALIAS: Readonly<Record<string, string>> = Object.freeze({
    no: "nb",
});

/**
 * The 40 supported UI languages. This set is intentionally independent of
 * `CANONICAL_RELATIVE_TIME_LOCALES`, which classifies page-owned relative
 * labels and covers a different 40 languages; neither module imports the other.
 */
export const UI_LOCALES: readonly UiLocale[] = [
    { code: "ar", adguardCode: "ar", englishName: "Arabic", rtl: true },
    { code: "bg", adguardCode: "bg", englishName: "Bulgarian", rtl: false },
    { code: "bn", adguardCode: "bn", englishName: "Bengali", rtl: false },
    { code: "ca", adguardCode: "ca", englishName: "Catalan", rtl: false },
    { code: "cs", adguardCode: "cs", englishName: "Czech", rtl: false },
    { code: "da", adguardCode: "da", englishName: "Danish", rtl: false },
    { code: "de", adguardCode: "de", englishName: "German", rtl: false },
    { code: "el", adguardCode: "el", englishName: "Greek", rtl: false },
    { code: "en", adguardCode: "en", englishName: "English", rtl: false },
    { code: "es", adguardCode: "es", englishName: "Spanish", rtl: false },
    { code: "es_419", adguardCode: "es", englishName: "Latin American Spanish", rtl: false },
    { code: "fa", adguardCode: "fa", englishName: "Persian", rtl: true },
    { code: "fi", adguardCode: "fi", englishName: "Finnish", rtl: false },
    { code: "fil", adguardCode: "fil", englishName: "Filipino", rtl: false },
    { code: "fr", adguardCode: "fr", englishName: "French", rtl: false },
    { code: "he", adguardCode: "he", englishName: "Hebrew", rtl: true },
    { code: "hi", adguardCode: "hi", englishName: "Hindi", rtl: false },
    { code: "hr", adguardCode: "hr", englishName: "Croatian", rtl: false },
    { code: "hu", adguardCode: "hu", englishName: "Hungarian", rtl: false },
    { code: "id", adguardCode: "id", englishName: "Indonesian", rtl: false },
    { code: "it", adguardCode: "it", englishName: "Italian", rtl: false },
    { code: "ja", adguardCode: "ja", englishName: "Japanese", rtl: false },
    { code: "ko", adguardCode: "ko", englishName: "Korean", rtl: false },
    { code: "ms", adguardCode: "ms", englishName: "Malay", rtl: false },
    { code: "nb", adguardCode: "nb", englishName: "Norwegian Bokmal", rtl: false },
    { code: "nl", adguardCode: "nl", englishName: "Dutch", rtl: false },
    { code: "pl", adguardCode: "pl", englishName: "Polish", rtl: false },
    { code: "pt_BR", adguardCode: "pt_br", englishName: "Brazilian Portuguese", rtl: false },
    { code: "pt_PT", adguardCode: "pt_pt", englishName: "European Portuguese", rtl: false },
    { code: "ro", adguardCode: "ro", englishName: "Romanian", rtl: false },
    { code: "ru", adguardCode: "ru", englishName: "Russian", rtl: false },
    { code: "sk", adguardCode: "sk", englishName: "Slovak", rtl: false },
    { code: "sr", adguardCode: "sr", englishName: "Serbian", rtl: false },
    { code: "sv", adguardCode: "sv", englishName: "Swedish", rtl: false },
    { code: "th", adguardCode: "th", englishName: "Thai", rtl: false },
    { code: "tr", adguardCode: "tr", englishName: "Turkish", rtl: false },
    { code: "uk", adguardCode: "uk", englishName: "Ukrainian", rtl: false },
    { code: "vi", adguardCode: "vi", englishName: "Vietnamese", rtl: false },
    { code: "zh_CN", adguardCode: "zh_cn", englishName: "Simplified Chinese", rtl: false },
    { code: "zh_TW", adguardCode: "zh_tw", englishName: "Traditional Chinese", rtl: false },
];

const BY_CODE = new Map(UI_LOCALES.map((entry) => [entry.code.toLowerCase(), entry]));

const ENGLISH = BY_CODE.get(BASE_UI_LOCALE) as UiLocale;

const TRADITIONAL_CHINESE_REGIONS = new Set(["TW", "HK", "MO"]);

/**
 * Resolves the browser UI language to the catalog the surfaces should use.
 *
 * Matches an exact registry code first, then applies the same narrowing the
 * extension already uses for page locales, then a bare language match, and
 * finally falls back to English. Never throws.
 *
 * @param uiLanguage - Browser UI language tag, such as `pt-BR` or `es-MX`.
 * @returns - Registry entry to translate with; English when nothing matches.
 */
export function resolveUiLocale(uiLanguage: string): UiLocale {
    let locale: Intl.Locale;
    try {
        locale = new Intl.Locale(uiLanguage);
    } catch {
        return ENGLISH;
    }
    const exact = BY_CODE.get(locale.baseName.replaceAll("-", "_").toLowerCase());
    if (exact) {
        return exact;
    }
    if (locale.language === "zh") {
        const traditional = locale.script === "Hant"
            || TRADITIONAL_CHINESE_REGIONS.has(locale.region ?? "");
        return BY_CODE.get(traditional ? "zh_tw" : "zh_cn") as UiLocale;
    }
    if (locale.language === "pt") {
        return BY_CODE.get(locale.region === "BR" ? "pt_br" : "pt_pt") as UiLocale;
    }
    if (locale.language === "es" && locale.region !== undefined && locale.region !== "ES") {
        return BY_CODE.get("es_419") as UiLocale;
    }
    const aliased = CHROMIUM_LOCALE_ALIAS[locale.language];
    if (aliased) {
        return BY_CODE.get(aliased.toLowerCase()) as UiLocale;
    }
    return BY_CODE.get(locale.language) ?? ENGLISH;
}
