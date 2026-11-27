/**
 * @file Verifies content-script bootstrap and document-state requests.
 */

import { readFile } from 'node:fs/promises';

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    OWNED_OUTPUT_ATTRIBUTE,
    OWNED_SOURCE_ATTRIBUTE,
} from '../../../src/content-script/ownership-markers';
import { DOCUMENT_RUNTIME_SLOT } from '../../../src/content-script/runtime';
import { GET_DOCUMENT_STATE_MESSAGE } from '../../../src/shared/messaging/contracts';
import {
    DOCUMENT_POLICY_RECONCILED_MESSAGE,
    READ_YOUTUBE_PUBLICATION_MESSAGE,
    RECONCILE_DOCUMENT_POLICY_MESSAGE,
} from '../../../src/shared/messaging/document-messages';
import { SETTINGS_STATE_FAILURE } from '../../../src/shared/messaging/view-state-values';

import {
    YOUTUBE_LIST_FIXTURE_ID,
    YOUTUBE_LIST_FIXTURES,
    youtubePlayerResponseAssignment,
    type YouTubeListFixtureId,
} from './adapters/youtube-test-data';

const WATCH_A = 'https://www.youtube.com/watch?v=testVID0001';
const WATCH_B = 'https://www.youtube.com/watch?v=testVID0002';

const YOUTUBE_LIST_LABEL_SELECTORS = {
    [YOUTUBE_LIST_FIXTURE_ID.HOME]: '.ytContentMetadataViewModelMetadataTextLastPart',
    [YOUTUBE_LIST_FIXTURE_ID.SEARCH]: '.inline-metadata-item.ytd-video-meta-block',
    [YOUTUBE_LIST_FIXTURE_ID.CHANNEL_VIDEOS]:
        '.ytContentMetadataViewModelMetadataTextLastPart',
} satisfies Readonly<Record<YouTubeListFixtureId, string>>;

/**
 * Installs a minimal extension runtime mock.
 *
 * @param sendMessage - Optional document-state request handler.
 *
 * @returns - Runtime message mock.
 */
function installChromeMock(sendMessage?: (message: unknown) => Promise<unknown>) {
    let listener: (
        (message: unknown, sender?: unknown, response?: (value: unknown) => void) => unknown
    ) | undefined;
    const messages = {
        onMessage: {
            addListener: vi.fn((next: typeof listener) => {
                listener = next;
            }),
        },
        dispatch(message: unknown): unknown {
            let result: unknown;
            listener?.(message, undefined, (value) => {
                result = value;
            });
            return result;
        },
        ...(sendMessage === undefined ? {} : { sendMessage }),
    };
    vi.stubGlobal('chrome', { runtime: messages });
    return messages;
}

/**
 * Flushes runtime hydration and one scheduled document reconciliation.
 */
