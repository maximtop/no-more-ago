/**
 * @file GitHub adapter that discovers and extracts trusted timestamp candidates.
 */

import {
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    ADJACENT_TIME_PRESENTATION,
    type TimestampSourceRule,
    type TimestampSourceKind,
} from "./types";
import { GITHUB_ADAPTER_ID, matchesGitHubUrl } from "../../shared/adapters/github-contract";
import { discoverElements } from "./discover-elements";
import {
    RELATIVE_PRESENTATION_PROFILE,
    isRelativeTimestampPresentation,
} from "./relative-presentation";

const GITHUB_TIMESTAMP_SELECTOR = "relative-time, time-ago, time-until" as const;

const APPROVED_KINDS = new Set<TimestampSourceKind>([
    TIMESTAMP_SOURCE_KIND.RELATIVE_TIME,
    TIMESTAMP_SOURCE_KIND.TIME_AGO,
    TIMESTAMP_SOURCE_KIND.TIME_UNTIL,
]);

/**
 * Checks whether an element has one of GitHub's approved timestamp source shapes.
 *
 * @param element - Candidate GitHub timestamp element.
 * @returns - Whether the element can be extracted by this adapter.
 */
function isGitHubTimestampElement(element: Element): boolean {
    return APPROVED_KINDS.has(element.localName as TimestampSourceKind);
}

/**
 * GitHub-specific adapter that accepts only explicit-zone datetime attributes on supported time
 * widgets.
 */
export const githubAdapter = {
    id: GITHUB_ADAPTER_ID,
    mutationAttributes: [
        TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME,
        TIMESTAMP_SOURCE_ATTRIBUTE.FORMAT,
    ],
    observesCharacterData: true,
    matches: matchesGitHubUrl,
    matchesElement: isGitHubTimestampElement,
    discover: (root) => discoverElements(
        root,
        GITHUB_TIMESTAMP_SELECTOR,
        isGitHubTimestampElement,
    ),
    isRelativePresentation: (candidate, context) =>
        isRelativeTimestampPresentation(candidate, context, [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
            RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
        ]),
    extract: (element) => {
        const sourceKind = element.localName as TimestampSourceKind;
        if (!APPROVED_KINDS.has(sourceKind)) {
            return null;
        }
        const format = element.getAttribute("format")?.trim().toLowerCase();
        if (format === "datetime") {
            return null;
        }
        const rawDatetime = element.getAttribute("datetime");
        if (!rawDatetime || rawDatetime.trim() === "") {
            return null;
        }
        return rawDatetime
            ? {
                ruleId: GITHUB_ADAPTER_ID,
                source: element,
                sourceKind,
                rawDatetime,
                presentation: ADJACENT_TIME_PRESENTATION,
                validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
            }
            : null;
    },
} satisfies TimestampSourceRule;
