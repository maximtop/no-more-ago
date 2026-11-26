/**
 * @file Reads the live YouTube Watch player in the page's own JavaScript world.
 */

/**
 * Longest publication value accepted from the live player.
 */
export const YOUTUBE_PLAYER_PUBLICATION_MAX_CHARACTERS = 64;

/**
 * Asks the background to read the live Watch player of the sending frame.
 */
export const READ_YOUTUBE_PUBLICATION_MESSAGE = 'no-more-ago:read-youtube-publication';

/**
 * Request for the live player's publication value of one Watch route.
 */
export interface ReadYouTubePublicationMessage {
    /**
     * Message discriminator.
     */
    readonly type: typeof READ_YOUTUBE_PUBLICATION_MESSAGE;

    /**
     * Watch URL the sending runtime currently processes.
     */
    readonly href: string;
}

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
    if (
        current.origin !== expected.origin
        || current.pathname !== expected.pathname
        || current.searchParams.getAll('v').length !== 1
        || current.searchParams.get('v') !== videoId
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
