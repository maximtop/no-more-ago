/**
 * @file Locale normalization and fallback selection for exact date presentation.
 */

import type { Locale } from "date-fns";
import { de } from "date-fns/locale/de";
import { enGB } from "date-fns/locale/en-GB";
import { enUS } from "date-fns/locale/en-US";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";
import { it } from "date-fns/locale/it";
import { ja } from "date-fns/locale/ja";
import { pt } from "date-fns/locale/pt";
import { ptBR } from "date-fns/locale/pt-BR";
import { ru } from "date-fns/locale/ru";
import { zhCN } from "date-fns/locale/zh-CN";
import { zhTW } from "date-fns/locale/zh-TW";

/**
 * Resolved locale information shared by modern Intl formatting and legacy date-fns callers.
 */
export interface DateLocale {
    /**
     * BCP 47 language tag passed to Intl formatting APIs.
     */
    readonly tag: string;

    /**
     * Two-letter language code used by the legacy date formatter.
     */
    readonly code: string;

    /**
     * Locale object selected for date-fns formatting after tag normalization.
     */
    readonly locale: Locale;
}

const AVAILABLE: readonly DateLocale[] = [
    { tag: "en-US", code: "en-US", locale: enUS },
    { tag: "en-GB", code: "en-GB", locale: enGB },
    { tag: "de", code: "de", locale: de },
    { tag: "fr", code: "fr", locale: fr },
    { tag: "es", code: "es", locale: es },
    { tag: "it", code: "it", locale: it },
    { tag: "pt", code: "pt", locale: pt },
    { tag: "pt-BR", code: "pt-BR", locale: ptBR },
    { tag: "ru", code: "ru", locale: ru },
    { tag: "ja", code: "ja", locale: ja },
    { tag: "zh-CN", code: "zh-CN", locale: zhCN },
    { tag: "zh-TW", code: "zh-TW", locale: zhTW },
];

/**
 * Normalizes a candidate language tag without accepting malformed locale input.
 *
 * @param tag - Candidate BCP 47 language tag.
 * @returns - Canonical language tag, or null when malformed.
 */
function normalized(tag: string): Intl.Locale | undefined {
    try {
        return new Intl.Locale(tag).baseName ? new Intl.Locale(tag) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Normalizes preferred BCP 47 tags, returns the first tag supported by date-fns, and falls back
 * to en-US when no caller preference is usable.
 *
 * @param preferred - Language tags in caller preference order.
 * @returns - First date-fns locale supported by a preferred tag, or en-US.
 */
export function resolveDateLocale(preferred: readonly string[]): DateLocale {
    for (const raw of preferred) {
        if (typeof raw !== "string") {
            continue;
        }
        const locale = normalized(raw);
        if (!locale) {
            continue;
        }
        const base = locale.baseName;
        const exact = AVAILABLE.find(
            (candidate) => candidate.tag.toLowerCase() === base.toLowerCase(),
        );
        if (exact) {
            return exact;
        }
        if (base.toLowerCase().startsWith("zh-hant") || base.toLowerCase().startsWith("zh-tw")) {
            return { tag: "zh-TW", code: "zh-TW", locale: zhTW };
        }
        if (base.toLowerCase().startsWith("zh-hans") || base.toLowerCase().startsWith("zh-cn")) {
            return { tag: "zh-CN", code: "zh-CN", locale: zhCN };
        }
        const language = locale.language.toLowerCase();
        const languageMatch = AVAILABLE.find(
            (candidate) => candidate.tag.toLowerCase() === language,
        );
        if (languageMatch) {
            return languageMatch;
        }
    }
    return { tag: "en-US", code: "en-US", locale: enUS };
}

/**
 * Returns the first supported preferred locale, falling back to the browser default when needed.
 *
 * @param preferred - Language tags in caller preference order.
 * @returns - First supported locale, falling back to the browser default.
 */
export function getDateLocale(preferred: readonly string[]): Locale {
    return resolveDateLocale(preferred).locale;
}
