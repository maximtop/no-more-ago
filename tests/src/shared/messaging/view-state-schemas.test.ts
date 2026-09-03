/**
 * @file Verifies background view-state schemas.
 */

import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
    displayStateSchema,
    popupStateSchema,
    sitesStateSchema,
} from "../../../../src/shared/messaging/view-state";
import {
    POPUP_STATUS,
    STATE_AVAILABILITY,
} from "../../../../src/shared/messaging/view-state-values";

const readyPopup = {
    availability: STATE_AVAILABILITY.READY,
    revision: 3,
    globalEnabled: true,
    hostname: "github.com",
    siteEnabled: true,
    status: POPUP_STATUS.ACTIVE,
} as const;

describe("background view-state schemas", () => {
    it("validates popup and sites projections", () => {
        expect(v.is(popupStateSchema, readyPopup)).toBe(true);
        expect(v.is(popupStateSchema, { ...readyPopup, status: "unknown" })).toBe(false);

        const sites = {
            availability: STATE_AVAILABILITY.READY,
            revision: 3,
            globalEnabled: true,
            sites: [{ hostname: "github.com", enabled: true }],
        } as const;
        expect(v.is(sitesStateSchema, sites)).toBe(true);
        expect(v.is(sitesStateSchema, {
            ...sites,
            sites: [{ ...sites.sites[0], extra: true }],
        })).toBe(false);
    });

    it("validates display projections and rejects unknown fields", () => {
        const displayState = {
            availability: STATE_AVAILABILITY.READY,
            revision: 3,
            display: { formatMode: "system", timeZone: { mode: "system" } },
            debugEnabled: false,
        } as const;
        expect(v.is(displayStateSchema, displayState)).toBe(true);
        expect(v.is(displayStateSchema, { ...displayState, extra: true })).toBe(false);
    });
});
