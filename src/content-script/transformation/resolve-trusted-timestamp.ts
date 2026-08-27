/**
 * @file Validates adapter candidates and resolves only explicitly trusted timestamp values.
 */

import { isValid, parseISO } from "date-fns";

import { EXPLICIT_ZONED_DATETIME_RULE, type TimestampCandidate } from "../adapters/types";

const ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const YEAR = "(?:\\d{4}|[+-]\\d{6})";
const DATE = `(?:${YEAR}-(?:\\d{2}-\\d{2}|\\d{3}|W\\d{2}-\\d)|${YEAR}(?:\\d{4}|\\d{3}|W\\d{3}))`;
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
 * Detects ASCII and C1 controls that must never appear in an adapter datetime attribute.
 *
 * @param value - Candidate datetime attribute value.
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
 * Adapter candidate after its explicit-zone datetime has been validated and parsed into an instant.
 */
export interface ResolvedTimestamp {
    /**
     * DOM element whose timestamp is being transformed.
     */
    readonly source: Element;

    /**
     * Original explicit-zone datetime retained for rendering and restoration markers.
     */
    readonly sourceDatetime: string;

    /**
     * Parsed absolute instant produced only after strict timestamp validation.
     */
    readonly instant: Date;
}

/**
 * Accepts only adapter candidates carrying the explicit-zone rule and a complete valid ISO
 * datetime; returns null for malformed, ambiguous, or unsupported page data.
 *
 * @param candidate - Timestamp candidate extracted by a trusted adapter.
 * @returns - Valid resolved instant and source metadata, or null when rejected.
 */
export function resolveTrustedTimestamp(candidate: TimestampCandidate): ResolvedTimestamp | null {
    const timestampRule: unknown = candidate.timestampRule;
    if (timestampRule !== EXPLICIT_ZONED_DATETIME_RULE) {
        return null;
    }
    const rawDatetime = candidate.rawDatetime;
    if (
        rawDatetime.length === 0 ||
        rawDatetime !== rawDatetime.trim() ||
        hasControlCharacter(rawDatetime)
    ) {
        return null;
    }
    const zoneMatch = rawDatetime.match(ZONE);
    if (!zoneMatch) {
        return null;
    }
    const zone = zoneMatch[0];
    if (!hasKnownNumericZone(zone)) {
        return null;
    }
    const dateTime = rawDatetime.slice(0, -zone.length);
    if (!COMPLETE_DATE_TIME.test(dateTime)) {
        return null;
    }
    const separatorIndex = Math.max(dateTime.indexOf("T"), dateTime.indexOf(" "));
    const time = dateTime.slice(separatorIndex + 1);
    if (/[Z+-]/.test(time)) {
        return null;
    }
    const instant = parseISO(candidate.rawDatetime);
    if (!isValid(instant)) {
        return null;
    }
    return {
        source: candidate.source,
        sourceDatetime: candidate.rawDatetime,
        instant,
    };
}
