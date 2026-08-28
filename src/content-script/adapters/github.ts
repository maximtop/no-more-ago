/**
 * @file GitHub adapter that discovers and extracts trusted timestamp candidates.
 */

import {
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    type TimestampSourceRule,
    type TimestampSourceKind,
} from "./types";
import { GITHUB_ADAPTER_ID, matchesGitHubUrl } from "../../shared/adapters/github-contract";

const APPROVED_KINDS = new Set<TimestampSourceKind>([
    TIMESTAMP_SOURCE_KIND.RELATIVE_TIME,
    TIMESTAMP_SOURCE_KIND.TIME_AGO,
    TIMESTAMP_SOURCE_KIND.TIME_UNTIL,
]);

/**
 * GitHub-specific adapter that accepts only explicit-zone datetime attributes on supported time
 * widgets.
 */
export const githubAdapter: TimestampSourceRule = {
    id: GITHUB_ADAPTER_ID,
    matches: matchesGitHubUrl,
    discover: (root) => {
        const candidates: Element[] = [];
        if (root instanceof Element && APPROVED_KINDS.has(root.localName as TimestampSourceKind)) {
            candidates.push(root);
        }
        candidates.push(...root.querySelectorAll("relative-time, time-ago, time-until"));
        return candidates;
    },
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
                validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
            }
            : null;
    },
};
