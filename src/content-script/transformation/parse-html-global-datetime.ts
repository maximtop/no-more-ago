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
 * Rejects HTML-specific ranges that date-fns intentionally normalizes.
 *
 * @param match - Match result from the HTML global datetime grammar.
 * @returns - Whether the year, hour, and offset obey the HTML grammar.
 */
function hasValidHtmlRanges(match: RegExpMatchArray): boolean {
    const year = Number(match[1]);
    const hour = Number(match[4]);
    const zone = match[8];
    if (!Number.isSafeInteger(year) || year === 0 || hour > 23 || zone === undefined) {
        return false;
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
            return false;
        }
    }
    return true;
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
    if (!hasValidHtmlRanges(match)) {
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
