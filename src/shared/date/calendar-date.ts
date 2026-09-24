/**
 * @file Strict Gregorian calendar-date value and parser.
 */

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Validated date without an instant or time-zone interpretation.
 */
export interface CalendarDate {
    /**
     * Canonical machine-readable date.
     */
    readonly isoDate: string;

    /**
     * Four-digit Gregorian year greater than zero.
     */
    readonly year: number;

    /**
     * One-based Gregorian month.
     */
    readonly month: number;

    /**
     * One-based day valid for the selected month.
     */
    readonly day: number;
}

/**
 * Checks one Gregorian year for leap-day eligibility.
 *
 * @param year - Validated Gregorian year.
 *
 * @returns - Whether February contains 29 days in the year.
 */
function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Parses one exact machine-readable Gregorian calendar date.
 *
 * @param value - Untrusted date-only value.
 *
 * @returns - Validated immutable calendar date, or null when rejected.
 */
export function parseCalendarDate(value: string): CalendarDate | null {
    const match = value.match(CALENDAR_DATE_PATTERN);
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const ordinaryMaximum = MONTH_LENGTHS[month - 1];
    if (year === 0 || ordinaryMaximum === undefined) {
        return null;
    }
    const maximum = month === 2 && isLeapYear(year) ? 29 : ordinaryMaximum;
    if (day < 1 || day > maximum) {
        return null;
    }
    return Object.freeze({
        isoDate: value, year, month, day,
    });
}
