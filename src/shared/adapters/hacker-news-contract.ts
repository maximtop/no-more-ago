/**
 * @file Canonical Hacker News adapter identity and URL matching contract.
 */

/**
 * Stable adapter identifier shared by discovery and runtime processing.
 */
export const HACKER_NEWS_ADAPTER_ID = "hacker-news" as const;

/**
 * Canonical hostname handled by the Hacker News adapter.
 */
export const HACKER_NEWS_HOSTNAME = "news.ycombinator.com" as const;

/**
 * Checks whether a URL belongs to the supported HTTP(S) Hacker News origin.
 *
 * @param url - URL considered for adapter selection.
 * @returns - Whether the URL uses HTTP(S) and the exact canonical hostname.
 */
export function matchesHackerNewsUrl(url: URL): boolean {
    return (
        (url.protocol === "http:" || url.protocol === "https:")
        && url.hostname === HACKER_NEWS_HOSTNAME
    );
}
