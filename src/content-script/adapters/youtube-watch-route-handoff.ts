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
import { findYouTubePlayerResponseScripts } from './youtube-player-response';

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
 *
 * @returns - Disposable route handoff session.
 */
function activateWatchHandoff(
    input: Parameters<DocumentRouteHandoffPolicy['activate']>[0],
): DocumentRouteHandoffSession {
    if (
        getYouTubeWatchVideoId(input.currentUrl) === null
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
                observers.has(script)
                || script.ownerDocument !== input.document
                || !script.isConnected
            ) {
                continue;
            }
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
        return added;
    };

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
            reconciliationQueued = false;
            for (const observer of observers.values()) {
                observer.disconnect();
            }
            observers.clear();
        },
    };
}

/**
 * Immutable loaded-only policy for a same-document Watch video handoff.
 */
const YOUTUBE_WATCH_HANDOFF_POLICY: DocumentRouteHandoffPolicy = Object.freeze({
    allowsRule: (ruleId: string, source: Element) => ruleId !== YOUTUBE_ADAPTER_ID || !isYouTubeWatchPublicationSource(source),
    activate: activateWatchHandoff,
});

/**
 * Classifies every changed route into one total retained-policy transition.
 *
 * @param input - Cloned previous and current route URLs.
 *
 * @returns - Total retained-policy transition for the changed route.
 */
export const classifyYouTubeWatchRouteHandoff: DocumentRouteHandoffClassifier = (input) => {
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
        policy: YOUTUBE_WATCH_HANDOFF_POLICY,
    };
};