async function flushRuntime(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Verifies that one captured list page remains wholly page-owned.
 *
 * @param markup - Markup captured before runtime activation.
 * @param labelSelector - Selector for visible publication labels.
 * @param labelText - Label text captured before runtime activation.
 */
function expectLocalOnlyDocument(
    markup: string,
    labelSelector: string,
    labelText: readonly (string | null)[],
): void {
    expect(document.documentElement.outerHTML).toBe(markup);
    expect(Array.from(
        document.querySelectorAll(labelSelector),
        (label) => label.textContent,
    )).toEqual(labelText);
    expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector(`time[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
}

/**
 * Installs a Watch page whose head data belongs to the first video and whose label is relative.
 */
function installWatchPageOfFirstVideo(): void {
    document.head.innerHTML = '<meta itemprop="datePublished" content="2024-11-12">'
        + `<script>${youtubePlayerResponseAssignment('2024-11-12', 'testVID0001')}</script>`;
    document.body.innerHTML = '<ytd-watch-metadata><div id="info-strings">'
        + '<yt-formatted-string>3 months ago</yt-formatted-string></div></ytd-watch-metadata>';
}

/**
 * Returns the date of the current Watch output.
 *
 * @returns - Output date, or null without output.
 */
function watchOutputDate(): string | null {
    return document.querySelector<HTMLTimeElement>('time[data-no-more-ago-output]')?.dateTime ?? null;
}

/**
 * Creates a ready document-state response.
 *
 * @param enabled - Effective top-level policy.
 * @param revision - Settings revision carried by the state.
 *
 * @returns - Ready document state.
 */
function state(enabled = true, revision = 2) {
    return {
        availability: 'ready' as const,
        revision,
        enabled,
        display: { formatMode: 'system' as const, timeZone: { mode: 'utc' as const } },
        debugEnabled: false,
    };
}

describe('content entrypoint', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.doUnmock('../../../src/content-script/facebook/payload-runtime');
        vi.unstubAllGlobals();
        const current = (document as unknown as Record<symbol, {
            handle?: { teardown(): void };
        } | undefined>)[DOCUMENT_RUNTIME_SLOT];
        current?.handle?.teardown();
        Reflect.deleteProperty(document, DOCUMENT_RUNTIME_SLOT);
        document.head.replaceChildren();
        document.body.innerHTML = '<time datetime="2026-08-23T10:15:00Z">2 hours ago</time>';
    });

    it('starts immediately while the document is loading', async () => {
        const sendMessage = vi.fn(async () => state());
        const chrome = installChromeMock(sendMessage);
        vi.stubGlobal('window', { location: { href: 'https://example.test/page' } });

        await import('../../../src/content-script/main');
        await Promise.resolve();
        await Promise.resolve();

        expect(sendMessage).toHaveBeenCalledWith({ type: GET_DOCUMENT_STATE_MESSAGE });
        expect(chrome.onMessage.addListener).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-no-more-ago-output]')).not.toBeNull();
    });

    it('does not process a disabled document', async () => {
        const sendMessage = vi.fn(async () => state(false));
        installChromeMock(sendMessage);
        vi.stubGlobal('window', { location: { href: 'https://example.test/page' } });

        await import('../../../src/content-script/main');
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector('[data-no-more-ago-output]')).toBeNull();
    });

    it('keeps page content unchanged when document state is unavailable', async () => {
        const sendMessage = vi.fn(async () => ({
            availability: 'unavailable' as const,
            revision: null,
            enabled: false,
            display: null,
            debugEnabled: false,
            failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
        }));
        installChromeMock(sendMessage);
        vi.stubGlobal('window', { location: { href: 'https://example.test/page' } });

        await import('../../../src/content-script/main');
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector('time')?.textContent).toBe('2 hours ago');
    });

    it(
        'keeps output across a route-irrelevant popstate without network resolution',
        async () => {
            const sendMessage = vi.fn(async () => state());
            const chrome = installChromeMock(sendMessage);
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error(
                    'Production entrypoint must not resolve timestamps over the network',
                );
            });
            vi.stubGlobal('fetch', forbiddenFetch);
            let currentHref = 'https://example.test/initial';
            let popstate: (() => void) | undefined;
            const addEventListener = vi.fn((type: string, listener: () => void) => {
                if (type === 'popstate') {
                    popstate = listener;
                }
            });
            vi.stubGlobal('window', {
                location: {
                    get href() {
                        return currentHref;
                    },
                },
                addEventListener,
            });

            await import('../../../src/content-script/main');
            await Promise.resolve();
            await Promise.resolve();
            const initialOutput = document.querySelector('[data-no-more-ago-output]');
            expect(initialOutput).not.toBeNull();
            expect(addEventListener).toHaveBeenCalledOnce();
            expect(addEventListener).toHaveBeenCalledWith('popstate', expect.any(Function));

            currentHref = 'https://example.test/later?private=ignored';
            popstate?.();

            expect(document.querySelector('[data-no-more-ago-output]')).toBe(initialOutput);
            expect(forbiddenFetch).not.toHaveBeenCalled();
            expect(chrome.onMessage.addListener).toHaveBeenCalledTimes(1);
        },
    );

    it('reads the live player through the background after navigating to another video', async () => {
        installWatchPageOfFirstVideo();
        const livePublications = ['2025-06-16', null];
        const sendMessage = vi.fn(async (message: unknown) => {
            const { type } = message as { readonly type: string };
            return type === READ_YOUTUBE_PUBLICATION_MESSAGE ? livePublications.pop() : state();
        });
        installChromeMock(sendMessage);
        let currentHref = WATCH_A;
        let popstate: (() => void) | undefined;
        vi.stubGlobal('window', {
            location: {
                get href() {
                    return currentHref;
                },
            },
            addEventListener: (type: string, listener: () => void) => {
                if (type === 'popstate') {
                    popstate = listener;
                }
            },
        });

        await import('../../../src/content-script/main');
        await flushRuntime();
        expect(watchOutputDate()).toBe('2024-11-12');

        currentHref = WATCH_B;
        popstate?.();
        await flushRuntime();
        expect(watchOutputDate()).toBeNull();

        document.dispatchEvent(new Event('yt-page-data-updated'));
        await flushRuntime();
        expect(watchOutputDate()).toBe('2025-06-16');
        expect(sendMessage).toHaveBeenCalledWith({ type: READ_YOUTUBE_PUBLICATION_MESSAGE, href: WATCH_B });
    });

    it('does not show the first video\'s metadata when it starts after navigating in place', async () => {
        installWatchPageOfFirstVideo();
        const livePublications = ['2025-06-16', null];
        const sendMessage = vi.fn(async (message: unknown) => {
            const { type } = message as { readonly type: string };
            return type === READ_YOUTUBE_PUBLICATION_MESSAGE ? livePublications.pop() : state();
        });
        installChromeMock(sendMessage);
        vi.stubGlobal('window', { location: { href: WATCH_B }, addEventListener: vi.fn() });
        vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ name: WATCH_A } as PerformanceEntry]);

        await import('../../../src/content-script/main');
        await flushRuntime();
        expect(watchOutputDate()).toBeNull();

        document.dispatchEvent(new Event('yt-navigate-finish'));
        await flushRuntime();
        expect(watchOutputDate()).toBe('2025-06-16');
    });

    it.each(YOUTUBE_LIST_FIXTURES)(
        'keeps the $name fixture local-only through disable and re-enable',
        async ({ id, fixturePath, url }) => {
            document.documentElement.innerHTML = await readFile(fixturePath, 'utf8');
            const labelSelector = YOUTUBE_LIST_LABEL_SELECTORS[id];
            const originalMarkup = document.documentElement.outerHTML;
            const originalLabelText = Array.from(
                document.querySelectorAll(labelSelector),
                (label) => label.textContent,
            );
            expect(originalLabelText.length).toBeGreaterThan(0);

            let enabled = true;
            let revision = 2;
            const sendMessage = vi.fn(async (message: unknown) => {
                expect(message).toEqual({ type: GET_DOCUMENT_STATE_MESSAGE });
                return state(enabled, revision);
            });
            const chrome = installChromeMock(sendMessage);
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error('YouTube list pages must not make a player request');
            });
            vi.stubGlobal('fetch', forbiddenFetch);
            vi.stubGlobal('window', {
                location: { href: url },
                addEventListener: vi.fn(),
            });

            await import('../../../src/content-script/main');
            await flushRuntime();

            expectLocalOnlyDocument(originalMarkup, labelSelector, originalLabelText);
            expect(forbiddenFetch).not.toHaveBeenCalled();

            enabled = false;
            revision = 3;
            expect(chrome.dispatch({
                type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
                revision,
                enabled,
            })).toEqual({ type: DOCUMENT_POLICY_RECONCILED_MESSAGE, revision });
            await flushRuntime();

            expectLocalOnlyDocument(originalMarkup, labelSelector, originalLabelText);
            expect(forbiddenFetch).not.toHaveBeenCalled();

            enabled = true;
            revision = 4;
            expect(chrome.dispatch({
                type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
                revision,
                enabled,
            })).toEqual({
                type: DOCUMENT_POLICY_RECONCILED_MESSAGE,
                revision,
            });
            await flushRuntime();

            expectLocalOnlyDocument(originalMarkup, labelSelector, originalLabelText);
            expect(forbiddenFetch).not.toHaveBeenCalled();
            expect(sendMessage).toHaveBeenCalledTimes(2);
            expect(chrome.onMessage.addListener).toHaveBeenCalledOnce();
        },
    );

    it.each([
        { enabled: true, expectedActivity: [true] },
        { enabled: false, expectedActivity: [] },
    ])(
        'coordinates Facebook payload activity for enabled=$enabled',
        async ({ enabled, expectedActivity }) => {
            const setEnabled = vi.fn<(active: boolean) => void>();
            const installFacebookPayloadRuntime = vi.fn(() => ({
                setEnabled,
                teardown: vi.fn(),
            }));
            vi.doMock(
                '../../../src/content-script/facebook/payload-runtime',
                () => ({ installFacebookPayloadRuntime }),
            );
            const sendMessage = vi.fn(async () => state(enabled));
            installChromeMock(sendMessage);
            vi.stubGlobal('window', {
                location: { href: 'https://www.facebook.com/home' },
            });

            await import('../../../src/content-script/main');
            await Promise.resolve();
            await Promise.resolve();

            expect(installFacebookPayloadRuntime).toHaveBeenCalledOnce();
            expect(setEnabled.mock.calls.map(([active]) => active))
                .toEqual(expectedActivity);
        },
    );
});
