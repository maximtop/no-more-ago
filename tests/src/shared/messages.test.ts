/**
 * @file Verifies runtime schemas at the background messaging boundary.
 */

import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
    CLEAR_DIAGNOSTICS_MESSAGE,
    GET_DEBUG_STATE_MESSAGE,
    GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
    GET_DISPLAY_STATE_MESSAGE,
    GET_POPUP_STATE_MESSAGE,
    GET_SITES_STATE_MESSAGE,
    RESET_ALL_SETTINGS_MESSAGE,
    SET_DEBUG_ENABLED_MESSAGE,
    SET_DISPLAY_SETTINGS_MESSAGE,
    SET_GLOBAL_ENABLED_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    backgroundMessageSchema,
    clearDiagnosticsResponseSchema,
    diagnosticsSnapshotSchema,
    displayStateSchema,
    popupStateSchema,
    resetAllSettingsResponseSchema,
    setDebugEnabledResponseSchema,
    setDisplaySettingsResponseSchema,
    sitesStateSchema,
} from "../../../src/shared/messages";

const readyPopup = {
    availability: "ready",
    revision: 3,
    globalEnabled: true,
    hostname: "github.com",
    siteEnabled: true,
    status: "active",
} as const;

describe("background message schemas", () => {
    it("accepts every request shape used by extension views", () => {
        const messages = [
            { type: GET_POPUP_STATE_MESSAGE },
            { type: SET_GLOBAL_ENABLED_MESSAGE, enabled: false },
            { type: GET_SITES_STATE_MESSAGE },
            {
                type: SET_SITE_ENABLED_MESSAGE,
                hostname: "github.com",
                enabled: false,
                surface: "popup",
            },
            { type: GET_DISPLAY_STATE_MESSAGE },
            {
                type: SET_DISPLAY_SETTINGS_MESSAGE,
                display: { formatMode: "system", timeZone: { mode: "system" } },
            },
            { type: RESET_ALL_SETTINGS_MESSAGE },
            { type: GET_DEBUG_STATE_MESSAGE },
            { type: SET_DEBUG_ENABLED_MESSAGE, enabled: true },
            { type: GET_DIAGNOSTICS_SNAPSHOT_MESSAGE },
            { type: CLEAR_DIAGNOSTICS_MESSAGE },
        ];
        for (const message of messages) {
            expect(v.is(backgroundMessageSchema, message)).toBe(true);
        }
    });

    it("rejects unknown, incomplete, and extended request envelopes", () => {
        expect(v.is(backgroundMessageSchema, { type: "unknown" })).toBe(false);
        expect(v.is(backgroundMessageSchema, { type: SET_GLOBAL_ENABLED_MESSAGE })).toBe(false);
        expect(v.is(backgroundMessageSchema, {
            type: GET_POPUP_STATE_MESSAGE,
            extra: true,
        })).toBe(false);
    });

    it("validates popup and sites projections", () => {
        expect(v.is(popupStateSchema, readyPopup)).toBe(true);
        expect(v.is(popupStateSchema, { ...readyPopup, status: "unknown" })).toBe(false);

        const sites = {
            availability: "ready",
            revision: 3,
            globalEnabled: true,
            sites: [{ hostname: "github.com", enabled: true }],
        } as const;
        expect(v.is(sitesStateSchema, sites)).toBe(true);
        expect(v.is(resetAllSettingsResponseSchema, {
            ok: true,
            acceptedRevision: 3,
            state: sites,
        })).toBe(true);
        expect(v.is(sitesStateSchema, {
            ...sites,
            sites: [{ ...sites.sites[0], extra: true }],
        })).toBe(false);
    });

    it("validates display and diagnostic-setting responses", () => {
        const displayState = {
            availability: "ready",
            revision: 3,
            display: { formatMode: "system", timeZone: { mode: "system" } },
            debugEnabled: false,
        } as const;
        expect(v.is(displayStateSchema, displayState)).toBe(true);
        expect(v.is(setDisplaySettingsResponseSchema, {
            ok: true,
            acceptedRevision: 4,
            state: displayState,
            refreshFailures: [],
        })).toBe(true);
        expect(v.is(setDebugEnabledResponseSchema, {
            ok: true,
            acceptedRevision: 4,
            state: { availability: "ready", revision: 4, enabled: true },
        })).toBe(true);
    });

    it("validates the snapshot once at the diagnostic response boundary", () => {
        const snapshot = {
            entries: [{
                category: "lifecycle",
                timestamp: 1,
                hostname: "github.com",
                pageCategory: "repository",
                incognito: false,
            }],
            environment: { browserFamily: "chromium", extensionVersion: "0.1.0" },
        } as const;
        expect(v.is(diagnosticsSnapshotSchema, snapshot)).toBe(true);
        expect(v.is(diagnosticsSnapshotSchema, {
            ...snapshot,
            entries: [{ ...snapshot.entries[0], currentUrl: "https://github.com/private" }],
        })).toBe(false);
        expect(v.is(clearDiagnosticsResponseSchema, { ok: true })).toBe(true);
        expect(v.is(clearDiagnosticsResponseSchema, {
            ok: false,
            error: "storage-failed",
        })).toBe(true);
    });
});
