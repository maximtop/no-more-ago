/**
 * @file Background-to-page settings change notification and its subscriber.
 */

import * as v from "valibot";
import { nonNegativeSafeIntegerSchema } from "./view-state-schemas";

/**
 * Announces that persisted settings changed and names the committed revision.
 */
export const SETTINGS_CHANGED_MESSAGE = "no-more-ago:settings-changed" as const;

/**
 * Exact notification sent by the background after a committed settings write.
 */
export const settingsChangedMessageSchema = v.strictObject({
    type: v.literal(SETTINGS_CHANGED_MESSAGE),
    revision: nonNegativeSafeIntegerSchema,
});

/**
 * Settings change notification inferred from its schema.
 */
export type SettingsChangedMessage = v.InferOutput<typeof settingsChangedMessageSchema>;

/**
 * Receives the revision committed by a settings change.
 */
export type SettingsChangedListener = (revision: number) => void;

/**
 * Cancels one settings change subscription.
 */
export interface SettingsChangedSubscription {
    /**
     * Stops delivering settings change notifications to the listener.
     */
    unsubscribe(): void;
}

/**
 * Subscribes a listener to committed settings changes.
 */
export type SubscribeSettingsChanged = (
    listener: SettingsChangedListener,
) => SettingsChangedSubscription;

/**
 * Sender metadata the runtime attaches to a message; only the tab is inspected.
 */
export interface SettingsChangedSender {
    /**
     * Tab that sent the message; absent for messages from the background.
     */
    readonly tab?: unknown;
}

/**
 * Extension message listener receiving the message and its sender.
 */
export type SettingsChangedRuntimeListener = (
    message: unknown,
    sender?: SettingsChangedSender,
) => void;

/**
 * Narrow runtime boundary used to observe extension messages.
 */
export interface SettingsChangedRuntime {
    /**
     * Extension message event exposing listener registration.
     */
    readonly onMessage: {
        /**
         * Registers one extension message listener.
         */
        addListener(listener: SettingsChangedRuntimeListener): void;

        /**
         * Removes one previously registered listener.
         */
        removeListener(listener: SettingsChangedRuntimeListener): void;
    };
}

/**
 * Recognizes an exact settings change notification.
 *
 * @param value - Runtime message.
 * @returns - Whether the value is a valid settings change notification.
 */
export function isSettingsChangedMessage(value: unknown): value is SettingsChangedMessage {
    return v.safeParse(settingsChangedMessageSchema, value).success;
}

/**
 * Subscriber that never delivers, for surfaces rendered without a runtime.
 *
 * @returns - Subscription with nothing to cancel.
 */
export const INERT_SETTINGS_CHANGED_SUBSCRIBER: SubscribeSettingsChanged = () => ({
    unsubscribe: () => undefined,
});

/**
 * Creates a subscriber over an extension message runtime.
 *
 * @param runtime - Message runtime, or undefined outside an extension page.
 * @returns - Subscriber that delivers committed revisions to its listener.
 */
export function createSettingsChangedSubscriber(
    runtime: SettingsChangedRuntime | undefined,
): SubscribeSettingsChanged {
    return (listener) => {
        if (!runtime) {
            return { unsubscribe: () => undefined };
        }

        /**
         * Forwards background revision announcements to the listener.
         *
         * @param message - Runtime message.
         * @param sender - Message sender metadata.
         */
        const receive: SettingsChangedRuntimeListener = (message, sender) => {
            // Only the background announces revisions; a message carrying a
            // sender tab came from a content script and is ignored.
            if (sender?.tab === undefined && isSettingsChangedMessage(message)) {
                listener(message.revision);
            }
        };
        try {
            runtime.onMessage.addListener(receive);
        } catch {
            // An incomplete browser shim exposes a runtime without message events.
            return { unsubscribe: () => undefined };
        }
        return {
            unsubscribe: () => {
                runtime.onMessage.removeListener(receive);
            },
        };
    };
}
