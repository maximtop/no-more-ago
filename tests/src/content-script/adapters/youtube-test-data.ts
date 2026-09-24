/**
 * @file Shared YouTube identities, fixture locations, and valid player-response data.
 */

/**
 * Stable identities for the captured YouTube list fixtures.
 */
export const YOUTUBE_LIST_FIXTURE_ID = {
    HOME: 'home',
    SEARCH: 'search',
    CHANNEL_VIDEOS: 'channel-videos',
} as const;

/**
 * Identity accepted by boundary-specific YouTube list fixture assertions.
 */
export type YouTubeListFixtureId = (typeof YOUTUBE_LIST_FIXTURE_ID)[keyof typeof YOUTUBE_LIST_FIXTURE_ID];

/**
 * Shared identity, path, and URL for every captured YouTube list fixture.
 */
export const YOUTUBE_LIST_FIXTURES = [
    {
        id: YOUTUBE_LIST_FIXTURE_ID.HOME,
        name: 'Home',
        fixturePath:
            'tests/src/content-script/fixtures/youtube/home-modern-relative-only.html',
        url: 'https://www.youtube.com/',
    },
    {
        id: YOUTUBE_LIST_FIXTURE_ID.SEARCH,
        name: 'Search',
        fixturePath:
            'tests/src/content-script/fixtures/youtube/search-legacy-relative-only.html',
        url: 'https://www.youtube.com/results?search_query=fixture',
    },
    {
        id: YOUTUBE_LIST_FIXTURE_ID.CHANNEL_VIDEOS,
        name: 'Channel Videos',
        fixturePath:
            'tests/src/content-script/fixtures/youtube/'
            + 'channel-videos-modern-relative-only.html',
        url: 'https://www.youtube.com/@fixture-channel/videos',
    },
] as const;

/**
 * Serializes one exact player-response assignment with the production identity shape.
 *
 * @param publication - Publication value placed in the approved field.
 * @param videoId - Primary player video identity.
 * @param externalVideoId - Microformat video identity.
 *
 * @returns - Inert assignment text accepted by the recording parser when values are valid.
 */
export function youtubePlayerResponseAssignment(
    publication: unknown,
    videoId: unknown,
    externalVideoId: unknown = videoId,
): string {
    return `var ytInitialPlayerResponse = ${JSON.stringify({
        videoDetails: { videoId },
        microformat: {
            playerMicroformatRenderer: {
                externalVideoId,
                publishDate: publication,
            },
        },
    })};`;
}
