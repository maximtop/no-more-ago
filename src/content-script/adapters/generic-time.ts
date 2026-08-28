/**
 * @file Generic source rule for standard light-DOM time elements.
 */

import { isHttpUrl } from "../../shared/url/http";
import {
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    type TimestampSourceRule,
} from "./types";
import { OWNED_OUTPUT_ATTRIBUTE } from "../ownership-markers";

/**
 * Stable identifier for the generic standard-time source rule.
 */
export const GENERIC_TIME_RULE_ID = "generic-time" as const;

/**
 * Finds ordinary light-DOM time elements in a bounded root.
 *
 * @param root - Element or parent node to inspect.
 * @returns - Standard time elements without extension output markers.
 */
function discoverStandardTimes(root: ParentNode): readonly Element[] {
    const candidates: Element[] = [];
    if (root instanceof Element && root.localName === TIMESTAMP_SOURCE_KIND.STANDARD_TIME) {
        if (!root.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)) {
            candidates.push(root);
        }
    }
    for (const element of root.querySelectorAll("time")) {
        if (!element.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)) {
            candidates.push(element);
        }
    }
    return candidates;
}

/**
 * Extracts a generic candidate from exactly one non-empty datetime attribute.
 *
 * @param element - Element discovered by this source rule.
 * @returns - Trusted generic candidate, or null when the element is unsuitable.
 */
function extractStandardTime(
    element: Element,
): ReturnType<TimestampSourceRule["extract"]> {
    if (element.localName !== TIMESTAMP_SOURCE_KIND.STANDARD_TIME) {
        return null;
    }
    const rawDatetime = element.getAttribute("datetime");
    if (!rawDatetime || rawDatetime.trim() === "") {
        return null;
    }
    return {
        ruleId: GENERIC_TIME_RULE_ID,
        source: element,
        sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
        rawDatetime,
        validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
    };
}

/**
 * Generic rule for standard time elements on every HTTP(S) document.
 */
export const genericTimeRule: TimestampSourceRule = {
    id: GENERIC_TIME_RULE_ID,
    matches: isHttpUrl,
    discover: discoverStandardTimes,
    extract: extractStandardTime,
};
