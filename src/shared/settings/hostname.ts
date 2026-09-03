/**
 * @file Canonical hostname validation and user-input normalization.
 */

// Anything that can only appear in a URL, not in a bare hostname. Input
// containing one of these is returned unchanged so canonical validation
// rejects it instead of silently discarding the extra part.
const NON_HOSTNAME_INPUT = /[\s/\\:?#@]/u;

/**
 * A site key is the canonical URL.hostname, never a URL or URL.host.
 *
 * @param hostname - Candidate hostname to use as a site key.
 * @returns - Whether the string is an exact canonical hostname.
 */
export function isCanonicalHostname(hostname: string): boolean {
    if (hostname.length === 0 || hostname.trim() !== hostname) {
        return false;
    }
    if (hostname.endsWith("..") || hostname.includes("*")) {
        return false;
    }
    try {
        const parsed = new URL(`https://${hostname}`);
        return (
            parsed.protocol === "https:" &&
            parsed.hostname === hostname &&
            parsed.username === "" &&
            parsed.password === "" &&
            parsed.port === "" &&
            parsed.pathname === "/" &&
            parsed.search === "" &&
            parsed.hash === ""
        );
    } catch {
        return false;
    }
}

/**
 * Normalizes hostname text a user typed before canonical validation runs.
 *
 * @param value - Hostname text supplied by the user.
 * @returns - Lowercased hostname in its canonical URL.hostname form when the
 * input is hostname-shaped, or the trimmed input when it is not.
 */
export function normalizeHostnameInput(value: string): string {
    const trimmed = value.trim().toLowerCase();
    const withoutRootDot = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
    if (withoutRootDot.length === 0 || NON_HOSTNAME_INPUT.test(withoutRootDot)) {
        return withoutRootDot;
    }
    try {
        return new URL(`https://${withoutRootDot}`).hostname;
    } catch {
        return withoutRootDot;
    }
}
