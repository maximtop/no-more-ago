/**
 * @file Validates adapter candidates and resolves only explicitly trusted timestamp values.
 */

import { isValid, parseISO } from "date-fns";

import {
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    TIMESTAMP_PRESENTATION_KIND,
    type PageDatetimeTimestampCandidate,
    type TimestampValidationRule,
    type TimestampCandidate,
    type TimestampVisibilityPolicy,
    type TimestampPresentation,
} from "../adapters/types";
import { parseHtmlGlobalDatetime } from "./parse-html-global-datetime";

const ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const YEAR = "(?:\\d{4}|[+-]\\d{6})";
const DATE = `(?:${YEAR}-(?:\\d{2}-\\d{2}|\\d{3}|W\\d{2}-\\d)|${YEAR}(?:\\d{4}|\\d{3}|W\\d{3}))`;
const FRACTION = "(?:[.,]\\d+)";
const TIME = `(?:\\d{2}:\\d{2}(?:${FRACTION}|:\\d{2}(?:${FRACTION})?)?`
    + `|\\d{4}(?:${FRACTION}|\\d{2}(?:${FRACTION})?)?)`;
const COMPLETE_DATE_TIME = new RegExp(`^${DATE}[T ]${TIME}$`);
const UNIX_SECONDS_PATTERN = /^[1-9]\d{9}$/u;

/**
 * Resolves one exact ten-digit Unix-seconds value without guessing its unit.
 *
 * @param value - Raw adapter value.
 * @returns - Valid absolute instant, or null for an unsupported value.
 */
function resolveUnixSeconds(value: string): Date | null {
    if (!UNIX_SECONDS_PATTERN.test(value)) {
        return null;
    }
    const milliseconds = Number(value) * 1_000;
    if (!Number.isSafeInteger(milliseconds)) {
        return null;
    }
    const instant = new Date(milliseconds);
    return isValid(instant) ? instant : null;
}

/**
 * Validates that a presentation target belongs to its source document.
 *
 * @param source - Timestamp source selected by an adapter.
 * @param presentation - Presentation strategy selected by the same adapter.
 * @returns - Validated presentation, or null when its target is unsuitable.
 */
function resolvePresentation(
    source: Element,
    presentation: TimestampPresentation,
): TimestampPresentation | null {
    const kind: string = presentation.kind;
    if (kind === TIMESTAMP_PRESENTATION_KIND.ADJACENT_TIME) {
        return presentation;
    }
    if (
        kind !== TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT
        || !("target" in presentation)
    ) {
        return null;
    }
    const target = presentation.target;
    if (
        target.nodeType !== 3
        || target.ownerDocument !== source.ownerDocument
        || !source.contains(target)
    ) {
        return null;
    }
    const hasDelimiters = presentation.textPrefix !== undefined
        || presentation.textSuffix !== undefined;
    const textPrefix = presentation.textPrefix ?? "";
    const textSuffix = presentation.textSuffix ?? "";
    if (
        hasDelimiters
        && (
            target.data.length <= textPrefix.length + textSuffix.length
            || !target.data.startsWith(textPrefix)
            || !target.data.endsWith(textSuffix)
        )
    ) {
        return null;
    }
    return presentation;
}

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
 * Validated candidate and absolute instant accepted by the shared resolver.
 */
export interface ResolvedTimestamp {
    /**
     * DOM element whose timestamp is being transformed.
     */
    readonly source: Element;

    /**
     * Page datetime for adjacent output, or null for a derived in-place value.
     */
    readonly sourceDatetime: string | null;

    /**
     * Strictly validated absolute instant.
     */
    readonly instant: Date;

    /**
     * Validation rule that accepted the candidate.
     */
    readonly validationRule: TimestampValidationRule;

    /**
     * Visibility policy selected by the source rule.
     */
    readonly visibilityPolicy: TimestampVisibilityPolicy;

    /**
     * Validated presentation selected by the source rule.
     */
    readonly presentation: TimestampPresentation;
}

/**
 * Resolves one explicit-zone page datetime after common candidate validation.
 *
 * @param candidate - Narrowed page-datetime candidate.
 * @param rawDatetime - Candidate's raw page value.
 * @param presentation - Validated presentation descriptor.
 * @param visibilityPolicy - Validated visibility policy.
 * @returns - Resolved timestamp, or null for invalid page data.
 */
function resolveExplicitIsoCandidate(
    candidate: PageDatetimeTimestampCandidate,
    rawDatetime: string,
    presentation: TimestampPresentation,
    visibilityPolicy: TimestampVisibilityPolicy,
): ResolvedTimestamp | null {
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
    const instant = parseISO(rawDatetime);
    if (!isValid(instant)) {
        return null;
    }
    return {
        source: candidate.source,
        sourceDatetime: rawDatetime,
        instant,
        validationRule: candidate.validationRule,
        visibilityPolicy,
        presentation,
    };
}

/**
 * Resolves a trusted page datetime or derived Unix-millisecond candidate.
 *
 * @param candidate - Timestamp candidate extracted by a trusted adapter.
 * @param nowMilliseconds - Deterministic current Unix milliseconds.
 * @returns - Valid resolved instant and source metadata, or null when rejected.
 */
export function resolveTrustedTimestamp(
    candidate: TimestampCandidate,
    nowMilliseconds: number = Date.now(),
): ResolvedTimestamp | null {
    const presentation = resolvePresentation(candidate.source, candidate.presentation);
    if (!presentation) {
        return null;
    }
    const visibilityPolicy: unknown = candidate.visibilityPolicy;
    if (
        visibilityPolicy !== TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION
        && visibilityPolicy !== TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION
    ) {
        return null;
    }
    if (
        candidate.validationRule
        === TIMESTAMP_VALIDATION_RULE.DERIVED_UNIX_MILLISECONDS
    ) {
        if (presentation.kind !== TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT) {
            return null;
        }
        const epochMilliseconds = candidate.epochMilliseconds;
        if (
            !Number.isSafeInteger(epochMilliseconds)
            || epochMilliseconds <= 0
            || epochMilliseconds > nowMilliseconds
        ) {
            return null;
        }
        const instant = new Date(epochMilliseconds);
        return isValid(instant)
            ? {
                source: candidate.source,
                sourceDatetime: null,
                instant,
                validationRule: candidate.validationRule,
                visibilityPolicy,
                presentation,
            }
            : null;
    }
    const rawDatetime = candidate.rawDatetime;
    const validationRule: unknown = candidate.validationRule;
    if (validationRule === TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS) {
        const instant = resolveUnixSeconds(rawDatetime);
        return instant
            ? {
                source: candidate.source,
                sourceDatetime: rawDatetime,
                instant,
                validationRule,
                visibilityPolicy,
                presentation,
            }
            : null;
    }
    if (validationRule === TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL) {
        const instant = parseHtmlGlobalDatetime(rawDatetime);
        return instant
            ? {
                source: candidate.source,
                sourceDatetime: rawDatetime,
                instant,
                validationRule,
                visibilityPolicy,
                presentation,
            }
            : null;
    }
    if (validationRule !== TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE) {
        return null;
    }

    return resolveExplicitIsoCandidate(
        candidate,
        rawDatetime,
        presentation,
        visibilityPolicy,
    );
}
