/**
 * @file Parses complete ISO date-times that carry an explicit UTC offset.
 */

import { isValid, parseISO } from "date-fns";

const ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const YEAR = "(?:\\d{4}|[+-]\\d{6})";
const DATE = `(?:${YEAR}-(?:\\d{2}-\\d{2}|\\d{3}|W\\d{2}-\\d)|${YEAR}`
    + "(?:\\d{4}|\\d{3}|W\\d{3}))";
const FRACTION = "(?:[.,]\\d+)";
const TIME = `(?:\\d{2}:\\d{2}(?:${FRACTION}|:\\d{2}(?:${FRACTION})?)?`
    + `|\\d{4}(?:${FRACTION}|\\d{2}(?:${FRACTION})?)?)`;
const COMPLETE_DATE_TIME = new RegExp(`^${DATE}[T ]${TIME}$`);

/**
 * Rejects invalid or ambiguous numeric UTC offsets before ISO parsing.
 *
 * @param zone - Numeric UTC offset suffix from an ISO datetime.
 * @returns - Whether the offset uses a valid hour and minute range.
 */
function hasKnownNumericZone(zone: string): boolean {
    if (zone === "Z") {
        return true;
    }
    const sign = zone[0];
    const digits = zone.slice(1).replace(":", "");
    const hours = Number(digits.slice(0, 2));
    const minutes = digits.length === 4 ? Number(digits.slice(2)) : 0;
    if (hours > 23 || minutes > 59) {
        return false;
    }
    return !(sign === "-" && hours === 0 && minutes === 0);
}

/**
 * Detects ASCII and C1 controls forbidden in an external datetime value.
 *
 * @param value - Candidate datetime value.
 * @returns - Whether the value contains an ASCII or C1 control character.
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
 * Parses only a complete ISO datetime carrying an explicit, valid UTC offset.
 *
 * @param value - Untrusted datetime value from a trusted source boundary.
 * @returns - Parsed absolute instant, or null for malformed or ambiguous input.
 */
export function parseExplicitZoneDatetime(value: string): Date | null {
    if (value.length === 0 || value !== value.trim() || hasControlCharacter(value)) {
        return null;
    }
    const zoneMatch = value.match(ZONE);
    if (!zoneMatch) {
        return null;
    }
    const zone = zoneMatch[0];
    if (!hasKnownNumericZone(zone)) {
        return null;
    }
    const dateTime = value.slice(0, -zone.length);
    if (!COMPLETE_DATE_TIME.test(dateTime)) {
        return null;
    }
    const separatorIndex = Math.max(dateTime.indexOf("T"), dateTime.indexOf(" "));
    const time = dateTime.slice(separatorIndex + 1);
    if (/[Z+-]/.test(time)) {
        return null;
    }
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
}
