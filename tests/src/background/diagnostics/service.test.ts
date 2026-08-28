/**
 * @file Verifies top-level authorization for frame diagnostics.
 */

import { describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { DiagnosticsService } from "../../../../src/background/diagnostics/service";
import type { DiagnosticJournal } from "../../../../src/background/diagnostics/journal";
import { createSettingsSnapshot } from "../../../../src/shared/settings/snapshot";

/**
 * Creates a diagnostics service and observable journal.
 *
 * @param sitePreferences - Top-level site policy overrides.
 * @returns - Service, state, and journal append spy.
 */
function fixture(sitePreferences: Record<string, boolean> = {}) {
    const append = vi.fn(async () => undefined);
    const journal = { append } as unknown as DiagnosticJournal;
    const service = new DiagnosticsService(journal, { browserFamily: "other" });
    const snapshot = createSettingsSnapshot(1, true, sitePreferences, undefined, true);
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
        const fixtureValue = fixture({ "top.example": false });
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
});
