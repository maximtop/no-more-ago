/**
 * @file Validates adapter candidates and resolves only explicitly trusted timestamp values.
 */

import { isValid } from "date-fns";

import { parseCalendarDate, type CalendarDate } from "../../shared/date/calendar-date";
import { parseExplicitZoneDatetime } from "../../shared/date/parse-explicit-zone-datetime";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type ValidatedStringTimestampCandidate,
    type TimestampCandidate,
    type TimestampPresentation,
    type TimestampVisibilityPolicy,
} from "../adapters/types";
import { parseHtmlGlobalDatetime } from "./parse-html-global-datetime";

const UNIX_SECONDS_PATTERN = /^[1-9]\d{9}$/u;

/**
 * Semantic kinds produced by trusted timestamp resolution.
 */
export const RESOLVED_TIMESTAMP_KIND = {
    INSTANT: "instant",
    CALENDAR_DATE: "calendar-date",
} as const;

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
        target.nodeType !== Node.TEXT_NODE
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
 * Source metadata shared by every resolved semantic timestamp value.
 */
interface ResolvedTimestampBase {
    /**
     * DOM element whose timestamp is being transformed.
     */
    readonly source: Element;

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
 * Resolved page-authored value with its exact original serialization.
 */
interface ResolvedPageTimestampBase extends ResolvedTimestampBase {
    /**
     * Exact validated page date or date-time.
     */
    readonly sourceDatetime: string;

    /**
     * Page-value validation rule that accepted the candidate.
     */
    readonly validationRule: ValidatedStringTimestampCandidate["validationRule"];
}

/**
 * Resolved page-authored absolute instant.
 */
interface ResolvedPageInstantTimestamp extends ResolvedPageTimestampBase {
    /**
     * Semantic kind identifying an absolute instant.
     */
    readonly kind: typeof RESOLVED_TIMESTAMP_KIND.INSTANT;

    /**
     * Strictly validated absolute instant.
     */
    readonly instant: Date;
}

/**
 * Resolved page-authored calendar date.
 */
interface ResolvedCalendarDateTimestamp extends ResolvedPageTimestampBase {
    /**
     * Semantic kind identifying a calendar date.
     */
    readonly kind: typeof RESOLVED_TIMESTAMP_KIND.CALENDAR_DATE;

    /**
     * Validated date without an instant or time-zone interpretation.
     */
    readonly calendarDate: CalendarDate;

    /**
     * Rule that explicitly permits calendar-date semantics.
     */
    readonly validationRule:
        | typeof TIMESTAMP_VALIDATION_RULE.CALENDAR_DATE
        | typeof TIMESTAMP_VALIDATION_RULE.CALENDAR_OR_EXPLICIT_ISO_ZONE;
}

/**
 * Resolved derived instant constrained to an existing in-place text target.
 */
interface ResolvedDerivedTimestamp extends ResolvedTimestampBase {
    /**
     * Semantic kind identifying an absolute instant.
     */
    readonly kind: typeof RESOLVED_TIMESTAMP_KIND.INSTANT;

    /**
     * Derived instants do not fabricate a page datetime value.
     */
    readonly sourceDatetime: null;

    /**
     * Strictly validated absolute instant.
     */
    readonly instant: Date;

    /**
     * Derived-instant validation rule that accepted the candidate.
     */
    readonly validationRule:
        typeof TIMESTAMP_VALIDATION_RULE.DERIVED_UNIX_MILLISECONDS;

    /**
     * Derived instants can only update an existing page-owned text target.
     */
    readonly presentation: Extract<
        TimestampPresentation,
        {
            /**
             * In-place presentation discriminant required for derived values.
             */
            readonly kind: typeof TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT;
        }
    >;
}

/**
 * Trusted candidate preserving instant, calendar-date, and source provenance semantics.
 */
export type ResolvedTimestamp =
    | ResolvedPageInstantTimestamp
    | ResolvedCalendarDateTimestamp
    | ResolvedDerivedTimestamp;

/**
 * Accepts only candidates carrying a recognized rule and a valid semantic value.
 *
 * @param candidate - Timestamp candidate extracted by a trusted adapter.
 * @param nowMilliseconds - Deterministic current Unix milliseconds.
 * @returns - Valid resolved semantic timestamp and source metadata, or null when rejected.
 */
export function resolveTrustedTimestamp(
    candidate: TimestampCandidate,
    nowMilliseconds: number,
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
                kind: RESOLVED_TIMESTAMP_KIND.INSTANT,
                source: candidate.source,
                sourceDatetime: null,
                instant,
                validationRule: candidate.validationRule,
                visibilityPolicy,
                presentation,
            }
            : null;
    }

    const validationRule: unknown = candidate.validationRule;
    const rawDatetime = candidate.rawDatetime;
    if (
        validationRule === TIMESTAMP_VALIDATION_RULE.CALENDAR_DATE
        || validationRule
            === TIMESTAMP_VALIDATION_RULE.CALENDAR_OR_EXPLICIT_ISO_ZONE
    ) {
        const calendarDate = parseCalendarDate(rawDatetime);
        if (calendarDate) {
            return {
                kind: RESOLVED_TIMESTAMP_KIND.CALENDAR_DATE,
                source: candidate.source,
                sourceDatetime: rawDatetime,
                calendarDate,
                validationRule,
                visibilityPolicy,
                presentation,
            };
        }
        if (validationRule === TIMESTAMP_VALIDATION_RULE.CALENDAR_DATE) {
            return null;
        }
    }

    let instant: Date | null;
    if (validationRule === TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS) {
        instant = resolveUnixSeconds(rawDatetime);
    } else if (validationRule === TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL) {
        instant = parseHtmlGlobalDatetime(rawDatetime);
    } else if (
        validationRule === TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE
        || validationRule === TIMESTAMP_VALIDATION_RULE.CALENDAR_OR_EXPLICIT_ISO_ZONE
    ) {
        instant = parseExplicitZoneDatetime(rawDatetime);
    } else {
        return null;
    }
    if (!instant) {
        return null;
    }
    return {
        kind: RESOLVED_TIMESTAMP_KIND.INSTANT,
        source: candidate.source,
        sourceDatetime: rawDatetime,
        instant,
        validationRule,
        visibilityPolicy,
        presentation,
    };
}
