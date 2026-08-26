import { describe, expect, it } from "vitest";
import { DIAGNOSTICS_MAX_BYTES } from "../../src/diagnostics/journal";
import {
    GET_SITES_STATE_MESSAGE,
    GET_DISPLAY_STATE_MESSAGE,
    GET_DEBUG_STATE_MESSAGE,
    GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
    CLEAR_DIAGNOSTICS_MESSAGE,
    RESET_ALL_SETTINGS_MESSAGE,
    SET_DISPLAY_SETTINGS_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    SET_DEBUG_ENABLED_MESSAGE,
    isBackgroundMessage,
    isGetSitesStateMessage,
    isPopupState,
    isSetSiteEnabledMessage,
    isSitesState,
    isDisplayState,
    isDebugState,
    isGetDebugStateMessage,
    isGetDiagnosticsSnapshotMessage,
    isClearDiagnosticsMessage,
    isDiagnosticsSnapshot,
    isGetDiagnosticsSnapshotResponse,
    isClearDiagnosticsResponse,
    isSetDebugEnabledMessage,
    isSetDebugEnabledResponse,
    isSetDisplaySettingsMessage,
    isSetDisplaySettingsResponse,
    isResetAllSettingsMessage,
    isResetAllSettingsResponse
} from "../../src/background/messages";

const popup = {
    availability: "ready" as const,
    revision: 2,
    globalEnabled: true,
    hostname: "github.com",
    siteEnabled: true,
    hasAdapter: true,
    status: "active" as const
};

