/**
 * @file Verifies all-frame settings broadcasts through top-level HTTP(S) tab policy.
 */

import { describe, expect, it, vi } from "vitest";

import { DocumentRefresh } from "../../../../src/background/settings/document-refresh";
import { HTTP_MATCH_PATTERNS } from "../../../../src/shared/url/http";
import {
    REFRESH_FAILURE_REASON,
    UPDATE_PRESENTATION_MESSAGE,
} from "../../../../src/shared/messages";
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
            sendMessage: vi.fn(() => Promise.resolve(undefined)),
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
        expect(tabs.sendMessage).toHaveBeenCalledOnce();
        expect(tabs.sendMessage).toHaveBeenCalledWith(1, {
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: snapshot.revision,
            display: snapshot.display,
        });
        expect(failures).toEqual([]);
    });

    it("contains tab broadcast failures", async () => {
        const tabs = {
            query: vi.fn(() => Promise.resolve([
                { id: 7, url: "https://example.test/page" },
            ])),
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
});
