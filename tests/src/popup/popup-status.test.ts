/**
 * @file Verifies popup status text, tone, and site-control copy.
 */

import { describe, expect, it } from "vitest";
import { APPEARANCE } from "../../../src/shared/settings/snapshot";
import { SITE_SCOPE_MODE } from "../../../src/shared/settings/site-scope";
import {
    POPUP_STATUS,
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../../../src/shared/messaging/view-state-values";
import type { PopupState } from "../../../src/shared/messaging/view-state-schemas";
import { popupStatusModel, siteControlDescription } from "../../../src/popup/popup-status";

const ready = (overrides: Partial<PopupState> = {}): PopupState => ({
    availability: STATE_AVAILABILITY.READY,
    revision: 2,
    globalEnabled: true,
    hostname: "github.com",
    siteEnabled: true,
    scopeMode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
    appearance: APPEARANCE.SYSTEM,
    status: POPUP_STATUS.ACTIVE,
    ...overrides,
} as PopupState);

describe("popup status", () => {
    it.each([
        [POPUP_STATUS.ACTIVE, "Active", "active"],
        [POPUP_STATUS.GLOBAL_DISABLED, "Extension is off", "neutral"],
        [POPUP_STATUS.SITE_EXCLUDED, "Excluded on this site", "neutral"],
        [POPUP_STATUS.SITE_NOT_SELECTED, "Not selected for this site", "neutral"],
        [POPUP_STATUS.INACCESSIBLE, "Cannot run on this page", "warning"],
        [POPUP_STATUS.RUNTIME_FAILED, "Could not process this page", "danger"],
    ])("describes %s", (status, text, tone) => {
        expect(popupStatusModel(ready({ status }))).toEqual({ text, tone });
    });

    it("describes an unknown processing state after a fail-closed cleanup", () => {
        expect(popupStatusModel({
            availability: STATE_AVAILABILITY.UNAVAILABLE,
            revision: null,
            globalEnabled: null,
            hostname: null,
            siteEnabled: null,
            scopeMode: null,
            appearance: APPEARANCE.SYSTEM,
            status: POPUP_STATUS.RUNTIME_FAILED,
            failure: SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP,
        })).toEqual({ text: "Current processing state is unknown", tone: "warning" });
    });

    it.each([
        [SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, true, "adds this hostname to Excluded sites"],
        [SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, false, "removes this hostname from Excluded sites"],
        [SITE_SCOPE_MODE.SELECTED_ONLY, true, "removes this hostname from Allowed sites"],
        [SITE_SCOPE_MODE.SELECTED_ONLY, false, "adds this hostname to Allowed sites"],
    ])("explains the site switch for %s when enabled is %s", (mode, enabled, expected) => {
        expect(siteControlDescription(mode, enabled)).toContain(expected);
    });
});
