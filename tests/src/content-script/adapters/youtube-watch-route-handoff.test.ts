/**
 * @file Verifies identity-bound YouTube Watch route handoff provenance and liveness.
 */

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    readYouTubePlayerResponsePublication,
} from '../../../../src/content-script/adapters/youtube-player-response';
import {
    YOUTUBE_LIVE_PLAYER_READ_LIMIT,
    classifyYouTubeWatchRouteHandoff,
    type ReadLivePlayerPublication,
} from '../../../../src/content-script/adapters/youtube-watch-route-handoff';
import {
    DOCUMENT_ROUTE_HANDOFF_TRANSITION,
    type DocumentRouteHandoffSession,
} from '../../../../src/content-script/transformation/route-handoff';
import {
    YOUTUBE_ADAPTER_ID,
    YOUTUBE_PLAYER_RESPONSE_RULE_ID,
} from '../../../../src/shared/adapters/youtube-contract';

const WATCH_A = 'https://www.youtube.com/watch?v=testVID0001';
const WATCH_B = 'https://www.youtube.com/watch?v=testVID0002';
const VIDEO_B = 'testVID0002';

/**
 * Fires media readiness the way the browser does: on a connected video, without bubbling.
 */
function dispatchVideoMetadataLoaded(): void {
    const video = document.querySelector('video') ?? document.body.appendChild(document.createElement('video'));
    video.dispatchEvent(new Event('loadedmetadata', { bubbles: false }));
}

