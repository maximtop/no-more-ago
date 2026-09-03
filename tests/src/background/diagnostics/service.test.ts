/**
 * @file Verifies top-level authorization for frame diagnostics.
 */

import { describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { DiagnosticsService } from "../../../../src/background/diagnostics/service";
import type { DiagnosticJournal } from "../../../../src/background/diagnostics/journal";
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../../../src/shared/diagnostics/contracts";
import { createSettingsSnapshot } from "../../../../src/shared/settings/snapshot";
import { SITE_SCOPE_MODE } from "../../../../src/shared/settings/site-scope";

/**
 * Creates a diagnostics service and observable journal.
 *
 * @param excludedSites - Top-level hostnames excluded from processing.
 * @returns - Service, state, and journal append spy.
 */
function fixture(excludedSites: readonly string[] = []) {
    const append = vi.fn(async () => undefined);
    const journal = { append } as unknown as DiagnosticJournal;
    const service = new DiagnosticsService(journal, { browserFamily: "other" });
    const snapshot = createSettingsSnapshot({
        revision: 1,
        globalEnabled: true,
        siteScope: { mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, excludedSites, allowedSites: [] },
        debugEnabled: true,
    });
    const state = { phase: "ready" as const, snapshot, failure: undefined };
    return { append, service, state };
}

describe("DiagnosticsService frame authorization", () => {
    it("accepts a child frame using the top-level tab policy", async () => {
        const fixtureValue = fixture();
        const accepted = await fixtureValue.service.record(
            { category: "timing", count: 1 },
            {
                url: "https://frame.example/path",
                tab: { url: "https://top.example/path", incognito: false },
            },
            fixtureValue.state,
        );

        expect(accepted).toBe(true);
        expect(fixtureValue.append).toHaveBeenCalledTimes(1);
        expect(fixtureValue.append).toHaveBeenCalledWith(
            expect.objectContaining({ hostname: "frame.example" }),
        );
    });

    it("rejects frames when the top-level site is disabled", async () => {
        const fixtureValue = fixture(["top.example"]);
        const accepted = await fixtureValue.service.record(
            { category: "timing", count: 1 },
            {
                url: "https://frame.example/path",
                tab: { url: "https://top.example/path" },
            },
            fixtureValue.state,
        );

        expect(accepted).toBe(false);
        expect(fixtureValue.append).not.toHaveBeenCalled();
    });

    it("passes sanitized invalid timestamp evidence to the enabled journal", async () => {
        const fixtureValue = fixture();
        const accepted = await fixtureValue.service.record(
            {
                category: DIAGNOSTIC_CATEGORY.SKIP,
                reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
                count: 1,
                sourceTimestamp: "123456789",
            },
            {
                url: "https://web.telegram.org/k/?private=query#fragment",
                tab: { url: "https://web.telegram.org/k/", incognito: false },
            },
            fixtureValue.state,
        );

        expect(accepted).toBe(true);
        expect(fixtureValue.append).toHaveBeenCalledWith(expect.objectContaining({
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
            hostname: "web.telegram.org",
            sourceTimestamp: "123456789",
        }));
        expect(JSON.stringify(fixtureValue.append.mock.calls))
            .not.toMatch(/private|query|fragment/u);
    });
});
