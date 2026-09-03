/**
 * @file Verifies settings-command response schemas.
 */

import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
    resetAllSettingsResponseSchema,
    setDebugEnabledResponseSchema,
    setDisplaySettingsResponseSchema,
} from "../../../../src/shared/messaging/responses";
import { STATE_AVAILABILITY } from "../../../../src/shared/messaging/view-state-values";

describe("settings response schemas", () => {
    it("validates reset responses with their projected state", () => {
        const sites = {
            availability: STATE_AVAILABILITY.READY,
            revision: 3,
            globalEnabled: true,
            sites: [{ hostname: "github.com", enabled: true }],
        } as const;
        expect(v.is(resetAllSettingsResponseSchema, {
            ok: true,
            acceptedRevision: 3,
            state: sites,
        })).toBe(true);
        expect(v.is(resetAllSettingsResponseSchema, {
            ok: true,
            acceptedRevision: 3,
            state: sites,
            extra: true,
        })).toBe(false);
    });

    it("validates display and debug-setting responses", () => {
        const displayState = {
            availability: STATE_AVAILABILITY.READY,
            revision: 3,
            display: { formatMode: "system", timeZone: { mode: "system" } },
            debugEnabled: false,
        } as const;
        expect(v.is(setDisplaySettingsResponseSchema, {
            ok: true,
            acceptedRevision: 4,
            state: displayState,
            refreshFailures: [],
        })).toBe(true);
        expect(v.is(setDebugEnabledResponseSchema, {
            ok: true,
            acceptedRevision: 4,
            state: {
                availability: STATE_AVAILABILITY.READY,
                revision: 4,
                enabled: true,
            },
        })).toBe(true);
    });
});
