/**
 * @file Identity-bounded YouTube Watch route provenance and exact-script liveness.
 */

import {
    YOUTUBE_ADAPTER_ID,
    getYouTubeWatchVideoId,
} from '../../shared/adapters/youtube-contract';
import {
    DOCUMENT_ROUTE_HANDOFF_TRANSITION,
    type DocumentRouteHandoffClassifier,
    type DocumentRouteHandoffPolicy,
    type DocumentRouteHandoffSession,
} from '../transformation/route-handoff';

import { isYouTubeWatchPublicationSource } from './youtube';
import {
    findYouTubePlayerResponseScripts,
    releaseLivePlayerPublication,
    retainLivePlayerPublication,
} from './youtube-player-response';

/**
 * Asks the background to read the live player for a Watch URL. Resolves to null, or rejects,
 * when no answer arrives: the worker restarted or the extension was reloaded.
 */
export type ReadLivePlayerPublication = (href: string) => Promise<string | null>;

/**
 * Live player reads one Watch route may start. The player becomes ready after an unknown number
 * of navigation and media events; a video whose player never matches stops asking here.
 */
export const YOUTUBE_LIVE_PLAYER_READ_LIMIT = 6;

/**
 * Page events after which the live player may hold the new video.
 */
const LIVE_PLAYER_READY_EVENTS = ['yt-navigate-finish', 'yt-page-data-updated', 'loadedmetadata'] as const;

/**
 * Creates an inert handoff session for invalid activation input.
 *
 * @returns - Disposable no-op session.
 */
function inertSession(): DocumentRouteHandoffSession {
    return {
        noteStructure: () => undefined,
        dispose: () => undefined,
    };
}

/**
 * Activates exact recognized player-assignment monitoring for one route generation.
 *
 * @param input - Current route generation and reconciliation capability.
 * @param readLivePublication - Live player transport; without it only loaded data qualifies.
 *
 * @returns - Disposable route handoff session.
 */
function activateWatchHandoff(
    input: Parameters<DocumentRouteHandoffPolicy['activate']>[0],
    readLivePublication?: ReadLivePlayerPublication,
): DocumentRouteHandoffSession {
    const videoId = getYouTubeWatchVideoId(input.currentUrl);
    if (
        videoId === null
        || !Number.isSafeInteger(input.generation)
        || input.generation < 0
    ) {
        return inertSession();
    }
    let disposed = false;
    let reconciliationQueued = false;
    const observers = new Map<HTMLScriptElement, MutationObserver>();

    /**
     * Coalesces reconciliation requests into one microtask.
     */
    const queueReconciliation = (): void => {
        if (disposed || reconciliationQueued) {
            return;
        }
        reconciliationQueued = true;
        queueMicrotask(() => {
            reconciliationQueued = false;
            if (!disposed) {
                input.requestReconciliation();
            }
        });
    };

    /**
     * Observes every player-response script under the root that is not observed yet.
     *
     * @param root - Subtree to scan for player-response scripts.
     *
     * @returns - Whether a new script was bound.
     */
    const bind = (root: ParentNode): boolean => {
        let added = false;
        for (const script of findYouTubePlayerResponseScripts(root)) {
            if (
                !observers.has(script)
                && script.ownerDocument === input.document
                && script.isConnected
            ) {
                const observer = new MutationObserver(() => {
                    queueReconciliation();
                });
                observer.observe(script, {
                    childList: true,
                    characterData: true,
                    subtree: true,
                });
                observers.set(script, observer);
                added = true;
            }
        }
        return added;
    };

    let liveReads = 0;
    let reading = false;
    let readAgain = false;
    let retained = false;

    /**
     * Reads the live player once per readiness signal. Navigation and media readiness arrive in
     * either order, so a signal during a read starts one more read after it.
     */
    const readLivePlayer = async (): Promise<void> => {
        if (!readLivePublication) {
            return;
        }
        if (reading) {
            readAgain = true;
            return;
        }
        reading = true;
        while (!disposed && !retained && liveReads < YOUTUBE_LIVE_PLAYER_READ_LIMIT) {
            readAgain = false;
            liveReads += 1;
            let rawDatetime: string | null = null;
            try {
                rawDatetime = await readLivePublication(input.currentUrl.href);
            } catch {
                // No answer: the worker restarted or the extension was reloaded.
            }
            if (!disposed && rawDatetime) {
                retained = true;
                retainLivePlayerPublication(input.document, { videoId, rawDatetime });
                queueReconciliation();
            }
            if (!readAgain) {
                break;
            }
        }
        reading = false;
    };

    const liveReadyListener = (): void => {
        void readLivePlayer();
    };
    if (readLivePublication) {
        for (const event of LIVE_PLAYER_READY_EVENTS) {
            input.document.addEventListener(event, liveReadyListener, true);
        }
    }
    void readLivePlayer();
    bind(input.document);
    return {
        noteStructure: ({ addedRoots, removedRoots }) => {
            if (disposed) {
                return;
            }
            let relevant = false;
            for (const root of removedRoots) {
                for (const [script, observer] of [...observers]) {
                    if (root === script || root.contains(script)) {
                        observer.disconnect();
                        observers.delete(script);
                        relevant = true;
                    }
                }
            }
            for (const root of addedRoots) {
                relevant = bind(root) || relevant;
            }
            if (relevant) {
                queueReconciliation();
            }
        },
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            for (const event of LIVE_PLAYER_READY_EVENTS) {
                input.document.removeEventListener(event, liveReadyListener, true);
            }
            if (retained) {
                releaseLivePlayerPublication(input.document);
            }
            reconciliationQueued = false;
            for (const observer of observers.values()) {
                observer.disconnect();
            }
            observers.clear();
        },
    };
}

/**
 * Classifies every changed route into one total retained-policy transition.
 *
 * @param input - Cloned previous and current route URLs.
 * @param readLivePublication - Live player transport; without it only loaded data qualifies.
 *
 * @returns - Total retained-policy transition for the changed route.
 */
export function classifyYouTubeWatchRouteHandoff(
    input: Parameters<DocumentRouteHandoffClassifier>[0],
    readLivePublication?: ReadLivePlayerPublication,
): ReturnType<DocumentRouteHandoffClassifier> {
    const { previousUrl, currentUrl } = input;
    const previousVideoId = getYouTubeWatchVideoId(previousUrl);
    const currentVideoId = getYouTubeWatchVideoId(currentUrl);
    if (currentVideoId === null) {
        return {
            kind: previousVideoId === null
                ? DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP
                : DOCUMENT_ROUTE_HANDOFF_TRANSITION.CLEAR,
        };
    }
    if (previousVideoId === currentVideoId) {
        return { kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP };
    }
    return {
        kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE,
        policy: {
            allowsRule: (ruleId, source) => ruleId !== YOUTUBE_ADAPTER_ID || !isYouTubeWatchPublicationSource(source),
            activate: (session) => activateWatchHandoff(session, readLivePublication),
        },
    };
}
