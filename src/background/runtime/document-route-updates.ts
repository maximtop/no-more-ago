/**
 * @file Delivers payload-free same-document route signals to exact browser frames.
 */

import { YOUTUBE_HOSTNAME } from '../../shared/adapters/youtube-contract';
import { RECONCILE_DOCUMENT_ROUTE_MESSAGE } from
    '../../shared/messaging/document-messages';
import { parseHttpUrl } from '../../shared/url/http';

import type { TabsRuntime } from './tabs';

/**
 * Typed subset of one browser history-state update.
 */
export interface HistoryStateUpdateDetails {
    /**
     * Browser tab containing the changed frame.
     */
    readonly tabId: number;

    /**
     * Exact frame whose history state changed.
     */
    readonly frameId: number;

    /**
     * Browser-reported current frame URL.
     */
    readonly url: string;
}

/**
 * Browser history-state event source used by the background bridge.
 */
export interface HistoryStateUpdateSource {
    /**
     * Registers one listener for browser history-state updates.
     *
     * @param listener - Listener receiving typed browser event details.
     */
    addListener(listener: (details: HistoryStateUpdateDetails) => void): void;
}

/**
 * One per-frame delivery slot with at most one in-flight and one pending command.
 */
interface RouteDeliveryState {
    /**
     * Browser tab containing the target frame.
     */
    readonly tabId: number;

    /**
     * Exact target frame.
     */
    readonly frameId: number;

    /**
     * Whether one latest signal still needs delivery.
     */
    pending: boolean;

    /**
     * Whether a microtask has been queued to start delivery.
     */
    scheduled: boolean;

    /**
     * Whether exact-frame message delivery is currently unsettled.
     */
    inFlight: boolean;
}

/**
 * Delivers valid HTTP(S) history-state events as data-free commands to their exact frames.
 *
 * @param input - Browser event and targeted messaging capabilities.
 * @param input.updates - History-state event source.
 * @param input.tabs - Exact-frame message delivery capability.
 */
export function installDocumentRouteUpdates(input: {
    readonly updates: HistoryStateUpdateSource;
    readonly tabs: Pick<TabsRuntime, 'sendMessage'>;
}): void {
    const deliveries = new Map<string, RouteDeliveryState>();

    /**
     * Queues one delivery for a route key unless one is scheduled or in flight.
     *
     * @param key - Route delivery key.
     * @param state - Delivery state of the key.
     */
    const schedule = (key: string, state: RouteDeliveryState): void => {
        if (state.scheduled || state.inFlight) {
            return;
        }
        state.scheduled = true;
        queueMicrotask(() => {
            state.scheduled = false;
            if (!state.pending || deliveries.get(key) !== state) {
                return;
            }
            state.pending = false;
            state.inFlight = true;

            /**
             * Marks the delivery finished and reschedules it when a change arrived meanwhile.
             */
            const complete = (): void => {
                state.inFlight = false;
                if (state.pending) {
                    schedule(key, state);
                } else if (!state.scheduled) {
                    deliveries.delete(key);
                }
            };
            try {
                void Promise.resolve(input.tabs.sendMessage(
                    state.tabId,
                    { type: RECONCILE_DOCUMENT_ROUTE_MESSAGE },
                    { frameId: state.frameId },
                )).then(complete, complete);
            } catch {
                complete();
            }
        });
    };

    input.updates.addListener((details) => {
        const url = parseHttpUrl(details.url);
        if (url?.hostname !== YOUTUBE_HOSTNAME) {
            return;
        }
        const key = `${String(details.tabId)}:${String(details.frameId)}`;
        const existing = deliveries.get(key);
        if (existing) {
            existing.pending = true;
            schedule(key, existing);
            return;
        }
        const state: RouteDeliveryState = {
            tabId: details.tabId,
            frameId: details.frameId,
            pending: true,
            scheduled: false,
            inFlight: false,
        };
        deliveries.set(key, state);
        schedule(key, state);
    });
}
