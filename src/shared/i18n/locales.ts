/**
 * @file Canonical registry of the extension's supported UI languages.
 */

import type { Locale } from '@adguard/translate';

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
     * Whether the language is written right to left.
     */
    readonly rtl: boolean;
}

/**
 * The 40 supported UI languages. This set is intentionally independent of
 * `CANONICAL_RELATIVE_TIME_LOCALES`, which classifies page-owned relative
 * labels and covers a different 40 languages; neither module imports the other.
 */
export const UI_LOCALES = [
    { code: 'ar', adguardCode: 'ar', rtl: true },
    { code: 'bg', adguardCode: 'bg', rtl: false },
    { code: 'bn', adguardCode: 'bn', rtl: false },
    { code: 'ca', adguardCode: 'ca', rtl: false },
    { code: 'cs', adguardCode: 'cs', rtl: false },
    { code: 'da', adguardCode: 'da', rtl: false },
    { code: 'de', adguardCode: 'de', rtl: false },
    { code: 'el', adguardCode: 'el', rtl: false },
    { code: 'en', adguardCode: 'en', rtl: false },
    { code: 'es', adguardCode: 'es', rtl: false },
    { code: 'es_419', adguardCode: 'es', rtl: false },
    { code: 'fa', adguardCode: 'fa', rtl: true },
    { code: 'fi', adguardCode: 'fi', rtl: false },
    { code: 'fil', adguardCode: 'fil', rtl: false },
    { code: 'fr', adguardCode: 'fr', rtl: false },
    { code: 'he', adguardCode: 'he', rtl: true },
    { code: 'hi', adguardCode: 'hi', rtl: false },
    { code: 'hr', adguardCode: 'hr', rtl: false },
    { code: 'hu', adguardCode: 'hu', rtl: false },
    { code: 'id', adguardCode: 'id', rtl: false },
    { code: 'it', adguardCode: 'it', rtl: false },
    { code: 'ja', adguardCode: 'ja', rtl: false },
    { code: 'ko', adguardCode: 'ko', rtl: false },
    { code: 'ms', adguardCode: 'ms', rtl: false },
    { code: 'nb', adguardCode: 'nb', rtl: false },
    { code: 'nl', adguardCode: 'nl', rtl: false },
    { code: 'pl', adguardCode: 'pl', rtl: false },
    { code: 'pt_BR', adguardCode: 'pt_br', rtl: false },
    { code: 'pt_PT', adguardCode: 'pt_pt', rtl: false },
    { code: 'ro', adguardCode: 'ro', rtl: false },
    { code: 'ru', adguardCode: 'ru', rtl: false },
    { code: 'sk', adguardCode: 'sk', rtl: false },
    { code: 'sr', adguardCode: 'sr', rtl: false },
    { code: 'sv', adguardCode: 'sv', rtl: false },
    { code: 'th', adguardCode: 'th', rtl: false },
    { code: 'tr', adguardCode: 'tr', rtl: false },
    { code: 'uk', adguardCode: 'uk', rtl: false },
    { code: 'vi', adguardCode: 'vi', rtl: false },
    { code: 'zh_CN', adguardCode: 'zh_cn', rtl: false },
    { code: 'zh_TW', adguardCode: 'zh_tw', rtl: false },
] as const satisfies readonly UiLocale[];

/**
 * Shipped catalog directory code.
 */
export type UiLocaleCode = (typeof UI_LOCALES)[number]['code'];

/**
 * Catalog used when the browser cannot find a supported language.
 */
export const BASE_UI_LOCALE = 'en' satisfies UiLocaleCode;

/**
 * Chromium store alias of the Norwegian catalog.
 */
export const CHROMIUM_LOCALE_ALIAS = {
    no: 'nb',
} as const satisfies Record<string, UiLocaleCode>;

const ALIAS_BY_CODE = new Map<string, UiLocaleCode>(Object.entries(CHROMIUM_LOCALE_ALIAS));

const BY_CODE = new Map(UI_LOCALES.map((entry) => [entry.code.toLowerCase(), entry]));

const ENGLISH = BY_CODE.get(BASE_UI_LOCALE) as UiLocale;

const TRADITIONAL_CHINESE_REGIONS = new Set(['TW', 'HK', 'MO']);

/**
 * Resolves the browser UI language to the catalog the surfaces should use.
 *
 * Matches an exact registry code first, then applies the same narrowing the
 * extension already uses for page locales, then a bare language match, and
 * finally falls back to English. Never throws.
 *
 * @param uiLanguage - Browser UI language tag, such as `pt-BR` or `es-MX`.
 *
 * @returns - Registry entry to translate with; English when nothing matches.
 */
export function resolveUiLocale(uiLanguage: string): UiLocale {
    let locale: Intl.Locale;
    try {
        locale = new Intl.Locale(uiLanguage);
    } catch {
        return ENGLISH;
    }
    const exact = BY_CODE.get(locale.baseName.replaceAll('-', '_').toLowerCase());
    if (exact) {
        return exact;
    }
    if (locale.language === 'zh') {
        const traditional = locale.script === 'Hant'
            || TRADITIONAL_CHINESE_REGIONS.has(locale.region ?? '');
        return BY_CODE.get(traditional ? 'zh_tw' : 'zh_cn') as UiLocale;
    }
    if (locale.language === 'pt') {
        return BY_CODE.get(locale.region === 'BR' ? 'pt_br' : 'pt_pt') as UiLocale;
    }
    if (locale.language === 'es' && locale.region !== undefined && locale.region !== 'ES') {
        return BY_CODE.get('es_419') as UiLocale;
    }
    const aliased = ALIAS_BY_CODE.get(locale.language);
    if (aliased) {
        return BY_CODE.get(aliased.toLowerCase()) as UiLocale;
    }
    return BY_CODE.get(locale.language) ?? ENGLISH;
}
