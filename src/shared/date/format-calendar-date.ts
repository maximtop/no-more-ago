/**
 * @file Locale-aware presentation for calendar dates without instant semantics.
 */

import { tz } from '@date-fns/tz';
import { format } from 'date-fns';

import { DATE_PRECISION } from '../settings/precision-policy';
import {
    DEFAULT_DISPLAY_SETTINGS,
    FORMAT_MODE,
    type DisplaySettings,
} from '../settings/snapshot';

import { resolveDateLocale } from './date-locale';
import { projectPrecisionPattern } from './precision-pattern';

import type { CalendarDate } from './calendar-date';

/**
 * Creates a private stable UTC anchor used only by the presentation boundary.
 *
 * @param value - Validated calendar date.
 *
 * @returns - UTC midday anchor carrying the same calendar components.
 */
function createFormattingAnchor(value: CalendarDate): Date {
    const anchor = new Date(0);
    anchor.setUTCFullYear(value.year, value.month - 1, value.day);
    anchor.setUTCHours(12, 0, 0, 0);
    return anchor;
}

/**
 * Formats a calendar date with the stable localized medium date presentation.
 *
 * @param value - Validated calendar date.
 * @param locales - Preferred browser locales.
 *
 * @returns - Localized date-only text.
 */
function systemCalendarFormat(
    value: CalendarDate,
    locales: readonly string[],
): string {
    const formatter = new Intl.DateTimeFormat(
        locales.length === 0 ? undefined : [...locales],
        { dateStyle: 'medium', timeZone: 'UTC' },
    );
    return formatter.format(createFormattingAnchor(value));
}

/**
 * Formats a calendar date without consulting a configured time zone.
 *
 * @param value - Validated calendar date.
 * @param locales - Preferred browser locales.
 * @param display - Validated format choices; its configured time zone is ignored.
 *
 * @returns - Localized date-only text.
 */
export function formatCalendarDate(
    value: CalendarDate,
    locales: readonly string[],
    display: DisplaySettings = DEFAULT_DISPLAY_SETTINGS,
): string {
    const fallback = systemCalendarFormat(value, locales);
    if (display.formatMode === FORMAT_MODE.SYSTEM) {
        return fallback;
    }
    try {
        const pattern = projectPrecisionPattern(display.pattern, DATE_PRECISION.DAY, locales);
        if (pattern === null) {
            return fallback;
        }
        const text = format(createFormattingAnchor(value), pattern, {
            locale: resolveDateLocale(locales).locale,
            in: tz('UTC'),
        }).trim();
        return text.length === 0 ? fallback : text;
    } catch {
        return fallback;
    }
}
