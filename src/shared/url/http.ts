/**
 * @file Shared URL and match-pattern contracts for HTTP(S) documents.
 */

/**
 * URL schemes supported by document processing.
 */
export const HTTP_PROTOCOLS = ['http:', 'https:'] as const;

/**
 * Content-script match patterns covering every HTTP(S) document.
 */
export const HTTP_MATCH_PATTERNS = ['http://*/*', 'https://*/*'] as const;

/**
 * Supported HTTP URL protocol.
 */
type HttpProtocol = (typeof HTTP_PROTOCOLS)[number];

/**
 * Checks whether a URL uses one of the supported HTTP(S) schemes.
 *
 * @param url - URL to inspect.
 *
 * @returns - Whether the URL uses HTTP or HTTPS.
 */
export function isHttpUrl(url: URL): boolean {
    return HTTP_PROTOCOLS.includes(url.protocol as HttpProtocol);
}

/**
 * Parses a value as an HTTP(S) URL.
 *
 * @param value - Untrusted URL value.
 *
 * @returns - Parsed HTTP(S) URL, or null for invalid or unsupported values.
 */
export function parseHttpUrl(value: unknown): URL | null {
    if (typeof value !== 'string') {
        return null;
    }
    try {
        const url = new URL(value);
        return isHttpUrl(url) ? url : null;
    } catch {
        return null;
    }
}
