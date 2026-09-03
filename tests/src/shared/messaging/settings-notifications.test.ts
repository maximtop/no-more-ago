/**
 * @file Verifies the background-to-page settings change notification.
 */

import * as v from "valibot";
import { describe, expect, it, vi } from "vitest";
import {
    SETTINGS_CHANGED_MESSAGE,
    createSettingsChangedSubscriber,
    isSettingsChangedMessage,
    settingsChangedMessageSchema,
} from "../../../../src/shared/messaging/settings-notifications";

describe("settings changed contract", () => {
    it("accepts one revision and rejects anything else", () => {
        expect(v.is(settingsChangedMessageSchema, {
            type: SETTINGS_CHANGED_MESSAGE,
            revision: 7,
        })).toBe(true);
        expect(isSettingsChangedMessage({ type: SETTINGS_CHANGED_MESSAGE, revision: 7 }))
            .toBe(true);
        expect(isSettingsChangedMessage({ type: SETTINGS_CHANGED_MESSAGE })).toBe(false);
        expect(isSettingsChangedMessage({ type: SETTINGS_CHANGED_MESSAGE, revision: -1 }))
            .toBe(false);
        expect(isSettingsChangedMessage({
            type: SETTINGS_CHANGED_MESSAGE,
            revision: 7,
            extra: true,
        })).toBe(false);
        expect(isSettingsChangedMessage({ type: "no-more-ago:status" })).toBe(false);
    });
});

describe("settings changed subscriber", () => {
    it("reports only valid revisions and stops on unsubscribe", () => {
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
        listeners[0]?.({ type: "no-more-ago:status" });
        subscription.unsubscribe();
        listeners.forEach((listener) => {
            listener({ type: SETTINGS_CHANGED_MESSAGE, revision: 4 });
        });

        expect(revisions).toEqual([3]);
        expect(runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    });

    it("never throws when the runtime cannot be observed", () => {
        const subscription = createSettingsChangedSubscriber(undefined)(() => undefined);
        expect(() => {
            subscription.unsubscribe();
        }).not.toThrow();
    });
});
