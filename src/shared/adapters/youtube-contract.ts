/**
 * @file Canonical YouTube adapter identity and watch-URL contract.
 */

/**
 * Stable identifier for the YouTube source adapter.
 */
export const YOUTUBE_ADAPTER_ID = "youtube" as const;

/**
 * Stable identifier for the loaded YouTube player-response source rule.
 */
export const YOUTUBE_PLAYER_RESPONSE_RULE_ID = "youtube-player-response" as const;

/**
 * Canonical desktop YouTube hostname.
 */
export const YOUTUBE_HOSTNAME = "www.youtube.com" as const;

/**
 * Canonical YouTube watch-page path.
 */
export const YOUTUBE_WATCH_PATHNAME = "/watch" as const;

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

/**
 * Extracts the video identity from one canonical desktop YouTube watch route.
 *
 * @param url - Page URL considered for adapter selection.
 * @returns - Validated watch video ID, or null for an unsupported URL.
 */
export function getYouTubeWatchVideoId(url: URL): string | null {
    const videoIds = url.searchParams.getAll("v");
    if (
        (url.protocol !== "http:" && url.protocol !== "https:")
        || url.hostname !== YOUTUBE_HOSTNAME
        || url.pathname !== YOUTUBE_WATCH_PATHNAME
        || videoIds.length !== 1
    ) {
        return null;
    }
    const videoId = videoIds[0] ?? "";
    return YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

/**
 * Checks whether a URL is one canonical desktop YouTube watch route.
 *
 * @param url - Page URL considered for adapter selection.
 * @returns - Whether the URL identifies one supported watch video.
 */
export function matchesYouTubeWatchUrl(url: URL): boolean {
    return getYouTubeWatchVideoId(url) !== null;
}
