/**
 * @file Verifies the identity checks of the live YouTube player reader that runs in the page world.
 */

import {

    afterEach,
    describe,
    expect,
    it,
} from 'vitest';

import { readLiveYouTubePlayerPublication } from '../../../../src/shared/adapters/youtube-player';

const VIDEO = 'testVID0001';
const OTHER = 'testVID0002';
// The reader compares origins, and JSDOM serves the test page from its own origin.
const WATCH_VIDEO = new URL(`/watch?v=${VIDEO}`, window.location.origin).href;

/**
 * Installs a player element whose response reports the given identities.
 *
 * @param videoId - Video ID in the player details.
 * @param externalVideoId - Video ID in the microformat.
 */
function installPlayer(videoId: string, externalVideoId: string): void {
    const player = document.createElement('div');
    player.id = 'movie_player';
    Object.assign(player, {
        getPlayerResponse: () => ({
            videoDetails: { videoId },
            microformat: { playerMicroformatRenderer: { externalVideoId, publishDate: '2025-06-16' } },
        }),
    });
    document.body.append(player);
}

afterEach(() => {
    window.history.replaceState(null, '', '/');
    document.body.replaceChildren();
});

describe('live YouTube player reader', () => {
    it('returns the publication value when the page route and both player identities match', () => {
        window.history.replaceState(null, '', `/watch?v=${VIDEO}`);
        installPlayer(VIDEO, VIDEO);

        expect(readLiveYouTubePlayerPublication(WATCH_VIDEO, VIDEO)).toBe('2025-06-16');
    });

    it.each([
        ['the page has moved to another video', `/watch?v=${OTHER}`, VIDEO, VIDEO],
        ['the page has two video parameters', `/watch?v=${VIDEO}&v=${OTHER}`, VIDEO, VIDEO],
        ['the page left the Watch route', '/results?v=testVID0001', VIDEO, VIDEO],
        ['the player still holds the previous video', `/watch?v=${VIDEO}`, OTHER, VIDEO],
        ['the microformat belongs to another video', `/watch?v=${VIDEO}`, VIDEO, OTHER],
    ])('returns null when %s', (_case, route, videoId, externalVideoId) => {
        window.history.replaceState(null, '', route);
        installPlayer(videoId, externalVideoId);

        expect(readLiveYouTubePlayerPublication(WATCH_VIDEO, VIDEO)).toBeNull();
    });

    it('returns null when the requested URL belongs to another origin', () => {
        window.history.replaceState(null, '', `/watch?v=${VIDEO}`);
        installPlayer(VIDEO, VIDEO);

        expect(readLiveYouTubePlayerPublication(`https://elsewhere.test/watch?v=${VIDEO}`, VIDEO)).toBeNull();
    });

    it('returns null without a player', () => {
        window.history.replaceState(null, '', `/watch?v=${VIDEO}`);

        expect(readLiveYouTubePlayerPublication(WATCH_VIDEO, VIDEO)).toBeNull();
    });
});