describe("background V3 message contracts", () => {
    it("accepts only exact privileged diagnostics request envelopes", () => {
        for (const [type, guard] of [
            [GET_DIAGNOSTICS_SNAPSHOT_MESSAGE, isGetDiagnosticsSnapshotMessage],
            [CLEAR_DIAGNOSTICS_MESSAGE, isClearDiagnosticsMessage]
        ] as const) {
            expect(guard({ type })).toBe(true);
            expect(isBackgroundMessage({ type })).toBe(true);
            expect(guard({ type, extra: true })).toBe(false);
            expect(guard(Object.create({ type }))).toBe(false);
        }
    });

    it("validates complete plain JSON diagnostic snapshots and finite trusted metadata", () => {
        const event = { category: "mutation", timestamp: 5, hostname: "github.com", pageCategory: "issue", incognito: true, count: 2, extensionVersion: "1.2.3", browserFamily: "firefox" };
        const snapshot = { entries: [event], environment: { extensionVersion: "1.2.3", browserFamily: "firefox" } };
        expect(isDiagnosticsSnapshot(snapshot)).toBe(true);
        expect(isDiagnosticsSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true);
        expect(isGetDiagnosticsSnapshotResponse({ ok: true, snapshot })).toBe(true);
        expect(isDiagnosticsSnapshot({ ...snapshot, extra: true })).toBe(false);
        expect(isDiagnosticsSnapshot({ entries: [], environment: snapshot.environment })).toBe(false);
        expect(isDiagnosticsSnapshot({ entries: [{ ...event, url: "https://github.com/private?token=secret" }], environment: snapshot.environment })).toBe(false);
        expect(isDiagnosticsSnapshot({ entries: [event], environment: { ...snapshot.environment, account: "private" } })).toBe(false);
        expect(isDiagnosticsSnapshot({ entries: [event], environment: { browserFamily: "safari" } })).toBe(false);
        expect(isDiagnosticsSnapshot({ entries: [event], environment: { browserFamily: "firefox", extensionVersion: "contains/private" } })).toBe(false);
        expect(isDiagnosticsSnapshot({ entries: [event], environment: Object.assign(Object.create({ extensionVersion: "2.0" }) as Record<string, unknown>, { browserFamily: "firefox" }) })).toBe(false);
        expect(isDiagnosticsSnapshot(Object.assign(Object.create({ token: "private" }) as Record<string, unknown>, snapshot))).toBe(false);
        expect(isDiagnosticsSnapshot({ entries: [event], environment: Object.assign(Object.create({ token: "private" }) as Record<string, unknown>, snapshot.environment) })).toBe(false);
        expect(isGetDiagnosticsSnapshotResponse({ ok: true, snapshot, extra: true })).toBe(false);
        expect(isGetDiagnosticsSnapshotResponse(Object.assign(Object.create({ snapshot }) as Record<string, unknown>, { ok: true }))).toBe(false);
        for (const error of ["disabled", "unavailable", "empty", "invalid-journal", "storage-failed"]) {
            expect(isGetDiagnosticsSnapshotResponse({ ok: false, error })).toBe(true);
            expect(isGetDiagnosticsSnapshotResponse({ ok: false, error, extra: true })).toBe(false);
        }
        expect(isGetDiagnosticsSnapshotResponse({ ok: false, error: "attacker" })).toBe(false);
    });

    it("accepts only strict preserving-enable clear outcomes", () => {
        expect(isClearDiagnosticsResponse({ ok: true })).toBe(true);
        expect(isClearDiagnosticsResponse({ ok: true, extra: true })).toBe(false);
        for (const error of ["disabled", "unavailable", "storage-failed"]) {
            expect(isClearDiagnosticsResponse({ ok: false, error })).toBe(true);
        }
        expect(isClearDiagnosticsResponse({ ok: false, error: "empty" })).toBe(false);
        expect(isClearDiagnosticsResponse(Object.assign(Object.create({ error: "storage-failed" }) as Record<string, unknown>, { ok: false }))).toBe(false);
    });

    it("rejects inherited hidden serializers and accessor fields throughout diagnostic responses", () => {
        const event = { category: "mutation", timestamp: 5, hostname: "github.com", pageCategory: "issue", incognito: true, stack: ["frame:4"] };
        const snapshot = { entries: [event], environment: { browserFamily: "firefox" } };
        const serializer = Object.defineProperty({}, "toJSON", {
            value: () => ({ entries: [event], environment: snapshot.environment, url: "https://github.com/private?token=secret", datetime: "2026-08-23T10:15:00Z", dom: "<secret>" })
        });
        const arraySerializer = Object.defineProperty(Object.create(Array.prototype) as object, "toJSON", { value: () => ({ dom: "<secret>" }) });
        const inheritedRoot = Object.assign(Object.create(serializer) as Record<string, unknown>, snapshot);
        const inheritedEnvironment = Object.assign(Object.create(serializer) as Record<string, unknown>, snapshot.environment);
        const inheritedEvent = Object.assign(Object.create(serializer) as Record<string, unknown>, event);
        const inheritedEntries = Object.setPrototypeOf([event], arraySerializer) as typeof event[];
        const inheritedStack = Object.setPrototypeOf(["frame:4"], arraySerializer) as string[];
        for (const invalid of [inheritedRoot, { ...snapshot, environment: inheritedEnvironment }, { ...snapshot, entries: [inheritedEvent] }, { ...snapshot, entries: inheritedEntries }, { ...snapshot, entries: [{ ...event, stack: inheritedStack }] }]) {
            expect(isDiagnosticsSnapshot(invalid)).toBe(false);
            expect(isGetDiagnosticsSnapshotResponse({ ok: true, snapshot: invalid })).toBe(false);
        }
        const accessor = Object.defineProperty({ ...snapshot }, "environment", { enumerable: true, get: () => snapshot.environment });
        expect(isDiagnosticsSnapshot(accessor)).toBe(false);
        expect(isGetDiagnosticsSnapshotResponse(Object.assign(Object.create(serializer) as Record<string, unknown>, { ok: true, snapshot }))).toBe(false);
    });

    it("rejects diagnostic responses whose complete journal envelope exceeds five megabytes", () => {
        const event = { category: "mutation", timestamp: 5, hostname: "github.com", pageCategory: "issue", incognito: true, stack: [`frame:${"1".repeat(DIAGNOSTICS_MAX_BYTES)}`] };
        const snapshot = { entries: [event], environment: { browserFamily: "firefox" } };
        expect(new TextEncoder().encode(JSON.stringify({ entries: snapshot.entries })).byteLength).toBeGreaterThan(DIAGNOSTICS_MAX_BYTES);
        expect(isDiagnosticsSnapshot(snapshot)).toBe(false);
        expect(isGetDiagnosticsSnapshotResponse({ ok: true, snapshot })).toBe(false);
    });

    it("accepts only the exact recovery request and typed reset responses", () => {
        expect(isResetAllSettingsMessage({ type: RESET_ALL_SETTINGS_MESSAGE })).toBe(true);
        expect(isResetAllSettingsMessage({ type: RESET_ALL_SETTINGS_MESSAGE, extra: true })).toBe(false);
        const request = Object.create({ type: RESET_ALL_SETTINGS_MESSAGE }) as Record<string, unknown>;
        expect(isResetAllSettingsMessage(request)).toBe(false);
        const sites = { availability: "ready" as const, revision: 4, globalEnabled: true, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }] };
        expect(isResetAllSettingsResponse({ ok: true, acceptedRevision: 4, state: sites })).toBe(true);
        expect(isResetAllSettingsResponse({ ok: false, error: "save-failed", state: sites })).toBe(true);
        const inheritedSuccess = Object.assign(Object.create({ acceptedRevision: 4 }) as Record<string, unknown>, { ok: true, state: sites });
        expect(isResetAllSettingsResponse(inheritedSuccess)).toBe(false);
        const inheritedFailure = Object.assign(Object.create({ error: "save-failed" }) as Record<string, unknown>, { ok: false, state: sites });
        expect(isResetAllSettingsResponse(inheritedFailure)).toBe(false);
        expect(isBackgroundMessage({ type: RESET_ALL_SETTINGS_MESSAGE })).toBe(true);
    });

    it("accepts exact default reset success and both truthful ready/unavailable failure projections", () => {
        const ready = { availability: "ready" as const, revision: 8, globalEnabled: false, sites: [{ hostname: "github.com", enabled: false, hasAdapter: true }, { hostname: "managed.test", enabled: true, hasAdapter: false }] };
        const defaults = { availability: "ready" as const, revision: 0, globalEnabled: true, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }] };
        const unavailable = { availability: "unavailable" as const, revision: null, globalEnabled: null, sites: [], failure: "settings-load" as const };
        expect(isResetAllSettingsResponse({ ok: true, acceptedRevision: 0, state: defaults })).toBe(true);
        expect(isResetAllSettingsResponse({ ok: false, error: "save-failed", state: ready })).toBe(true);
        expect(isResetAllSettingsResponse({ ok: false, error: "save-failed", state: unavailable })).toBe(true);
        expect(isResetAllSettingsResponse({ ok: true, acceptedRevision: 0, state: unavailable })).toBe(false);
        expect(isResetAllSettingsResponse({ ok: false, error: "save-failed", state: ready, replay: true })).toBe(false);
        expect(isResetAllSettingsResponse(Object.assign(Object.create({ state: ready }) as Record<string, unknown>, { ok: false, error: "save-failed" }))).toBe(false);
        expect(isResetAllSettingsResponse(Object.assign(Object.create({ acceptedRevision: 0 }) as Record<string, unknown>, { ok: true, state: defaults }))).toBe(false);
    });

    it("accepts exact display envelopes and rejects inherited/extra fields", () => {
        expect(isSetDisplaySettingsMessage({ type: SET_DISPLAY_SETTINGS_MESSAGE, display: { formatMode: "system", timeZone: { mode: "utc" } } })).toBe(true);
        expect(isSetDisplaySettingsMessage({ type: SET_DISPLAY_SETTINGS_MESSAGE, display: { formatMode: "system", timeZone: { mode: "utc" } }, extra: true })).toBe(false);
        const inherited = Object.create({ display: { formatMode: "system", timeZone: { mode: "utc" } } }) as Record<string, unknown>;
        inherited.type = SET_DISPLAY_SETTINGS_MESSAGE;
        expect(isSetDisplaySettingsMessage(inherited)).toBe(false);
        expect(isBackgroundMessage({ type: GET_DISPLAY_STATE_MESSAGE, extra: true })).toBe(false);
    });

    it("validates ready and unavailable display projections plus strict save responses", () => {
        const ready = { availability: "ready" as const, revision: 3, display: { formatMode: "system" as const, timeZone: { mode: "utc" as const } }, debugEnabled: false };
        const custom = { formatMode: "custom" as const, pattern: "yyyy-MM-dd", timeZone: { mode: "utc" as const } };
        expect(isDisplayState(ready)).toBe(true);
        expect(isDisplayState({ ...ready, extra: true })).toBe(false);
        expect(isDisplayState({ ...ready, error: "unavailable-time-zone" })).toBe(true);
        expect(isDisplayState({ availability: "ready", revision: 3, display: custom, debugEnabled: false })).toBe(true);
        expect(isDisplayState({ availability: "unavailable", revision: null, display: null, failure: "settings-load" })).toBe(true);
        expect(isDisplayState({ availability: "unavailable", revision: null, display: null, failure: "settings-load", extra: true })).toBe(false);
        expect(isSetDisplaySettingsResponse({ ok: false, error: "invalid-time-zone", state: ready })).toBe(true);
        expect(isSetDisplaySettingsResponse({ ok: false, error: "invalid-format", state: { availability: "ready", revision: 3, display: custom, debugEnabled: false } })).toBe(true);
        expect(isSetDisplaySettingsResponse({ ok: true, acceptedRevision: 4, state: ready, refreshFailures: [{ hostname: "github.com", tabId: 3, reason: "tab-update" }] })).toBe(true);
        expect(isSetDisplaySettingsResponse({ ok: true, acceptedRevision: 4, state: ready, refreshFailures: [{ hostname: "github.com", reason: "tab-update", extra: true }] })).toBe(false);

        const inheritedDisplay = Object.assign(
            Object.create({ pattern: "yyyy-MM-dd" }) as Record<string, unknown>,
            { formatMode: "custom", timeZone: { mode: "utc" }, unexpected: true }
        );
        expect(isDisplayState({ availability: "ready", revision: 3, display: inheritedDisplay, debugEnabled: false })).toBe(false);
        expect(isSetDisplaySettingsResponse({ ok: false, error: "invalid-format", state: { availability: "ready", revision: 3, display: inheritedDisplay, debugEnabled: false } })).toBe(false);
        expect(isDisplayState({ availability: "ready", revision: 3, display: { formatMode: "custom", pattern: "YYYY-MM-dd", timeZone: { mode: "utc" } }, debugEnabled: false })).toBe(false);
        expect(isDisplayState({ availability: "ready", revision: 3, display: { formatMode: "system", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } }, debugEnabled: false })).toBe(false);
    });

    it("accepts only exact debug state and toggle envelopes", () => {
        const ready = { availability: "ready" as const, revision: 4, enabled: false };
        const unavailable = { availability: "unavailable" as const, revision: null, enabled: null, failure: "settings-load" as const };
        expect(isGetDebugStateMessage({ type: GET_DEBUG_STATE_MESSAGE })).toBe(true);
        expect(isGetDebugStateMessage({ type: GET_DEBUG_STATE_MESSAGE, extra: true })).toBe(false);
        expect(isSetDebugEnabledMessage({ type: SET_DEBUG_ENABLED_MESSAGE, enabled: true })).toBe(true);
        expect(isSetDebugEnabledMessage({ type: SET_DEBUG_ENABLED_MESSAGE, enabled: "yes" })).toBe(false);
        expect(isDebugState(ready)).toBe(true);
        expect(isDebugState(unavailable)).toBe(true);
        expect(isDebugState({ ...ready, extra: true })).toBe(false);
        expect(isSetDebugEnabledResponse({ ok: true, acceptedRevision: 4, state: ready })).toBe(true);
        expect(isSetDebugEnabledResponse({ ok: true, acceptedRevision: 4, state: ready, extra: true })).toBe(false);
        expect(isSetDebugEnabledResponse({
            ok: true,
            acceptedRevision: 4,
            state: ready,
            refreshFailures: [{ hostname: "github.com", reason: "tab-update", extra: true }]
        })).toBe(false);
        expect(isSetDebugEnabledResponse({ ok: false, error: "save-failed", state: unavailable })).toBe(true);
        expect(isSetDebugEnabledResponse({ ok: true, acceptedRevision: -1, state: ready })).toBe(false);
        expect(isBackgroundMessage({ type: SET_DEBUG_ENABLED_MESSAGE, enabled: true })).toBe(true);
    });

    it("accepts exact structural site envelopes before semantic validation", () => {
        for (const hostname of ["EXAMPLE.TEST", "bücher.example", "example.test:443", "example.test..", "toString"]) {
            const message = { type: SET_SITE_ENABLED_MESSAGE, hostname, enabled: false, surface: "popup" as const };
            expect(isSetSiteEnabledMessage(message)).toBe(true);
            expect(isBackgroundMessage(message)).toBe(true);
        }
    });

    it.each([
        {},
        { type: SET_SITE_ENABLED_MESSAGE, hostname: "example.test", enabled: false },
        { type: SET_SITE_ENABLED_MESSAGE, hostname: "example.test", enabled: false, surface: "popup", extra: true },
        { type: SET_SITE_ENABLED_MESSAGE, hostname: 3, enabled: false, surface: "popup" },
        { type: SET_SITE_ENABLED_MESSAGE, hostname: "example.test", enabled: "false", surface: "popup" },
        { type: SET_SITE_ENABLED_MESSAGE, hostname: "example.test", enabled: false, surface: "options" }
    ])("rejects malformed site envelope %#", (message) => {
        expect(isSetSiteEnabledMessage(message)).toBe(false);
        expect(isBackgroundMessage(message)).toBe(false);
    });

    it("validates the Sites request and complete surface models", () => {
        expect(isGetSitesStateMessage({ type: GET_SITES_STATE_MESSAGE })).toBe(true);
        expect(isGetSitesStateMessage({ type: GET_SITES_STATE_MESSAGE, extra: true })).toBe(false);
        const sites = { availability: "ready" as const, revision: 2, globalEnabled: true, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }] };
        expect(isSitesState(sites)).toBe(true);
        expect(isSitesState({ ...sites, sites: [{ hostname: "github.com", enabled: true, hasAdapter: true, extra: true }] })).toBe(false);
        expect(isPopupState(popup)).toBe(true);
        expect(isPopupState({ ...popup, siteEnabled: undefined })).toBe(false);
        expect(isPopupState({ availability: "unavailable", revision: null, globalEnabled: null, hostname: null, siteEnabled: null, hasAdapter: false, status: "settings-unavailable", failure: "settings-load" })).toBe(true);
    });
});
