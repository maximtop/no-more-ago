/**
 * @file Formats trusted instants using system or user-selected timezone presentation.
 */

import { tz } from '@date-fns/tz';
import { format, intlFormat } from 'date-fns';

import { DATE_PRECISION, precisionForAge } from '../settings/precision-policy';
import {
    DEFAULT_DISPLAY_SETTINGS,
    FORMAT_MODE,
    TIME_ZONE_MODE,
    type DisplaySettings,
} from '../settings/snapshot';

import { resolveDateLocale } from './date-locale';
import { projectPrecisionPattern } from './precision-pattern';
import {
    INVALID_DATE_FORMAT_ERROR,
    UNAVAILABLE_TIME_ZONE_ERROR,
    type DatePresentationError,
} from './presentation-errors';

/**
 * Date text together with the time-zone metadata needed to explain a fallback to callers.
 */
export interface DatePresentationResult {
    /**
     * Localized visible timestamp text shown to the user.
     */
    readonly text: string;

    /**
     * Reason a requested time zone could not be applied to the formatted result.
     */
    readonly error?: DatePresentationError;
}

/**
 * Capability check for named IANA zones, injectable for deterministic tests.
 */
export type TimeZoneAvailability = (identifier: string) => boolean;

/**
 * Formats an instant with the browser's locale and system time zone.
 *
 * @param instant - Valid timestamp to format.
 * @param locales - Preferred locale tags in display order.
 *
 * @returns - Localized date and time in the system time zone.
 */
function systemFormat(instant: Date, locales: readonly string[]): string {
    const options = { dateStyle: 'medium', timeStyle: 'short' } as const;
    return locales.length === 0
        ? intlFormat(instant, options)
        : intlFormat(instant, options, { locale: [...locales] });
}

/**
 * Uses Intl.DateTimeFormat construction to confirm a named zone is supported at runtime.
 *
 * @param identifier - Structurally valid IANA time-zone identifier.
 *
 * @returns - Whether the current runtime can format in that zone.
 */
export function isTimeZoneAvailable(identifier: string): boolean {
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions();
        return true;
    } catch {
        return false;
    }
}

/**
 * Formats an instant through the system locale and time zone; it is the safe fallback for an
 * unavailable named zone or an invalid custom presentation.
 *
 * @param instant - Valid timestamp to format.
 * @param locales - Preferred locale tags in display order.
 *
 * @returns - Safely formatted date and time using system presentation.
 */
export function formatDefaultDate(instant: Date, locales: readonly string[]): string {
    return systemFormat(instant, locales);
}

/**
 * Applies validated display choices and reports an empty result with an error code when a custom
 * pattern fails or a requested named zone is unavailable.
 *
 * @param instant - Valid timestamp to format.
 * @param locales - Preferred locale tags in display order.
 * @param display - Validated format and time-zone choices.
 * @param available - Capability check for named time zones.
 * @param nowMilliseconds - Shared age snapshot for a complete processing batch.
 *
 * @returns - Formatted text and effective zone, or an explicit presentation error.
 *
 * @throws Any formatting error other than an unavailable named time zone.
 */
export function formatDateWithPresentation(
    instant: Date,
    locales: readonly string[],
    display: DisplaySettings = DEFAULT_DISPLAY_SETTINGS,
    available: TimeZoneAvailability = isTimeZoneAvailable,
    nowMilliseconds?: number,
): DatePresentationResult {
    const precision = precisionForAge(instant, display.precisionPolicy, nowMilliseconds);
    if (precision !== undefined) {
        if (display.formatMode === FORMAT_MODE.CUSTOM) {
            const pattern = projectPrecisionPattern(display.pattern, precision, locales);
            if (pattern !== null) {
                return formatDateWithPresentation(instant, locales, {
                    formatMode: FORMAT_MODE.CUSTOM, pattern, timeZone: display.timeZone,
                }, available);
            }
        }
        const zone = display.timeZone;
        const unavailable = zone.mode === TIME_ZONE_MODE.IANA && !available(zone.identifier);
        let timeZone: string | undefined;
        if (zone.mode === TIME_ZONE_MODE.UTC) {
            timeZone = 'UTC';
        } else if (zone.mode === TIME_ZONE_MODE.IANA && !unavailable) {
            timeZone = zone.identifier;
        }
        const options: Intl.DateTimeFormatOptions = precision === DATE_PRECISION.YEAR
            ? { year: 'numeric' }
            : {
                dateStyle: 'medium',
                ...(precision === DATE_PRECISION.DAY ? {} : {
                    timeStyle: precision === DATE_PRECISION.SECONDS ? 'medium' : 'short',
                }),
            };
        return {
            text: new Intl.DateTimeFormat(locales.length === 0 ? undefined : [...locales], {
                ...options, ...(timeZone === undefined ? {} : { timeZone }),
            }).format(instant),
            ...(unavailable ? { error: UNAVAILABLE_TIME_ZONE_ERROR } : {}),
        };
    }
    if (display.formatMode === FORMAT_MODE.SYSTEM) {
        const zone = display.timeZone;
        if (zone.mode === TIME_ZONE_MODE.SYSTEM) {
            return { text: systemFormat(instant, locales) };
        }
        if (zone.mode === TIME_ZONE_MODE.IANA && !available(zone.identifier)) {
            return { text: systemFormat(instant, locales), error: UNAVAILABLE_TIME_ZONE_ERROR };
        }
        try {
            const options = {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: zone.mode === TIME_ZONE_MODE.UTC ? 'UTC' : zone.identifier,
            } as const;
            return {
                text:
                    locales.length === 0
                        ? intlFormat(instant, options)
                        : intlFormat(instant, options, { locale: [...locales] }),
            };
        } catch (error) {
            if (zone.mode === TIME_ZONE_MODE.IANA && error instanceof RangeError) {
                return {
                    text: systemFormat(instant, locales),
                    error: UNAVAILABLE_TIME_ZONE_ERROR,
                };
            }
            throw error;
        }
    }
    const zone = display.timeZone;
    if (zone.mode === TIME_ZONE_MODE.IANA && !available(zone.identifier)) {
        try {
            return {
                text: format(instant, display.pattern, {
                    locale: resolveDateLocale(locales).locale,
                }),
                error: UNAVAILABLE_TIME_ZONE_ERROR,
            };
        } catch {
            return { text: '', error: INVALID_DATE_FORMAT_ERROR };
        }
    }
    try {
        const { locale } = resolveDateLocale(locales);
        const options = zone.mode === TIME_ZONE_MODE.SYSTEM
            ? { locale }
            : { locale, in: tz(zone.mode === TIME_ZONE_MODE.UTC ? 'UTC' : zone.identifier) };
        const text = format(instant, display.pattern, options);
        return text.trim().length > 0 ? { text } : { text: '', error: INVALID_DATE_FORMAT_ERROR };
    } catch {
        return { text: '', error: INVALID_DATE_FORMAT_ERROR };
    }
}
