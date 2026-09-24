/**
 * @file Canonical Facebook URL scope shared by registration and page adapters.
 */

import { isHttpUrl } from './http';

/**
 * Registrable Facebook document match patterns.
 */
export const FACEBOOK_MATCH_PATTERNS = [
    '*://facebook.com/*',
    '*://*.facebook.com/*',
] as const;

/**
 * Canonical Facebook registrable hostname.
 */
export const FACEBOOK_HOSTNAME = 'facebook.com' as const;

/**
 * Checks whether a hostname is Facebook or one of its subdomains.
 *
 * @param hostname - Canonical URL hostname to inspect.
 *
 * @returns - Whether the hostname is inside the Facebook domain.
 */
export function isFacebookHostname(hostname: string): boolean {
    return hostname === FACEBOOK_HOSTNAME || hostname.endsWith(`.${FACEBOOK_HOSTNAME}`);
}

/**
 * Checks whether a URL is an HTTP(S) Facebook document.
 *
 * @param url - URL considered for Facebook-specific processing.
 *
 * @returns - Whether the URL belongs to Facebook over HTTP(S).
 */
export function isFacebookUrl(url: URL): boolean {
    return isHttpUrl(url) && isFacebookHostname(url.hostname);
}
