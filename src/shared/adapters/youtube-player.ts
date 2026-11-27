/**
 * @file Reads the live YouTube Watch player in the page's own JavaScript world.
 */

/**
 * Longest publication value accepted from the live player.
 */
export const YOUTUBE_PLAYER_PUBLICATION_MAX_CHARACTERS = 64;

/**
 * Reads the publication value of the live Watch player when its identity matches the route.
 * The browser serializes this function into the page's world without its module scope, so it
 * must stay self-contained. Page scripts can replace every global it touches, so its result
 * is untrusted and the caller parses it.
 *
 * @param href - Watch URL the requesting runtime processes.
 * @param videoId - Video ID of that URL.
 *
 * @returns - Publication value of the matching player, or null.
 */
export function readLiveYouTubePlayerPublication(href: string, videoId: string): unknown {
    const expected = new URL(href);
    const current = new URL(window.location.href);
    const currentVideoIds = current.searchParams.getAll('v');
    if (
        current.origin !== expected.origin
        || current.pathname !== expected.pathname
        || currentVideoIds.length !== 1
        || currentVideoIds[0] !== videoId
    ) {
        return null;
    }
    const player = document.querySelector<HTMLElement & {
        getPlayerResponse?: () => {
            videoDetails?: { videoId?: unknown };
            microformat?: { playerMicroformatRenderer?: { externalVideoId?: unknown; publishDate?: unknown } };
        } | null;
    }>('#movie_player');
    const response = player?.getPlayerResponse?.();
    const microformat = response?.microformat?.playerMicroformatRenderer;
    if (response?.videoDetails?.videoId !== videoId || microformat?.externalVideoId !== videoId) {
        return null;
    }
    return microformat.publishDate;
}
