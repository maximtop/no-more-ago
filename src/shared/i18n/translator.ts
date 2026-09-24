/**
 * @file Runtime translation and document setup for the popup and Settings.
 */

import { translate, type I18nInterface } from '@adguard/translate';

import baseMessages from '../../_locales/en/messages.json';

import { BASE_UI_LOCALE, resolveUiLocale, type UiLocale } from './locales';

/**
 * One catalog key present in every shipped locale.
 */
export type MessageKey = keyof typeof baseMessages;

/**
 * Values substituted into a message's `%name%` placeholders.
 */
export type MessageValues = Readonly<Record<string, string | number>>;

/**
 * Text directions shared by the document and UI providers.
 */
export const UI_DIRECTION = {
    LTR: 'ltr',
    RTL: 'rtl',
} as const;

/**
 * Supported document text direction.
 */
export type UiDirection = (typeof UI_DIRECTION)[keyof typeof UI_DIRECTION];

let resolved: UiLocale | undefined;

/**
 * Reads the extension i18n API, which is absent outside an extension context.
 *
 * @returns - The extension i18n API, or undefined when chrome is unavailable.
 */
function extensionI18n(): typeof chrome.i18n | undefined {
    return typeof chrome === 'undefined' ? undefined : chrome.i18n;
}

/**
 * Resolves the registry entry for this document, once per document.
 *
 * The catalog identifies itself because Firefox can select a secondary UI
 * language. Message lookup, plural rules, and document direction must agree.
 *
 * @returns - Registry entry for the browser UI language; English outside an extension.
 */
export function currentUiLocale(): UiLocale {
    resolved ??= resolveUiLocale(extensionI18n()?.getMessage('catalog_locale') || BASE_UI_LOCALE);
    return resolved;
}

/**
 * Text direction implied by the resolved UI locale.
 *
 * @returns - `rtl` for Arabic, Persian and Hebrew; `ltr` otherwise.
 */
export function uiDirection(): UiDirection {
    return currentUiLocale().rtl ? UI_DIRECTION.RTL : UI_DIRECTION.LTR;
}

/**
 * English catalog seen through the untyped key the library asks with. An
 * unknown key resolves to an empty string so the library raises its own
 * "Was unable to find message for key" error, which names the key; indexing
 * blindly would raise a TypeError that does not.
 */
const BASE_MESSAGES: Readonly<Record<string, { readonly message: string }>> = baseMessages;

const i18n: I18nInterface = {
    getMessage: (key) => extensionI18n()?.getMessage(key) ?? '',
    getUILanguage: () => currentUiLocale().adguardCode,
    getBaseMessage: (key) => BASE_MESSAGES[key]?.message ?? '',
    getBaseUILanguage: () => BASE_UI_LOCALE,
};

const translator = translate.createTranslator(i18n);

/**
 * Translates one message, substituting its `%name%` placeholders.
 *
 * @param key - Catalog key present in every shipped locale.
 * @param values - Values for the message's placeholders, if it has any.
 *
 * @returns - Translated text for the resolved UI locale.
 */
export function t(key: MessageKey, values: MessageValues = {}): string {
    const substitutions = uiDirection() === UI_DIRECTION.RTL
        ? Object.fromEntries(Object.entries(values).map(([name, value]) => [
            name,
            typeof value === 'string' ? `\u2066${value}\u2069` : value,
        ]))
        : values;
    return translator.getMessage(key, substitutions);
}

/**
 * Translates one message in the plural form matching a count.
 *
 * @param key - Catalog key whose message carries `|`-separated plural forms.
 * @param count - Quantity selecting the form; it also fills `%count%`.
 *
 * @returns - Translated text for the resolved UI locale.
 */
export function tPlural(key: MessageKey, count: number): string {
    return translator.getPlural(key, count);
}

/**
 * Stamps the resolved locale onto the document before the first React render.
 *
 * Sets the language tag and text direction so assistive technology and
 * Mantine's direction context agree, and replaces the English title the static
 * markup carries as its pre-script default.
 *
 * @param titleKey - Catalog key naming this document.
 */
export function applyDocumentLocale(titleKey: MessageKey): void {
    const entry = currentUiLocale();
    document.documentElement.lang = entry.code.replaceAll('_', '-');
    document.documentElement.dir = uiDirection();
    document.title = t(titleKey);
}
