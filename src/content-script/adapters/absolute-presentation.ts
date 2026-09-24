/**
 * @file Recognizes incomplete absolute labels against an already trusted instant.
 */

import {
    activePresentationLocales,
    MAX_PRESENTATION_TEXT_LENGTH,
    readTimestampPresentationText,
} from './relative-presentation';
import {
    TIMESTAMP_VALIDATION_RULE,
    type TimestampCandidate, type TimestampPresentationContext,
} from './types';

/**
 * Date fields whose complete localized labels may be expanded.
 */
const DATE_SHAPES: readonly Intl.DateTimeFormatOptions[] = [
    ...(['short', 'medium', 'long', 'full'] as const).map((dateStyle) => ({ dateStyle })),
    { year: 'numeric' },
    ...(['numeric', '2-digit', 'short', 'long'] as const).flatMap((month) => [
        { year: 'numeric', month, day: 'numeric' } as const,
        { year: 'numeric', month, day: '2-digit' } as const,
        { year: 'numeric', month } as const,
        { month, day: 'numeric' } as const,
    ]),
];

/**
 * Normalizes only display-equivalent spacing and bidi controls.
 *
 * @param text - Existing label or a machine-generated comparison label.
 *
 * @returns - Comparable complete label, without parsing a timestamp from it.
 */
function normalized(text: string): string {
    return text.replace(/\p{Cf}/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/**
 * Accepts only existing date labels that omit information present in the trusted source.
 * Exact comparison to finite locale formats never derives a timestamp from page text.
 *
 * @param candidate - Trusted-source candidate with adapter-selected label ownership.
 * @param context - Current locale and original page-text reader.
 * @param instant - Validated instant, independently extracted from machine data.
 *
 * @returns - Whether a recognized incomplete absolute label may be expanded.
 */
export function isIncompleteAbsolutePresentation(
    candidate: TimestampCandidate,
    context: TimestampPresentationContext,
    instant: Date,
): boolean {
    const presentation = readTimestampPresentationText(candidate, context);
    if (!presentation || presentation.text.length > MAX_PRESENTATION_TEXT_LENGTH) {
        return false;
    }
    const label = normalized(presentation.text);
    if (label.length === 0) {
        return false;
    }
    const confirmed = activePresentationLocales(presentation.source, context.locales);
    if (confirmed.length === 0) {
        return false;
    }
    const locales = new Set<string>(confirmed);
    const pageLocale = presentation.source.closest('[lang]')?.getAttribute('lang') ?? '';
    for (const requested of [pageLocale, ...context.locales]) {
        try {
            const locale = new Intl.Locale(requested);
            if (confirmed.some((value) => new Intl.Locale(value).language === locale.language)) {
                locales.add(locale.baseName);
            }
        } catch {
            // Invalid language evidence cannot qualify another absolute-label shape.
        }
    }
    const raw = candidate.validationRule === TIMESTAMP_VALIDATION_RULE.DERIVED_UNIX_MILLISECONDS
        ? null : candidate.rawDatetime;
    const hasSeconds = raw === null || !/[Tt ]\d{2}:\d{2}(?:[Zz]|[+-]\d{2}:?\d{2})$/u.test(raw);
    const iso = instant.toISOString();
    const sourceIso = raw !== null && /^\d{4}-\d{2}-\d{2}[Tt ]/u.test(raw)
        ? raw.replace(/[t ]/u, 'T') : iso;
    for (const value of [iso, sourceIso]) {
        if (label === normalized(value.slice(0, 10))) {
            return true;
        }
        if (hasSeconds && [value.slice(0, 16), value.slice(0, 16).replace('T', ' ')]
            .some((text) => label === normalized(text))) {
            return true;
        }
    }
    const sourceOffset = sourceIso.match(/([+-]\d{2}):?(\d{2})$/u);
    const zones = new Set(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone]);
    if (sourceOffset) {
        zones.add(sourceOffset[0].replace(/([+-]\d{2})(\d{2})$/u, '$1:$2'));
    }
    for (const locale of locales) {
        for (const timeZone of zones) {
            for (const shape of DATE_SHAPES) {
                const formatter = new Intl.DateTimeFormat(locale, { ...shape, timeZone });
                if (label === normalized(formatter.format(instant))) {
                    return true;
                }
            }
            if (hasSeconds) {
                for (const dateStyle of ['short', 'medium', 'long'] as const) {
                    const formatter = new Intl.DateTimeFormat(locale, {
                        dateStyle, timeStyle: 'short', timeZone,
                    });
                    if (label === normalized(formatter.format(instant))) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}
