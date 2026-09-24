/**
 * @file Verifies bounded payload-free route signals to exact YouTube frames.
 */

import {
    describe, expect, it, vi,
} from 'vitest';

import {
    installDocumentRouteUpdates,
    type HistoryStateUpdateDetails,
    type HistoryStateUpdateSource,
} from '../../../../src/background/runtime/document-route-updates';
import { RECONCILE_DOCUMENT_ROUTE_MESSAGE } from
    '../../../../src/shared/messaging/document-messages';

/**
 * Creates an independently dispatchable history-state event source.
 *
 * @returns - Event source and captured listener dispatcher.
 */
function historyUpdates(): HistoryStateUpdateSource & {
    dispatch(details: HistoryStateUpdateDetails): void;
} {
    let listener: ((details: HistoryStateUpdateDetails) => void) | undefined;
    return {
        addListener(next) {
            listener = next;
        },
        dispatch(details) {
            listener?.(details);
        },
    };
}

/**
 * Flushes scheduled delivery and settled-promise continuation microtasks.
 */
async function flushDelivery(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('installDocumentRouteUpdates', () => {
    it('sends one payload-free command to the exact YouTube frame', async () => {
        const updates = historyUpdates();
        const sendMessage = vi.fn(() => Promise.resolve(undefined));
        installDocumentRouteUpdates({ updates, tabs: { sendMessage } });

        updates.dispatch({
            tabId: 17,
            frameId: 9,
            url: 'https://www.youtube.com/watch?v=testVID0002',
        });
        await flushDelivery();

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith(
            17,
            { type: RECONCILE_DOCUMENT_ROUTE_MESSAGE },
            { frameId: 9 },
        );
    });

    it('ignores non-HTTP and non-YouTube route contexts', async () => {
        const updates = historyUpdates();
        const sendMessage = vi.fn(() => Promise.resolve(undefined));
        installDocumentRouteUpdates({ updates, tabs: { sendMessage } });

        for (const url of [
            'https://example.test/next',
            'https://www.youtube.com.example.test/watch?v=testVID0002',
            'file:///tmp/page',
            'not a url',
        ]) {
            updates.dispatch({ tabId: 1, frameId: 0, url });
        }
        await flushDelivery();

        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('bounds each frame to one in-flight and one pending-latest delivery', async () => {
        const updates = historyUpdates();
        const completions: (() => void)[] = [];
        const sendMessage = vi.fn(() => new Promise<void>((resolve) => {
            completions.push(resolve);
        }));
        installDocumentRouteUpdates({ updates, tabs: { sendMessage } });
        const details = {
            tabId: 2,
            frameId: 3,
            url: 'https://www.youtube.com/watch?v=testVID0002',
        };

        updates.dispatch(details);
        updates.dispatch(details);
        updates.dispatch(details);
        await Promise.resolve();
        expect(sendMessage).toHaveBeenCalledOnce();

        updates.dispatch(details);
        updates.dispatch(details);
        await Promise.resolve();
        expect(sendMessage).toHaveBeenCalledOnce();

        completions[0]?.();
        await flushDelivery();
        expect(sendMessage).toHaveBeenCalledTimes(2);

        completions[1]?.();
        await flushDelivery();
    });

    it('keeps coalescing independent across exact frames', async () => {
        const updates = historyUpdates();
        const sendMessage = vi.fn(() => Promise.resolve(undefined));
        installDocumentRouteUpdates({ updates, tabs: { sendMessage } });

        updates.dispatch({
            tabId: 4,
            frameId: 0,
            url: 'https://www.youtube.com/',
        });
        updates.dispatch({
            tabId: 4,
            frameId: 2,
            url: 'https://www.youtube.com/results?search_query=fixture',
        });
        await flushDelivery();

        expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    it('contains synchronous and asynchronous frame-delivery failures', async () => {
        const updates = historyUpdates();
        const sendMessage = vi.fn()
            .mockImplementationOnce(() => {
                throw new Error('frame disappeared');
            })
            .mockRejectedValueOnce(new Error('frame disappeared'));
        installDocumentRouteUpdates({ updates, tabs: { sendMessage } });
        const details = {
            tabId: 2,
            frameId: 3,
            url: 'http://www.youtube.com/watch?v=testVID0002',
        };

        expect(() => {
            updates.dispatch(details);
        }).not.toThrow();
        await flushDelivery();
        expect(() => {
            updates.dispatch(details);
        }).not.toThrow();
        await flushDelivery();

        expect(sendMessage).toHaveBeenCalledTimes(2);
    });
});
