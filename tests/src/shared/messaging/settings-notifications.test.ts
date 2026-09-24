/**
 * @file Verifies the background-to-page settings change notification.
 */

import {
    describe, expect, it, vi,
} from 'vitest';

import {
    SETTINGS_CHANGED_MESSAGE,
    createSettingsChangedSubscriber,
} from '../../../../src/shared/messaging/settings-notifications';

describe('settings changed subscriber', () => {
    it('reports announced revisions and stops on unsubscribe', () => {
        const listeners: ((message: unknown) => void)[] = [];
        const runtime = {
            onMessage: {
                addListener: vi.fn((listener: (message: unknown) => void) => {
                    listeners.push(listener);
                }),
                removeListener: vi.fn((listener: (message: unknown) => void) => {
                    listeners.splice(listeners.indexOf(listener), 1);
                }),
            },
        };
        const revisions: number[] = [];
        const subscription = createSettingsChangedSubscriber(runtime)((revision) => {
            revisions.push(revision);
        });

        listeners[0]?.({ type: SETTINGS_CHANGED_MESSAGE, revision: 3 });
        listeners[0]?.({ type: 'no-more-ago:status' });
        subscription.unsubscribe();
        listeners.forEach((listener) => {
            listener({ type: SETTINGS_CHANGED_MESSAGE, revision: 4 });
        });

        expect(revisions).toEqual([3]);
        expect(runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    });

    it('ignores announcements that carry a sender tab', () => {
        let receive: ((message: unknown, sender?: { tab?: unknown }) => void) | undefined;
        const runtime = {
            onMessage: {
                addListener: (listener: typeof receive) => {
                    receive = listener;
                },
                removeListener: () => undefined,
            },
        };
        const revisions: number[] = [];
        createSettingsChangedSubscriber(runtime)((revision) => {
            revisions.push(revision);
        });

        receive?.({ type: SETTINGS_CHANGED_MESSAGE, revision: 5 }, { tab: { id: 12 } });
        receive?.({ type: SETTINGS_CHANGED_MESSAGE, revision: 6 }, {});
        receive?.({ type: SETTINGS_CHANGED_MESSAGE, revision: 7 });

        expect(revisions).toEqual([6, 7]);
    });

    it('never throws when the runtime cannot be observed', () => {
        const subscription = createSettingsChangedSubscriber(undefined)(() => undefined);
        expect(() => {
            subscription.unsubscribe();
        }).not.toThrow();
    });
});
