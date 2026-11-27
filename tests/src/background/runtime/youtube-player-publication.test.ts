/**
 * @file Verifies the background boundary that reads the live YouTube player for one frame.
 */

import {

    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    SCRIPT_EXECUTION_WORLD,
    type InjectionResult,
    type ScriptingRuntime,
} from '../../../../src/background/runtime/scripting';
import {
    readYouTubePlayerPublication,
    type PublicationRequestSender,
} from '../../../../src/background/runtime/youtube-player-publication';
import {
    YOUTUBE_PLAYER_PUBLICATION_MAX_CHARACTERS,
    readLiveYouTubePlayerPublication,
} from '../../../../src/shared/adapters/youtube-player';

const WATCH = 'https://www.youtube.com/watch?v=testVID0001';
const SENDER: PublicationRequestSender = {
    tab: { id: 7 },
    frameId: 3,
    url: WATCH,
};

/**
 * Creates a scripting boundary whose page-world execution yields the given outcome.
 *
 * @param execute - Result of the one page-world execution.
 *
 * @returns - Scripting boundary and its execution spy.
 */
function scriptingWith(execute: () => Promise<readonly InjectionResult[]>): {
    readonly scripting: ScriptingRuntime;
    readonly executeScript: ReturnType<typeof vi.fn<ScriptingRuntime['executeScript']>>;
} {
    const executeScript = vi.fn<ScriptingRuntime['executeScript']>(execute);
    return {
        executeScript,
        scripting: {
            getRegisteredContentScripts: vi.fn(async () => []),
            registerContentScripts: vi.fn(async () => undefined),
            updateContentScripts: vi.fn(async () => undefined),
            unregisterContentScripts: vi.fn(async () => undefined),
            executeScript,
        },
    };
}

describe('live YouTube player publication boundary', () => {
    it('runs the reader in the page world of exactly the sending frame', async () => {
        const { scripting, executeScript } = scriptingWith(async () => [{ frameId: 3, result: '2025-06-16' }]);

        await expect(readYouTubePlayerPublication(scripting, SENDER, WATCH)).resolves.toBe('2025-06-16');
        expect(executeScript).toHaveBeenCalledWith({
            target: { tabId: 7, frameIds: [3] },
            world: SCRIPT_EXECUTION_WORLD.MAIN,
            func: readLiveYouTubePlayerPublication,
            args: [WATCH, 'testVID0001'],
        });
    });

    it.each<[string, PublicationRequestSender, string]>([
        ['a sender from another origin', { ...SENDER, url: 'https://example.test/watch?v=testVID0001' }, WATCH],
        ['a sender without a URL', { tab: { id: 7 }, frameId: 0 }, WATCH],
        ['a sender outside a tab', { frameId: 0, url: WATCH }, WATCH],
        ['a sender without a frame', { tab: { id: 7 }, url: WATCH }, WATCH],
        ['a URL that is not a Watch route', SENDER, 'https://www.youtube.com/results?search_query=fixture'],
        ['a URL that is not HTTP', SENDER, 'ftp://www.youtube.com/watch?v=testVID0001'],
    ])('refuses %s without running page code', async (_case, sender, href) => {
        const { scripting, executeScript } = scriptingWith(async () => [{ frameId: 3, result: '2025-06-16' }]);

        await expect(readYouTubePlayerPublication(scripting, sender, href)).resolves.toBeNull();
        expect(executeScript).not.toHaveBeenCalled();
    });

    it.each<[string, unknown]>([
        ['an object', { toString: '2025-06-16' }],
        ['a number', 20250616],
        ['an empty string', ''],
        ['a relative label', '3 months ago'],
        ['an impossible calendar date', '2025-02-30'],
        ['a date-time without a zone', '2025-06-16T08:00:08'],
        ['an over-long string', '2'.repeat(YOUTUBE_PLAYER_PUBLICATION_MAX_CHARACTERS + 1)],
        ['nothing', undefined],
    ])('rejects %s returned by the page', async (_case, result) => {
        const { scripting } = scriptingWith(async () => [{ frameId: 3, result }]);

        await expect(readYouTubePlayerPublication(scripting, SENDER, WATCH)).resolves.toBeNull();
    });

    it('accepts an explicitly zoned date-time', async () => {
        const { scripting } = scriptingWith(async () => [{ frameId: 3, result: '2025-06-16T08:00:08-07:00' }]);

        await expect(readYouTubePlayerPublication(scripting, SENDER, WATCH)).resolves.toBe('2025-06-16T08:00:08-07:00');
    });

    it('answers null when the browser refuses the injection', async () => {
        const { scripting } = scriptingWith(async () => {
            throw new Error('Cannot access contents of the page');
        });

        await expect(readYouTubePlayerPublication(scripting, SENDER, WATCH)).resolves.toBeNull();
    });

    it('answers null when the frame returned no result', async () => {
        const { scripting } = scriptingWith(async () => []);

        await expect(readYouTubePlayerPublication(scripting, SENDER, WATCH)).resolves.toBeNull();
    });
});
