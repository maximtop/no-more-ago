/**
 * @file Verifies that the background entrypoint answers live YouTube player requests.
 */

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { READ_YOUTUBE_PUBLICATION_MESSAGE } from '../../../src/shared/messaging/document-messages';

const WATCH = 'https://www.youtube.com/watch?v=testVID0001';

/**
 * Runtime message listener installed by the background entrypoint.
 */
type MessageListener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
) => boolean;

/**
 * Installs the Chrome APIs the background entrypoint requires and imports it.
 *
 * @param pageResult - Value the page-world execution returns.
 *
 * @returns - The installed message listener and the page-world execution spy.
 *
 * @throws If the entrypoint installs no message listener.
 */
async function startBackground(pageResult: unknown): Promise<{
    readonly listener: MessageListener;
    readonly executeScript: ReturnType<typeof vi.fn>;
}> {
    let listener: MessageListener | undefined;
    const executeScript = vi.fn(async () => [{ frameId: 2, result: pageResult }]);
    vi.stubGlobal('chrome', {
        storage: {
            local: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => undefined),
                remove: vi.fn(async () => undefined),
            },
        },
        tabs: {
            query: vi.fn(async () => []),
            sendMessage: vi.fn(async () => undefined),
        },
        webNavigation: { getAllFrames: vi.fn(async () => []) },
        scripting: {
            getRegisteredContentScripts: vi.fn(async () => []),
            registerContentScripts: vi.fn(async () => undefined),
            updateContentScripts: vi.fn(async () => undefined),
            unregisterContentScripts: vi.fn(async () => undefined),
            executeScript,
        },
        runtime: {
            id: 'fixture-extension',
            getURL: (file: string) => `chrome-extension://fixture-extension/${file}`,
            getManifest: () => ({ version: '1.2.3' }),
            sendMessage: vi.fn(async () => undefined),
            onMessage: {
                addListener: (next: MessageListener) => {
                    listener = next;
                },
            },
        },
    });
    await import('../../../src/background/chrome');
    if (!listener) {
        throw new Error('Expected a runtime message listener');
    }
    return { listener, executeScript };
}

/**
 * Sends one live-player request from a YouTube frame and waits for the answer.
 *
 * @param listener - Background message listener.
 *
 * @returns - Whether the listener kept the channel open, and its answer.
 */
async function requestPublication(listener: MessageListener): Promise<{
    readonly keptOpen: boolean;
    readonly answer: unknown;
}> {
    let keptOpen = false;
    const answer = await new Promise((resolve) => {
        keptOpen = listener(
            { type: READ_YOUTUBE_PUBLICATION_MESSAGE, href: WATCH },
            { tab: { id: 7 } as chrome.tabs.Tab, frameId: 2, url: WATCH },
            resolve,
        );
    });
    return { keptOpen, answer };
}

describe('background entrypoint live YouTube player requests', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    it('reads the requesting frame in the page world and answers with the date', async () => {
        const { listener, executeScript } = await startBackground('2025-06-16');

        await expect(requestPublication(listener)).resolves.toEqual({ keptOpen: true, answer: '2025-06-16' });
        // The entrypoint loads its own module instance, so the function is matched by name.
        expect(executeScript).toHaveBeenCalledWith({
            target: { tabId: 7, frameIds: [2] },
            world: 'MAIN',
            func: expect.objectContaining({ name: 'readLiveYouTubePlayerPublication' }),
            args: [WATCH, 'testVID0001'],
        });
    });

    it('answers null when the page returns something that is not a date', async () => {
        const { listener } = await startBackground('three months ago');

        await expect(requestPublication(listener)).resolves.toEqual({ keptOpen: true, answer: null });
    });
});
