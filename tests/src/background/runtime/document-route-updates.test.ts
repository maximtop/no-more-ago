/**
 * @file Verifies payload-free same-document route signals to exact browser frames.
 */

import { describe, expect, it, vi } from "vitest";

import {
    installDocumentRouteUpdates,
    type HistoryStateUpdateSource,
} from "../../../../src/background/runtime/document-route-updates";
import { RECONCILE_DOCUMENT_ROUTE_MESSAGE } from
    "../../../../src/shared/messaging/document-messages";

/**
 * Creates an independently dispatchable history-state event source.
 *
 * @returns - Event source and captured listener dispatcher.
 */
function historyUpdates(): HistoryStateUpdateSource & { dispatch(details: unknown): void } {
    let listener: ((details: unknown) => void) | undefined;
    return {
        addListener(next) {
            listener = next;
        },
        dispatch(details) {
            listener?.(details);
        },
    };
}

describe("installDocumentRouteUpdates", () => {
    it("sends one payload-free command to the exact validated frame", () => {
        const updates = historyUpdates();
        const sendMessage = vi.fn(() => Promise.resolve(undefined));
        installDocumentRouteUpdates({ updates, tabs: { sendMessage } });

        updates.dispatch({
            tabId: 17,
            frameId: 9,
            url: "https://www.youtube.com/watch?v=testVID0002",
            transitionType: "auto_subframe",
        });

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith(
            17,
            { type: RECONCILE_DOCUMENT_ROUTE_MESSAGE },
            { frameId: 9 },
        );
    });

    it("rejects unsafe identifiers and non-HTTP event URLs", () => {
        const updates = historyUpdates();
        const sendMessage = vi.fn(() => Promise.resolve(undefined));
        installDocumentRouteUpdates({ updates, tabs: { sendMessage } });

        for (const details of [
            null,
            {},
            { tabId: -1, frameId: 0, url: "https://example.test" },
            { tabId: 1.5, frameId: 0, url: "https://example.test" },
            { tabId: 1, frameId: Number.MAX_SAFE_INTEGER + 1, url: "https://example.test" },
            { tabId: 1, frameId: -1, url: "https://example.test" },
            { tabId: 1, frameId: 0, url: "file:///tmp/page" },
            { tabId: 1, frameId: 0, url: "not a url" },
            { tabId: 1, frameId: 0 },
        ]) {
            updates.dispatch(details);
        }

        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("contains synchronous and asynchronous frame-delivery failures", async () => {
        const updates = historyUpdates();
        const sendMessage = vi.fn()
            .mockImplementationOnce(() => {
                throw new Error("frame disappeared");
            })
            .mockRejectedValueOnce(new Error("frame disappeared"));
        installDocumentRouteUpdates({ updates, tabs: { sendMessage } });
        const details = { tabId: 2, frameId: 3, url: "http://example.test/next" };

        expect(() => {
            updates.dispatch(details);
        }).not.toThrow();
        expect(() => {
            updates.dispatch(details);
        }).not.toThrow();
        await Promise.resolve();

        expect(sendMessage).toHaveBeenCalledTimes(2);
    });
});
