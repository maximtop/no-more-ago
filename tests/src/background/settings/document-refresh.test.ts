/**
 * @file Verifies all-frame settings broadcasts through top-level HTTP(S) tab policy.
 */

import { describe, expect, it, vi } from "vitest";

import { DocumentRefresh } from "../../../../src/background/settings/document-refresh";
import { HTTP_MATCH_PATTERNS } from "../../../../src/shared/url/http";
import {
    DEBUG_POLICY_UPDATED_MESSAGE,
    PRESENTATION_UPDATED_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
} from "../../../../src/shared/messaging/document-messages";
import { REFRESH_FAILURE_REASON } from "../../../../src/shared/messaging/view-state-values";
import { createSettingsSnapshot } from "../../../../src/shared/settings/snapshot";

describe("DocumentRefresh", () => {
    it("broadcasts display changes only to distinct enabled HTTP(S) tabs", async () => {
        const tabs = {
            query: vi.fn(() => Promise.resolve([
                { id: 1, url: "https://enabled.test/page" },
                { id: 1, url: "https://enabled.test/page" },
                { id: 2, url: "https://disabled.test/page" },
                { id: 3, url: "ftp://enabled.test/page" },
            ])),
            getAllFrames: vi.fn(() => Promise.resolve([{ frameId: 0 }, { frameId: 1 }])),
            sendMessage: vi.fn((_: number, message: unknown) => Promise.resolve(
                message && typeof message === "object" && "revision" in message
                    ? {
                        type: PRESENTATION_UPDATED_MESSAGE,
                        revision: message.revision,
                    }
                    : undefined,
            )),
        };
        const snapshot = createSettingsSnapshot(
            3,
            true,
            { "disabled.test": false },
        );

        const failures = await new DocumentRefresh(tabs).refreshDisplay(
            snapshot,
            snapshot.display,
            snapshot.revision,
        );

        expect(tabs.query).toHaveBeenCalledWith({ url: [...HTTP_MATCH_PATTERNS] });
        expect(tabs.sendMessage).toHaveBeenCalledTimes(2);
        expect(tabs.sendMessage).toHaveBeenNthCalledWith(1, 1, {
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: snapshot.revision,
            display: snapshot.display,
        }, { frameId: 0 });
        expect(tabs.sendMessage).toHaveBeenNthCalledWith(2, 1, {
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: snapshot.revision,
            display: snapshot.display,
        }, { frameId: 1 });
        expect(failures).toEqual([]);
    });

    it("contains tab broadcast failures", async () => {
        const tabs = {
            query: vi.fn(() => Promise.resolve([
                { id: 7, url: "https://example.test/page" },
            ])),
            getAllFrames: vi.fn(() => Promise.resolve([{ frameId: 0 }])),
            sendMessage: vi.fn(() => Promise.reject(new Error("unreachable"))),
        };
        const snapshot = createSettingsSnapshot(4, true);

        const failures = await new DocumentRefresh(tabs).refreshDebugPolicy(
            snapshot,
            true,
            snapshot.revision,
        );

        expect(failures).toEqual([{
            hostname: "example.test",
            tabId: 7,
            reason: REFRESH_FAILURE_REASON.TAB_UPDATE,
        }]);
    });

    it("requires a matching acknowledgement when the browser returns one", async () => {
        const tabs = {
            query: vi.fn(() => Promise.resolve([
                { id: 8, url: "https://example.test/page" },
            ])),
            getAllFrames: vi.fn(() => Promise.resolve([{ frameId: 0 }])),
            sendMessage: vi.fn(() => Promise.resolve({
                type: PRESENTATION_UPDATED_MESSAGE,
                revision: 3,
            })),
        };
        const snapshot = createSettingsSnapshot(4, true);

        const failures = await new DocumentRefresh(tabs).refreshDisplay(
            snapshot,
            snapshot.display,
            snapshot.revision,
        );

        expect(failures).toEqual([{
            hostname: "example.test",
            tabId: 8,
            reason: REFRESH_FAILURE_REASON.TAB_UPDATE,
        }]);
    });

    it("reports a fulfilled broadcast without an acknowledgement", async () => {
        const tabs = {
            query: vi.fn(() => Promise.resolve([
                { id: 10, url: "https://example.test/page" },
            ])),
            getAllFrames: vi.fn(() => Promise.resolve([{ frameId: 0 }])),
            sendMessage: vi.fn(() => Promise.resolve(undefined)),
        };
        const snapshot = createSettingsSnapshot(5, true);

        const failures = await new DocumentRefresh(tabs).refreshDisplay(
            snapshot,
            snapshot.display,
            snapshot.revision,
        );

        expect(failures).toEqual([{
            hostname: "example.test",
            tabId: 10,
            reason: REFRESH_FAILURE_REASON.TAB_UPDATE,
        }]);
    });

    it("accepts the matching acknowledgement for each revisioned update", async () => {
        const tabs = {
            query: vi.fn(() => Promise.resolve([
                { id: 9, url: "https://example.test/page" },
            ])),
            getAllFrames: vi.fn(() => Promise.resolve([{ frameId: 0 }])),
            sendMessage: vi.fn((_: number, message: unknown) => Promise.resolve(
                message && typeof message === "object" && "revision" in message
                    ? {
                        type: "enabled" in message
                            ? DEBUG_POLICY_UPDATED_MESSAGE
                            : PRESENTATION_UPDATED_MESSAGE,
                        revision: message.revision,
                    }
                    : undefined,
            )),
        };
        const snapshot = createSettingsSnapshot(5, true);

        const failures = await new DocumentRefresh(tabs).refreshDebugPolicy(
            snapshot,
            true,
            snapshot.revision,
        );

        expect(failures).toEqual([]);
    });

    it("reports one tab failure when one reachable frame fails", async () => {
        const tabs = {
            query: vi.fn(() => Promise.resolve([
                { id: 11, url: "https://example.test/page" },
            ])),
            getAllFrames: vi.fn(() => Promise.resolve([{ frameId: 0 }, { frameId: 1 }])),
            sendMessage: vi.fn((_: number, __: unknown, options?: { frameId: number }) =>
                options?.frameId === 1
                    ? Promise.reject(new Error("unreachable frame"))
                    : Promise.resolve({ type: PRESENTATION_UPDATED_MESSAGE, revision: 5 })),
        };
        const snapshot = createSettingsSnapshot(5, true);

        const failures = await new DocumentRefresh(tabs).refreshDisplay(
            snapshot,
            snapshot.display,
            snapshot.revision,
        );

        expect(tabs.sendMessage).toHaveBeenCalledTimes(2);
        expect(failures).toEqual([{
            hostname: "example.test",
            tabId: 11,
            reason: REFRESH_FAILURE_REASON.TAB_UPDATE,
        }]);
    });

    it("reports one tab failure when no reachable frames are enumerated", async () => {
        const tabs = {
            query: vi.fn(() => Promise.resolve([
                { id: 12, url: "https://example.test/page" },
            ])),
            getAllFrames: vi.fn(() => Promise.resolve([])),
            sendMessage: vi.fn(() => Promise.resolve({
                type: PRESENTATION_UPDATED_MESSAGE,
                revision: 5,
            })),
        };
        const snapshot = createSettingsSnapshot(5, true);

        const failures = await new DocumentRefresh(tabs).refreshDisplay(
            snapshot,
            snapshot.display,
            snapshot.revision,
        );

        expect(tabs.sendMessage).not.toHaveBeenCalled();
        expect(failures).toEqual([{
            hostname: "example.test",
            tabId: 12,
            reason: REFRESH_FAILURE_REASON.TAB_UPDATE,
        }]);
    });
});