/**
 * Flushes observer delivery and the session's coalescing microtask.
 *
 * @returns - Promise settled after queued microtasks.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('classifyYouTubeWatchRouteHandoff', () => {
    it('returns a total no-op, clear, or replace transition', () => {
        expect(classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL(WATCH_A),
            currentUrl: new URL(`${WATCH_A}&list=fixture`),
        })).toEqual({ kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP });

        expect(classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL('https://www.youtube.com/'),
            currentUrl: new URL('https://www.youtube.com/results?search_query=fixture'),
        })).toEqual({ kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP });

        for (const target of [
            'https://www.youtube.com/',
            'https://www.youtube.com/results?search_query=fixture',
            'https://www.youtube.com/@fixture/videos',
            'https://www.youtube.com/shorts/testVID0002',
            'https://example.test/watch?v=testVID0002',
        ]) {
            expect(classifyYouTubeWatchRouteHandoff({
                previousUrl: new URL(WATCH_A),
                currentUrl: new URL(target),
            })).toEqual({ kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.CLEAR });
        }

        for (const [previous, current] of [
            [WATCH_A, WATCH_B],
            ['https://www.youtube.com/', WATCH_A],
            ['https://www.youtube.com/results?search_query=fixture', WATCH_B],
        ] as const) {
            const transition = classifyYouTubeWatchRouteHandoff({
                previousUrl: new URL(previous),
                currentUrl: new URL(current),
            });
            expect(transition.kind).toBe(DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE);
            expect('policy' in transition).toBe(true);
        }
    });

    it('allows identity-bound loaded data and permanently quarantines unbound Watch tiers', () => {
        document.body.innerHTML = `
            <ytd-watch-metadata>
                <div id="info-strings"><yt-formatted-string>2 days ago</yt-formatted-string></div>
            </ytd-watch-metadata>
            <time datetime="2026-08-23T10:15Z">2 hours ago</time>`;
        const watchSource = document.querySelector('yt-formatted-string');
        const genericSource = document.querySelector('time');
        if (!watchSource || !genericSource) {
            throw new Error('Expected Watch and generic sources');
        }
        const transition = classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL(WATCH_A),
            currentUrl: new URL(WATCH_B),
        });
        if (transition.kind !== DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE) {
            throw new Error('Expected replacement policy');
        }

        expect(transition.policy.allowsRule(
            YOUTUBE_PLAYER_RESPONSE_RULE_ID,
            watchSource,
        )).toBe(true);
        expect(transition.policy.allowsRule(YOUTUBE_ADAPTER_ID, watchSource)).toBe(false);
        expect(transition.policy.allowsRule(YOUTUBE_ADAPTER_ID, genericSource)).toBe(true);
    });
});

describe('YouTube Watch handoff session', () => {
    it('coalesces exact assignment changes and bounded replacement roots', async () => {
        document.head.innerHTML = '<script>var ytInitialPlayerResponse = {"first":true};</script>';
        const script = document.head.querySelector('script');
        if (!script) {
            throw new Error('Expected player script');
        }
        const transition = classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL(WATCH_A),
            currentUrl: new URL(WATCH_B),
        });
        if (transition.kind !== DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE) {
            throw new Error('Expected replacement policy');
        }
        const requestReconciliation = vi.fn();
        const session = transition.policy.activate({
            document,
            currentUrl: new URL(WATCH_B),
            generation: 3,
            requestReconciliation,
        });

        script.textContent = 'var ytInitialPlayerResponse = {"second":true};';
        script.textContent = 'var ytInitialPlayerResponse = {"third":true};';
        await flushMutations();
        expect(requestReconciliation).toHaveBeenCalledOnce();

        const wrapper = document.createElement('div');
        wrapper.innerHTML = '<script>var ytInitialPlayerResponse = {"replacement":true};</script>';
        document.body.append(wrapper);
        session.noteStructure({ addedRoots: [wrapper], removedRoots: [] });
        session.noteStructure({ addedRoots: [wrapper], removedRoots: [] });
        await flushMutations();
        expect(requestReconciliation).toHaveBeenCalledTimes(2);

        session.dispose();
    });

    it('makes queued and later assignment work inert after disposal', async () => {
        document.head.innerHTML = '<script>var ytInitialPlayerResponse = {"first":true};</script>';
        const script = document.head.querySelector('script');
        if (!script) {
            throw new Error('Expected player script');
        }
        const transition = classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL(WATCH_A),
            currentUrl: new URL(WATCH_B),
        });
        if (transition.kind !== DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE) {
            throw new Error('Expected replacement policy');
        }
        const requestReconciliation = vi.fn();
        const session = transition.policy.activate({
            document,
            currentUrl: new URL(WATCH_B),
            generation: 4,
            requestReconciliation,
        });

        script.textContent = 'var ytInitialPlayerResponse = {"second":true};';
        session.dispose();
        await flushMutations();
        script.textContent = 'var ytInitialPlayerResponse = {"third":true};';
        await flushMutations();

        expect(requestReconciliation).not.toHaveBeenCalled();
    });
});

describe('YouTube Watch live player reads', () => {
    /**
     * Activates the session of a changed-video handoff to Watch B with a live player transport.
     *
     * @param readLivePublication - Live player transport under test.
     *
     * @returns - Active session and its reconciliation spy.
     *
     * @throws If the handoff is not classified as a replacement.
     */
    function activateWithLivePlayer(readLivePublication: ReadLivePlayerPublication): {
        readonly session: DocumentRouteHandoffSession;
        readonly requestReconciliation: ReturnType<typeof vi.fn>;
    } {
        document.head.replaceChildren();
        const transition = classifyYouTubeWatchRouteHandoff({
            previousUrl: new URL(WATCH_A),
            currentUrl: new URL(WATCH_B),
        }, readLivePublication);
        if (transition.kind !== DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE) {
            throw new Error('Expected replacement policy');
        }
        const requestReconciliation = vi.fn();
        const session = transition.policy.activate({
            document,
            currentUrl: new URL(WATCH_B),
            generation: 5,
            requestReconciliation,
        });
        return { session, requestReconciliation };
    }

    it('retains the value only for its own video and releases it with the route', async () => {
        const read = vi.fn<ReadLivePlayerPublication>(async () => '2025-06-16');
        const { session, requestReconciliation } = activateWithLivePlayer(read);
        await flushMutations();

        expect(read).toHaveBeenCalledWith(WATCH_B);
        expect(requestReconciliation).toHaveBeenCalledOnce();
        expect(readYouTubePlayerResponsePublication(document, VIDEO_B)).toBe('2025-06-16');
        expect(readYouTubePlayerResponsePublication(document, 'testVID0001')).toBeNull();

        session.dispose();
        expect(readYouTubePlayerResponsePublication(document, VIDEO_B)).toBeNull();
    });

    it('asks again on the next readiness event after a lost reply', async () => {
        const read = vi.fn<ReadLivePlayerPublication>()
            .mockRejectedValueOnce(new Error('Could not establish connection'))
            .mockResolvedValueOnce('2025-06-16');
        const { session, requestReconciliation } = activateWithLivePlayer(read);
        await flushMutations();
        expect(requestReconciliation).not.toHaveBeenCalled();

        document.dispatchEvent(new Event('yt-navigate-finish'));
        await flushMutations();

        expect(read).toHaveBeenCalledTimes(2);
        expect(requestReconciliation).toHaveBeenCalledOnce();
        expect(readYouTubePlayerResponsePublication(document, VIDEO_B)).toBe('2025-06-16');
        session.dispose();
    });

    it('reads once more after a readiness event that arrived during a read', async () => {
        let answerFirst: ((value: string | null) => void) | undefined;
        const read = vi.fn<ReadLivePlayerPublication>()
            .mockImplementationOnce(() => new Promise<string | null>((resolve) => {
                answerFirst = resolve;
            }))
            .mockResolvedValueOnce('2025-06-16');
        const { session } = activateWithLivePlayer(read);
        dispatchVideoMetadataLoaded();
        answerFirst?.(null);
        await flushMutations();

        expect(read).toHaveBeenCalledTimes(2);
        expect(readYouTubePlayerResponsePublication(document, VIDEO_B)).toBe('2025-06-16');
        session.dispose();
    });

    it('stops asking a player that never matches after the read limit', async () => {
        const read = vi.fn<ReadLivePlayerPublication>(async () => null);
        const { session } = activateWithLivePlayer(read);
        for (let event = 0; event < YOUTUBE_LIVE_PLAYER_READ_LIMIT * 2; event += 1) {
            dispatchVideoMetadataLoaded();

            await flushMutations();
        }

        expect(read).toHaveBeenCalledTimes(YOUTUBE_LIVE_PLAYER_READ_LIMIT);
        session.dispose();
    });

    it('ignores readiness events and late replies after disposal', async () => {
        let answer: ((value: string) => void) | undefined;
        const read = vi.fn<ReadLivePlayerPublication>(() => new Promise<string>((resolve) => {
            answer = resolve;
        }));
        const { session, requestReconciliation } = activateWithLivePlayer(read);
        session.dispose();
        answer?.('2025-06-16');
        document.dispatchEvent(new Event('yt-page-data-updated'));
        await flushMutations();

        expect(read).toHaveBeenCalledOnce();
        expect(requestReconciliation).not.toHaveBeenCalled();
        expect(readYouTubePlayerResponsePublication(document, VIDEO_B)).toBeNull();
    });
});
