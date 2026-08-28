/**
 * @file Strict parser for HTML global date-and-time values.
 */

import { isValid, parseISO } from "date-fns";

/**
 * Strict syntax for an HTML global date-and-time with an explicit offset.
 */
const HTML_GLOBAL_DATE_TIME = new RegExp(
    "^(\\d{4,})-(\\d{2})-(\\d{2})(?:T| )"
    + "(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3}))?)?"
    + "(Z|[+-]\\d{2}:?\\d{2})$",
);

/**
 * Numeric components extracted from a valid HTML global date-and-time value.
 */
interface HtmlGlobalDateTimeParts {
    /**
     * Positive Gregorian calendar year.
     */
    readonly year: number;

    /**
     * Calendar month number.
     */
    readonly month: number;

    /**
     * Calendar day number.
     */
    readonly day: number;

    /**
     * Hour in the local date-time.
     */
    readonly hour: number;

    /**
     * Minute in the local date-time.
     */
    readonly minute: number;

    /**
     * Second in the local date-time.
     */
    readonly second: number;

    /**
     * Explicit UTC offset.
     */
    readonly zone: string;
}

/**
 * Detects ASCII and C1 controls that are not allowed in datetime values.
 *
 * @param value - Candidate datetime value.
 * @returns - Whether the value contains a control character.
 */
function hasControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159)) {
            return true;
        }
    }
    return false;
}

/**
 * Returns the number of days in a Gregorian calendar month.
 *
 * @param year - Positive Gregorian year.
 * @param month - Calendar month number.
 * @returns - Number of days in the month.
 */
function daysInMonth(year: number, month: number): number {
    if (month === 2) {
        const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return leapYear ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Parses numeric components from a syntactically valid HTML global value.
 *
 * @param match - Match result from the HTML global datetime grammar.
 * @returns - Parsed components, or null when a component is outside its allowed range.
 */
function parseParts(match: RegExpMatchArray): HtmlGlobalDateTimeParts | null {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    const zone = match[8];
    if (
        !Number.isSafeInteger(year) ||
        year === 0 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > daysInMonth(year, month) ||
        hour > 23 ||
        minute > 59 ||
        second > 59 ||
        zone === undefined
    ) {
        return null;
    }
    if (zone !== "Z") {
        const digits = zone.slice(1).replace(":", "");
        const offsetHours = Number(digits.slice(0, 2));
        const offsetMinutes = Number(digits.slice(2));
        if (
            offsetHours > 23 ||
            offsetMinutes > 59 ||
            (zone.startsWith("-") && offsetHours === 0 && offsetMinutes === 0)
        ) {
            return null;
        }
    }
    return { year, month, day, hour, minute, second, zone };
}

/**
 * Parses an HTML global date-and-time into an absolute instant.
 *
 * @param value - Candidate datetime attribute value.
 * @returns - Parsed instant, or null when the value is incomplete, ambiguous, or invalid.
 */
export function parseHtmlGlobalDatetime(value: string): Date | null {
    if (value.length === 0 || value.trim() !== value || hasControlCharacter(value)) {
        return null;
    }
    const match = value.match(HTML_GLOBAL_DATE_TIME);
    if (!match) {
        return null;
    }
    const parts = parseParts(match);
    if (!parts) {
        return null;
    }
    try {
        const yearText = match[1];
        if (yearText === undefined) {
            return null;
        }
        const parserValue = yearText.length === 4
            ? value
            : `+${yearText.padStart(6, "0")}${value.slice(yearText.length)}`;
        const instant = parseISO(parserValue);
        return isValid(instant) ? instant : null;
    } catch {
        return null;
    }
}
