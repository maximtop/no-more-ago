/**
 * @file Verifies background view-state schemas.
 */

import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
    displayStateSchema,
    popupStateSchema,
    readySitesStateSchema,
    sitesStateSchema,
} from "../../../../src/shared/messaging/view-state-schemas";
import {
    POPUP_STATUS,
    STATE_AVAILABILITY,
} from "../../../../src/shared/messaging/view-state-values";
import { APPEARANCE } from "../../../../src/shared/settings/snapshot";
import { SITE_SCOPE_MODE } from "../../../../src/shared/settings/site-scope";

describe("background view-state schemas", () => {
    it("validates popup projections carrying scope mode and appearance", () => {
        const popup = {
            availability: STATE_AVAILABILITY.READY,
            revision: 4,
            globalEnabled: true,
            hostname: "github.com",
            siteEnabled: true,
            scopeMode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
            appearance: APPEARANCE.SYSTEM,
            status: POPUP_STATUS.ACTIVE,
        } as const;
        expect(v.is(popupStateSchema, popup)).toBe(true);
        expect(v.is(popupStateSchema, {
            ...popup,
            status: POPUP_STATUS.SITE_NOT_SELECTED,
        })).toBe(true);
        expect(v.is(popupStateSchema, { ...popup, scopeMode: "everything" })).toBe(false);
        expect(v.is(popupStateSchema, { ...popup, extra: true })).toBe(false);
    });

    it("validates sites projections carrying both retained lists", () => {
        const sites = {
            availability: STATE_AVAILABILITY.READY,
            revision: 4,
            globalEnabled: true,
            scopeMode: SITE_SCOPE_MODE.SELECTED_ONLY,
            excludedSites: ["excluded.test"],
            allowedSites: ["github.com"],
        } as const;
        expect(v.is(sitesStateSchema, sites)).toBe(true);
        expect(v.is(readySitesStateSchema, sites)).toBe(true);
        expect(v.is(sitesStateSchema, { ...sites, sites: [] })).toBe(false);
    });

    it("validates display projections carrying appearance", () => {
        expect(v.is(displayStateSchema, {
            availability: STATE_AVAILABILITY.READY,
            revision: 4,
            display: { formatMode: "system", timeZone: { mode: "system" } },
            appearance: APPEARANCE.DARK,
            debugEnabled: false,
        })).toBe(true);
        expect(v.is(displayStateSchema, {
            availability: STATE_AVAILABILITY.UNAVAILABLE,
            revision: null,
            display: null,
            appearance: APPEARANCE.SYSTEM,
            failure: "settings-load",
        })).toBe(true);
    });
});
