/**
 * @file Maps Facebook Story payload timestamps to their obfuscated post timestamp links.
 */

import { isFacebookUrl } from "../../shared/url/facebook";
import { discoverElements } from "./discover-elements";
import { FACEBOOK_TRACKED_LINK_SELECTOR } from "../facebook/contracts";
import {
    getFacebookTimestampRecord,
    getFacebookTrackingToken,
} from "../facebook/timestamp-store";
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_MUTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampExtractionContext,
    type TimestampMutationKind,
    type TimestampMutationSourceResult,
    type TimestampSourceRule,
} from "./types";
import {
    RELATIVE_PRESENTATION_PROFILE,
    isRelativeTimestampPresentation,
} from "./relative-presentation";

/**
 * Stable identifier for the Facebook Story timestamp adapter.
 */
export const FACEBOOK_ADAPTER_ID = "facebook" as const;

const FACEBOOK_OBFUSCATION_MARK = "\u034f" as const;

/**
 * Recognizes Facebook's SVG-sprite presentation used by dynamically loaded post timestamps.
 *
 * @param element - Tracking link whose descendant presentation is inspected.
 * @returns - Whether the link has the narrow dynamic timestamp shape.
 */
function hasFacebookSvgTimestamp(element: Element): boolean {
    return element.textContent.trim() === ""
        && element.getAttribute("role") === "link"
        && element.getAttribute("tabindex") === "0"
        && element.getAttribute("target") === "_blank"
        && !element.hasAttribute("aria-label")
        && element.querySelector("span[aria-labelledby] svg use") !== null;
}

/**
 * Checks for Facebook's current post-timestamp link shape without decoding its label.
 *
 * Comment, actor, media, and accessibility links may carry the same tracking token.
 * The post timestamp is distinguished by Facebook's obfuscation mark and payload proof.
 *
 * @param element - Candidate page-owned source.
 * @returns - Whether the element can represent a Facebook Story timestamp.
 */
export function isFacebookTimestampElement(element: Element): boolean {
    return getFacebookTrackingToken(element) !== null
        && (
            element.textContent.includes(FACEBOOK_OBFUSCATION_MARK)
            || hasFacebookSvgTimestamp(element)
        )
        && getFacebookTimestampRecord(element) !== null;
}

/**
 * Maps descendant text changes back to the owning Facebook timestamp link.
 *
 * The link is returned even after the new text makes it ineligible so shared
 * reconciliation can restore any previously rendered adjacent output.
 *
 * @param element - Parent of the page-authored text node that changed.
 * @param attributeName - Changed attribute, unused for character data.
 * @param oldValue - Previous attribute value, unused for character data.
 * @param context - Current extraction context, unused for local ownership mapping.
 * @param mutationKind - Mutation kind supplied by shared reconciliation.
 * @returns - Explicit local source mapping for character-data mutations.
 */
function getMutationSources(
    element: Element,
    attributeName: string | undefined,
    oldValue: string | null,
    context: TimestampExtractionContext,
    mutationKind: TimestampMutationKind,
): TimestampMutationSourceResult {
    void attributeName;
    void oldValue;
    void context;
    if (mutationKind !== TIMESTAMP_MUTATION_KIND.CHARACTER_DATA) {
        return { handled: false, sources: [] };
    }
    const source = element.closest(FACEBOOK_TRACKED_LINK_SELECTOR);
    return { handled: true, sources: source ? [source] : [] };
}

/**
 * Facebook Story source rule backed by structured initial-page or GraphQL payloads.
 */
export const facebookAdapter: TimestampSourceRule = {
    id: FACEBOOK_ADAPTER_ID,
    mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.HREF],
    observesCharacterData: true,
    getMutationSources,
    matches: isFacebookUrl,
    matchesElement: isFacebookTimestampElement,
    discover: (root) => discoverElements(
        root,
        FACEBOOK_TRACKED_LINK_SELECTOR,
        isFacebookTimestampElement,
    ),
    isRelativePresentation: (candidate, context) =>
        isRelativeTimestampPresentation(candidate, context, [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
            RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
        ]),
    extract: (element) => {
        if (!isFacebookTimestampElement(element)) {
            return null;
        }
        const record = getFacebookTimestampRecord(element);
        if (!record) {
            return null;
        }
        return {
            ruleId: FACEBOOK_ADAPTER_ID,
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.FACEBOOK_STORY_TIMESTAMP,
            rawDatetime: record.rawDatetime,
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule: TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        };
    },
};
