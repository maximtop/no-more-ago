/**
 * @file Verifies locale-aware presentation of semantic calendar dates.
 */

import { describe, expect, it } from 'vitest';

import { parseCalendarDate } from '../../../../src/shared/date/calendar-date';
import { formatCalendarDate } from
    '../../../../src/shared/date/format-calendar-date';

import type {
    DisplaySettings,
    TimeZoneSelection,
} from '../../../../src/shared/settings/snapshot';

/**
 * Requires one valid semantic calendar date for formatter assertions.
 *
 * @returns - Validated leap-day calendar date.
 */
function calendarValue() {
    const value = parseCalendarDate('2024-02-29');
    if (!value) {
        throw new Error('Expected valid calendar date');
    }
    return value;
}

/**
 * Computes the public localized medium date-only fallback.
 *
 * @param locales - Preferred locale tags.
 *
 * @returns - Localized leap-day fallback text.
 */
function systemDateOnly(locales: readonly string[]): string {
    return new Intl.DateTimeFormat([...locales], {
        dateStyle: 'medium',
        timeZone: 'UTC',
    }).format(new Date('2024-02-29T12:00:00.000Z'));
}

const TIME_ZONES: readonly TimeZoneSelection[] = [
    { mode: 'system' },
    { mode: 'utc' },
    { mode: 'iana', identifier: 'Pacific/Honolulu' },
    { mode: 'iana', identifier: 'Pacific/Kiritimati' },
];

describe('formatCalendarDate', () => {
    it.each([['en-GB'], ['en-US'], ['de-DE']])(
        'uses locale date-only presentation for %s',
        (locale) => {
            const value = parseCalendarDate('2024-02-29');
            if (!value) {
                throw new Error('Expected valid calendar date');
            }
            const anchor = new Date('2024-02-29T12:00:00.000Z');
            const expected = new Intl.DateTimeFormat([locale], {
                dateStyle: 'medium',
                timeZone: 'UTC',
            }).format(anchor);

            expect(formatCalendarDate(value, [locale])).toBe(expected);
        },
    );

    it('uses the runtime locale when no preferred locale is supplied', () => {
        const value = parseCalendarDate('2026-08-29');
        if (!value) {
            throw new Error('Expected valid calendar date');
        }
        const expected = new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeZone: 'UTC',
        }).format(new Date('2026-08-29T12:00:00.000Z'));

        expect(formatCalendarDate(value, [])).toBe(expected);
    });

    it.each([
        ['yyyy-MM-dd HH:mm XXX', '2024-02-29'],
        ['HH:mm, d MMM yyyy', '29 Feb 2024'],
        ["EEEE, d MMMM yyyy 'at' HH:mm", 'Thursday, 29 February 2024'],
        ['do MMMM yyyy, h:mm a', '29th February 2024'],
        ['Pp', '29/02/2024'],
        ['yyyy HH:mm MM', '2024 02'],
        ["d ''MMM'' yyyy HH:mm", "29 'Feb' 2024"],
        ["d 'of' MMMM yyyy 'at' HH:mm", '29 of February 2024'],
        ["'Published' d MMM yyyy", 'Published 29 Feb 2024'],
    ])('projects custom pattern %s to calendar-only text', (pattern, expected) => {
        const display: DisplaySettings = {
            formatMode: 'custom',
            pattern,
            timeZone: { mode: 'iana', identifier: 'Pacific/Kiritimati' },
        };

        expect(formatCalendarDate(calendarValue(), ['en-GB'], display)).toBe(expected);
    });

    it.each(['HH:mm XXX', 'pp'])(
        'falls back to the localized date for time-only pattern %s',
        (pattern) => {
            expect(formatCalendarDate(calendarValue(), ['en-GB'], {
                formatMode: 'custom',
                pattern,
                timeZone: { mode: 'iana', identifier: 'Pacific/Honolulu' },
            })).toBe(systemDateOnly(['en-GB']));
        },
    );

    it.each(TIME_ZONES)('keeps custom calendar output invariant under $mode', (timeZone) => {
        expect(formatCalendarDate(calendarValue(), ['en-GB'], {
            formatMode: 'custom',
            pattern: 'yyyy-MM-dd HH:mm XXX',
            timeZone,
        })).toBe('2024-02-29');
    });
});
