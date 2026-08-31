/**
 * @file Validates adapter candidates and resolves only explicitly trusted timestamp values.
 */

import { isValid } from "date-fns";

import {
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    TIMESTAMP_PRESENTATION_KIND,
    type TimestampValidationRule,
    type TimestampCandidate,
    type TimestampVisibilityPolicy,
    type TimestampPresentation,
} from "../adapters/types";
import { parseHtmlGlobalDatetime } from "./parse-html-global-datetime";
import { parseExplicitZoneDatetime } from "../../shared/date/parse-explicit-zone-datetime";

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
    return target.nodeType === 3
        && target.ownerDocument === source.ownerDocument
        && source.contains(target)
        ? presentation
        : null;
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

    /**
     * Validation rule accepted before the timestamp was parsed.
     */
    readonly validationRule: TimestampValidationRule;

    /**
     * Visibility policy selected by the source rule.
     */
    readonly visibilityPolicy: TimestampVisibilityPolicy;

    /**
     * Presentation strategy selected by the source rule.
     */
    readonly presentation: TimestampPresentation;
}

/**
 * Accepts only adapter candidates carrying the explicit-zone rule and a complete valid ISO
 * datetime; returns null for malformed, ambiguous, or unsupported page data.
 *
 * @param candidate - Timestamp candidate extracted by a trusted adapter.
 * @returns - Valid resolved instant and source metadata, or null when rejected.
 */
export function resolveTrustedTimestamp(
    candidate: TimestampCandidate,
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
    const validationRule: unknown = candidate.validationRule;
    const rawDatetime = candidate.rawDatetime;
    let instant: Date | null;
    if (validationRule === TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS) {
        instant = resolveUnixSeconds(rawDatetime);
    } else if (validationRule === TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL) {
        instant = parseHtmlGlobalDatetime(rawDatetime);
    } else if (validationRule === TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE) {
        instant = parseExplicitZoneDatetime(rawDatetime);
    } else {
        return null;
    }
    if (!instant) {
        return null;
    }
    return {
        source: candidate.source,
        sourceDatetime: rawDatetime,
        instant,
        validationRule,
        visibilityPolicy,
        presentation,
    };
}
