/**
 * @file GitHub adapter that discovers and extracts trusted timestamp candidates.
 */

import { EXPLICIT_ZONED_DATETIME_RULE, type SiteAdapter, type TimestampSourceKind } from "./types";
import { GITHUB_ADAPTER_ID, matchesGitHubUrl } from "./github-contract";

const APPROVED_KINDS = new Set<TimestampSourceKind>(["relative-time", "time-ago", "time-until"]);

/**
 * GitHub-specific adapter that accepts only explicit-zone datetime attributes on supported time
 * widgets.
 */
export const githubAdapter: SiteAdapter = {
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
                adapterId: GITHUB_ADAPTER_ID,
                source: element,
                sourceKind,
                rawDatetime,
                timestampRule: EXPLICIT_ZONED_DATETIME_RULE,
            }
            : null;
    },
};
