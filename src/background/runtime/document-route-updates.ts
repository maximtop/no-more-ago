/**
 * @file Delivers payload-free same-document route signals to exact browser frames.
 */

import { RECONCILE_DOCUMENT_ROUTE_MESSAGE } from
    "../../shared/messaging/document-messages";
import { parseHttpUrl } from "../../shared/url/http";
import type { TabsRuntime } from "./tabs";

/**
 * Browser history-state event source used by the background bridge.
 */
export interface HistoryStateUpdateSource {
    /**
     * Registers one listener for browser history-state updates.
     *
     * @param listener - Listener receiving untrusted browser event details.
     */
    addListener(listener: (details: unknown) => void): void;
}

/**
 * Tests whether a value is a non-negative browser tab or frame identifier.
 *
 * @param value - Untrusted identifier value.
 * @returns - Whether the value is a non-negative safe integer.
 */
function isBrowserIdentifier(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
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
    readonly tabs: Pick<TabsRuntime, "sendMessage">;
}): void {
    input.updates.addListener((details) => {
        if (typeof details !== "object" || details === null || Array.isArray(details)) {
            return;
        }
        const record = details as Record<string, unknown>;
        if (
            !isBrowserIdentifier(record.tabId)
            || !isBrowserIdentifier(record.frameId)
            || parseHttpUrl(record.url) === null
        ) {
            return;
        }
        try {
            void Promise.resolve(input.tabs.sendMessage(
                record.tabId,
                { type: RECONCILE_DOCUMENT_ROUTE_MESSAGE },
                { frameId: record.frameId },
            )).catch(() => undefined);
        } catch {
            /* the target frame may disappear before delivery */
        }
    });
}
