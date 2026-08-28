/**
 * @file Canonical GitHub adapter identity and URL matching contract.
 */

/**
 * Stable adapter identifier shared by discovery and runtime activation.
 */
export const GITHUB_ADAPTER_ID = "github" as const;

/**
 * Canonical hostname handled by the GitHub adapter.
 */
export const GITHUB_HOSTNAME = "github.com" as const;

/**
 * Browser match patterns used for persistent GitHub content-script registration.
 */
export const GITHUB_MATCH_PATTERNS = [
    `http://${GITHUB_HOSTNAME}/*`,
    `https://${GITHUB_HOSTNAME}/*`,
] as const;

/**
 * Stable browser registration identifier for the GitHub content script.
 */
export const GITHUB_REGISTRATION_ID = "no-more-ago-github" as const;

/**
 * Checks whether a URL belongs to the supported HTTP(S) GitHub origin.
 *
 * @param url - URL considered for adapter selection or activation.
 * @returns - Whether the URL belongs to the canonical GitHub hostname.
 */
export function matchesGitHubUrl(url: URL): boolean {
    return (
        (url.protocol === "http:" || url.protocol === "https:")
        && url.hostname === GITHUB_HOSTNAME
    );
}
