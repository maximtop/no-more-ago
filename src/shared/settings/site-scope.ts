/**
 * @file Site-scope policy values, activation decisions, and list transitions.
 */

import { isCanonicalHostname } from "./hostname";

/**
 * Named scope modes shared by settings, projections, and both UI surfaces.
 */
export const SITE_SCOPE_MODE = {
    ALL_EXCEPT_EXCLUDED: "all-except-excluded",
    SELECTED_ONLY: "selected-only",
} as const;

/**
 * Complete set of persisted scope modes.
 */
export const SITE_SCOPE_MODES = [
    SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
    SITE_SCOPE_MODE.SELECTED_ONLY,
] as const;

/**
 * Scope mode selecting which hostname list decides processing.
 */
export type SiteScopeMode = (typeof SITE_SCOPE_MODES)[number];

/**
 * Active scope mode together with both independently retained hostname lists.
 */
export interface SiteScopePolicy {
    /**
     * Scope mode selecting which list decides processing.
     */
    readonly mode: SiteScopeMode;

    /**
     * Hostnames skipped while the all-except-excluded mode is active.
     */
    readonly excludedSites: readonly string[];

    /**
     * Hostnames processed while the selected-only mode is active.
     */
    readonly allowedSites: readonly string[];
}

/**
 * Immutable default policy: every supported site runs and no list has entries.
 */
export const DEFAULT_SITE_SCOPE: SiteScopePolicy = Object.freeze({
    mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
    excludedSites: Object.freeze([]),
    allowedSites: Object.freeze([]),
});

/**
 * Recognizes a scope mode in free text such as a form control value.
 *
 * @param value - Candidate scope mode text.
 * @returns - The matching scope mode, or undefined when the text is not one.
 */
export function parseSiteScopeMode(value: string): SiteScopeMode | undefined {
    return SITE_SCOPE_MODES.find((mode) => mode === value);
}

/**
 * Applies the active mode's list to one hostname.
 *
 * @param scope - Persisted scope policy.
 * @param hostname - Canonical hostname whose processing state is requested.
 * @returns - Whether processing applies to the hostname under this policy.
 */
export function isSiteProcessingEnabled(scope: SiteScopePolicy, hostname: string): boolean {
    return scope.mode === SITE_SCOPE_MODE.SELECTED_ONLY
        ? scope.allowedSites.includes(hostname)
        : !scope.excludedSites.includes(hostname);
}

/**
 * Copies a hostname list, rejecting a non-canonical entry and dropping duplicates.
 *
 * @param values - Candidate hostname list.
 * @returns - Frozen deduplicated list, or null when an entry is not canonical.
 */
function copyHostnames(values: readonly string[]): readonly string[] | null {
    const unique: string[] = [];
    for (const value of values) {
        if (!isCanonicalHostname(value)) {
            return null;
        }
        if (!unique.includes(value)) {
            unique.push(value);
        }
    }
    return Object.freeze(unique);
}

/**
 * Validates a typed scope policy and returns an immutable copy.
 *
 * @param value - Typed scope policy.
 * @returns - Immutable validated policy, or null when an entry is invalid.
 */
export function parseSiteScopePolicy(value: SiteScopePolicy): SiteScopePolicy | null {
    if (!SITE_SCOPE_MODES.includes(value.mode)) {
        return null;
    }
    const excludedSites = copyHostnames(value.excludedSites);
    const allowedSites = copyHostnames(value.allowedSites);
    if (excludedSites === null || allowedSites === null) {
        return null;
    }
    return Object.freeze({ mode: value.mode, excludedSites, allowedSites });
}

/**
 * Adds one hostname without creating a duplicate entry.
 *
 * @param hosts - Current hostname list.
 * @param hostname - Canonical hostname to include.
 * @returns - List containing the hostname exactly once.
 */
function withHostname(hosts: readonly string[], hostname: string): readonly string[] {
    return hosts.includes(hostname) ? hosts : [...hosts, hostname];
}

/**
 * Removes one hostname while preserving the order of the remaining entries.
 *
 * @param hosts - Current hostname list.
 * @param hostname - Canonical hostname to remove.
 * @returns - List without the hostname.
 */
function withoutHostname(hosts: readonly string[], hostname: string): readonly string[] {
    return hosts.filter((value) => value !== hostname);
}

/**
 * Applies a per-hostname decision to the list the active mode owns, leaving the
 * other list untouched so a later mode change restores it unchanged.
 *
 * @param scope - Current scope policy.
 * @param hostname - Canonical hostname whose processing state changes.
 * @param enabled - Whether processing should apply to the hostname.
 * @returns - Immutable policy reflecting the requested decision.
 */
export function withSiteProcessing(
    scope: SiteScopePolicy,
    hostname: string,
    enabled: boolean,
): SiteScopePolicy {
    if (scope.mode === SITE_SCOPE_MODE.SELECTED_ONLY) {
        return Object.freeze({
            mode: scope.mode,
            excludedSites: scope.excludedSites,
            allowedSites: enabled
                ? withHostname(scope.allowedSites, hostname)
                : withoutHostname(scope.allowedSites, hostname),
        });
    }
    return Object.freeze({
        mode: scope.mode,
        excludedSites: enabled
            ? withoutHostname(scope.excludedSites, hostname)
            : withHostname(scope.excludedSites, hostname),
        allowedSites: scope.allowedSites,
    });
}
