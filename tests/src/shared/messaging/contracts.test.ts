/**
 * @file Verifies background request and diagnostic response contracts.
 */

import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../../../src/shared/diagnostics/contracts";
import {
    CLEAR_DIAGNOSTICS_MESSAGE,
    GET_DEBUG_STATE_MESSAGE,
    GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
    GET_DISPLAY_STATE_MESSAGE,
    GET_DOCUMENT_STATE_MESSAGE,
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
} from "../../../../src/shared/messaging/contracts";
import { SITE_SETTINGS_SURFACE } from "../../../../src/shared/messaging/view-state-values";

describe("background message contracts", () => {
    it("accepts every request shape used by extension views", () => {
        const messages = [
            { type: GET_POPUP_STATE_MESSAGE },
            { type: GET_DOCUMENT_STATE_MESSAGE },
            { type: SET_GLOBAL_ENABLED_MESSAGE, enabled: false },
            { type: GET_SITES_STATE_MESSAGE },
            {
                type: SET_SITE_ENABLED_MESSAGE,
                hostname: "github.com",
                enabled: false,
                surface: SITE_SETTINGS_SURFACE.POPUP,
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

    it("validates the diagnostic snapshot and clear response boundaries", () => {
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
        expect(v.is(diagnosticsSnapshotSchema, {
            ...snapshot,
            entries: [{
                category: DIAGNOSTIC_CATEGORY.SKIP,
                timestamp: 2,
                hostname: "web.telegram.org",
                pageCategory: "other",
                incognito: false,
                reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
                sourceTimestamp: "123456789",
            }],
        })).toBe(true);
        expect(v.is(diagnosticsSnapshotSchema, {
            ...snapshot,
            entries: [{
                category: DIAGNOSTIC_CATEGORY.ADAPTER,
                timestamp: 2,
                hostname: "web.telegram.org",
                pageCategory: "other",
                incognito: false,
                reason: DIAGNOSTIC_REASON.ADAPTER_MATCHED,
                sourceTimestamp: "1778774880",
            }],
        })).toBe(false);
        expect(v.is(clearDiagnosticsResponseSchema, { ok: true })).toBe(true);
        expect(v.is(clearDiagnosticsResponseSchema, {
            ok: false,
            error: "storage-failed",
        })).toBe(true);
    });
});
