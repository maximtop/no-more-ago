/**
 * @file Background runtime message contracts and structural guards.
 */

import type { DebugState, DisplayState, PopupState, ResetAllSettingsResponse, SetDebugEnabledResponse, SetDisplaySettingsResponse, SetGlobalEnabledResponse, SetSiteEnabledResponse, SitesState } from "./application";
import type { DiagnosticBrowserFamily, DiagnosticEvent } from "../diagnostics/events";
import { hasOnlyOwnDiagnosticProperties, isDiagnosticJournalEntries } from "../diagnostics/journal";
import { isDisplaySettings } from "../settings/snapshot";

/**
 * Requests popup state for the active tab.
 */
export const GET_POPUP_STATE_MESSAGE = "no-more-ago:get-popup-state" as const;

/**
 * Changes the global activation setting.
 */
export const SET_GLOBAL_ENABLED_MESSAGE = "no-more-ago:set-global-enabled" as const;

/**
 * Requests the site-preferences list.
 */
export const GET_SITES_STATE_MESSAGE = "no-more-ago:get-sites-state" as const;

/**
 * Changes a single site's activation setting.
 */
export const SET_SITE_ENABLED_MESSAGE = "no-more-ago:set-site-enabled" as const;

/**
 * Requests the current display configuration.
 */
export const GET_DISPLAY_STATE_MESSAGE = "no-more-ago:get-display-state" as const;

/**
 * Changes the display configuration.
 */
export const SET_DISPLAY_SETTINGS_MESSAGE = "no-more-ago:set-display-settings" as const;

/**
 * Restores every setting to its default.
 */
export const RESET_ALL_SETTINGS_MESSAGE = "no-more-ago:reset-all-settings" as const;

/**
 * Requests the diagnostic logging state.
 */
export const GET_DEBUG_STATE_MESSAGE = "no-more-ago:get-debug-state" as const;

/**
 * Changes the diagnostic logging setting.
 */
export const SET_DEBUG_ENABLED_MESSAGE = "no-more-ago:set-debug-enabled" as const;

/**
 * Requests the persisted diagnostic-event snapshot.
 */
export const GET_DIAGNOSTICS_SNAPSHOT_MESSAGE = "no-more-ago:get-diagnostics-snapshot" as const;

/**
 * Clears persisted diagnostic events.
 */
export const CLEAR_DIAGNOSTICS_MESSAGE = "no-more-ago:clear-diagnostics" as const;

/**
 * Trusted environment metadata included with a diagnostics snapshot.
 */
export interface DiagnosticsEnvironment {
    /**
     * Browser family that produced the snapshot.
     */
    readonly browserFamily: DiagnosticBrowserFamily;

    /**
     * Extension version that produced the snapshot, when known.
     */
    readonly extensionVersion?: string;
}

/**
 * Persisted diagnostic events and their trusted environment metadata.
 */
export interface DiagnosticsSnapshot {
    /**
     * Persisted diagnostic entries.
     */
    readonly entries: readonly DiagnosticEvent[];

    /**
     * Browser metadata captured with diagnostics.
     */
    readonly environment: DiagnosticsEnvironment;
}

/**
 * Result of requesting persisted diagnostic events.
 */
export type GetDiagnosticsSnapshotResponse =
  | { readonly ok: true; readonly snapshot: DiagnosticsSnapshot }
  | { readonly ok: false; readonly error: "disabled" | "unavailable" | "empty" | "invalid-journal" | "storage-failed" };

/**
 * Result of clearing persisted diagnostic events.
 */
export type ClearDiagnosticsResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: "disabled" | "unavailable" | "storage-failed" };

/**
 * Request for the active-tab popup state.
 */
export interface GetPopupStateMessage {
    /**
     * Discriminator for the get-popup-state operation.
     */
    readonly type: typeof GET_POPUP_STATE_MESSAGE;
}

/**
 * Request to change global activation.
 */
export interface SetGlobalEnabledMessage {
    /**
     * Discriminator for the set-global-enabled operation.
     */
    readonly type: typeof SET_GLOBAL_ENABLED_MESSAGE;

    /**
     * Whether activation should be enabled globally.
     */
    readonly enabled: boolean;
}

/**
 * Request for the site-preferences state.
 */
export interface GetSitesStateMessage {
    /**
     * Discriminator for the get-sites-state operation.
     */
    readonly type: typeof GET_SITES_STATE_MESSAGE;
}

/**
 * Request to change activation for one hostname.
 */
export interface SetSiteEnabledMessage {
    /**
     * Discriminator for the set-site-enabled operation.
     */
    readonly type: typeof SET_SITE_ENABLED_MESSAGE;

    /**
     * Hostname whose activation setting should change.
     */
    readonly hostname: string;

    /**
     * Whether timestamp rendering should be enabled for the hostname.
     */
    readonly enabled: boolean;

    /**
     * UI surface that determines the response-state shape.
     */
    readonly surface: "popup" | "sites";
}

/**
 * Request for the current display configuration.
 */
export interface GetDisplayStateMessage {
    /**
     * Discriminator for the get-display-state operation.
     */
    readonly type: typeof GET_DISPLAY_STATE_MESSAGE;
}

/**
 * Request to replace the display configuration.
 */
export interface SetDisplaySettingsMessage {
    /**
     * Discriminator for the set-display-settings operation.
     */
    readonly type: typeof SET_DISPLAY_SETTINGS_MESSAGE;

    /**
     * Untrusted display-settings payload to validate and persist.
     */
    readonly display: unknown;
}

/**
 * Request to restore all settings to their defaults.
 */
export interface ResetAllSettingsMessage {
    /**
     * Discriminator for the reset-all-settings operation.
     */
    readonly type: typeof RESET_ALL_SETTINGS_MESSAGE;
}

/**
 * Request for the diagnostic logging state.
 */
export interface GetDebugStateMessage {
    /**
     * Discriminator for the get-debug-state operation.
     */
    readonly type: typeof GET_DEBUG_STATE_MESSAGE;
}

/**
 * Request to change diagnostic logging.
 */
export interface SetDebugEnabledMessage {
    /**
     * Discriminator for the set-debug-enabled operation.
     */
    readonly type: typeof SET_DEBUG_ENABLED_MESSAGE;

    /**
     * Whether diagnostic logging should be enabled.
     */
    readonly enabled: boolean;
}

/**
 * Request for the persisted diagnostic-event snapshot.
 */
export interface GetDiagnosticsSnapshotMessage {
    /**
     * Discriminator for the get-diagnostics-snapshot operation.
     */
    readonly type: typeof GET_DIAGNOSTICS_SNAPSHOT_MESSAGE;
}

/**
 * Request to clear persisted diagnostic events.
 */
export interface ClearDiagnosticsMessage {
    /**
     * Discriminator for the clear-diagnostics operation.
     */
    readonly type: typeof CLEAR_DIAGNOSTICS_MESSAGE;
}

/**
 * Every request accepted by the background runtime message listener.
 */
export type BackgroundMessage = GetPopupStateMessage | SetGlobalEnabledMessage | GetSitesStateMessage | SetSiteEnabledMessage | GetDisplayStateMessage | SetDisplaySettingsMessage | ResetAllSettingsMessage | GetDebugStateMessage | SetDebugEnabledMessage | GetDiagnosticsSnapshotMessage | ClearDiagnosticsMessage;

/**
 * Every response returned by the background runtime message listener.
 */
export type BackgroundResponse = PopupState | SitesState | DisplayState | DebugState | SetGlobalEnabledResponse | SetSiteEnabledResponse | SetDisplaySettingsResponse | ResetAllSettingsResponse | SetDebugEnabledResponse | GetDiagnosticsSnapshotResponse | ClearDiagnosticsResponse;

/**
 * Recognizes a non-array object suitable for message-shape validation.
 *
 * @param value - Untrusted background message value.
 * @returns - Whether the value is a non-array object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recognizes the exact get-popup-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact popup-state request.
 */
export function isGetPopupStateMessage(value: unknown): value is GetPopupStateMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_POPUP_STATE_MESSAGE;
}

/**
 * Recognizes a set-global-enabled request with a boolean enabled flag.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid global-activation update request.
 */
export function isSetGlobalEnabledMessage(value: unknown): value is SetGlobalEnabledMessage {
    return isRecord(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "type")
    && Object.hasOwn(value, "enabled")
    && value.type === SET_GLOBAL_ENABLED_MESSAGE
    && typeof value.enabled === "boolean";
}

/**
 * Recognizes the exact get-sites-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact sites-state request.
 */
export function isGetSitesStateMessage(value: unknown): value is GetSitesStateMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_SITES_STATE_MESSAGE;
}

/**
 * Recognizes a set-site-enabled request with hostname, boolean flag, and response surface.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid site-activation update request.
 */
export function isSetSiteEnabledMessage(value: unknown): value is SetSiteEnabledMessage {
    return isRecord(value)
    && Object.keys(value).length === 4
    && Object.hasOwn(value, "type")
    && Object.hasOwn(value, "hostname")
    && Object.hasOwn(value, "enabled")
    && Object.hasOwn(value, "surface")
    && value.type === SET_SITE_ENABLED_MESSAGE
    && typeof value.hostname === "string"
    && typeof value.enabled === "boolean"
    && (value.surface === "popup" || value.surface === "sites");
}

/**
 * Recognizes the exact get-display-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact display-state request.
 */
export function isGetDisplayStateMessage(value: unknown): value is GetDisplayStateMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_DISPLAY_STATE_MESSAGE;
}

/**
 * Recognizes a set-display-settings request with an arbitrary display payload.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid display-settings update request.
 */
export function isSetDisplaySettingsMessage(value: unknown): value is SetDisplaySettingsMessage {
    return isRecord(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "type")
    && Object.hasOwn(value, "display")
    && value.type === SET_DISPLAY_SETTINGS_MESSAGE;
}

/**
 * Recognizes the exact reset-all-settings request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact reset-all-settings request.
 */
export function isResetAllSettingsMessage(value: unknown): value is ResetAllSettingsMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === RESET_ALL_SETTINGS_MESSAGE;
}

/**
 * Recognizes the exact get-debug-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact diagnostic-state request.
 */
export function isGetDebugStateMessage(value: unknown): value is GetDebugStateMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_DEBUG_STATE_MESSAGE;
}

/**
 * Recognizes a set-debug-enabled request with a boolean enabled flag.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid diagnostic-policy update request.
 */
export function isSetDebugEnabledMessage(value: unknown): value is SetDebugEnabledMessage {
    return isRecord(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "type")
    && Object.hasOwn(value, "enabled")
    && value.type === SET_DEBUG_ENABLED_MESSAGE
    && typeof value.enabled === "boolean";
}

/**
 * Recognizes the exact get-diagnostics-snapshot request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact diagnostics-snapshot request.
 */
export function isGetDiagnosticsSnapshotMessage(value: unknown): value is GetDiagnosticsSnapshotMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE;
}

/**
 * Recognizes the exact clear-diagnostics request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact clear-diagnostics request.
 */
export function isClearDiagnosticsMessage(value: unknown): value is ClearDiagnosticsMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === CLEAR_DIAGNOSTICS_MESSAGE;
}

/**
 * Recognizes a non-empty diagnostics snapshot with trusted environment metadata.
 *
 * @param value - Untrusted diagnostics snapshot.
 * @returns - Whether the value is a non-empty snapshot with trusted metadata.
 */
export function isDiagnosticsSnapshot(value: unknown): value is DiagnosticsSnapshot {
    if (!isRecord(value) || !hasOnlyOwnDiagnosticProperties(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "entries") || !Object.hasOwn(value, "environment") || !isDiagnosticJournalEntries(value.entries) || value.entries.length === 0) {
        return false;
    }
    const environment = value.environment;
    if (!isRecord(environment) || !hasOnlyOwnDiagnosticProperties(environment) || !Object.hasOwn(environment, "browserFamily") || !["chromium", "firefox", "other"].includes(String(environment.browserFamily))) {
        return false;
    }
    if ("extensionVersion" in environment && !Object.hasOwn(environment, "extensionVersion")) {
        return false;
    }
    const count = Object.hasOwn(environment, "extensionVersion") ? 2 : 1;
    if (Object.keys(environment).length !== count) {
        return false;
    }
    return count === 1 || (typeof environment.extensionVersion === "string" && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(environment.extensionVersion));
}

/**
 * Recognizes a successful diagnostics snapshot or its documented error response.
 *
 * @param value - Untrusted diagnostics-snapshot response.
 * @returns - Whether the value is a documented success or error response.
 */
export function isGetDiagnosticsSnapshotResponse(value: unknown): value is GetDiagnosticsSnapshotResponse {
    if (!isRecord(value) || !hasOnlyOwnDiagnosticProperties(value) || !Object.hasOwn(value, "ok") || Object.keys(value).length !== 2) {
        return false;
    }
    if (value.ok === true) {
        return Object.hasOwn(value, "snapshot") && isDiagnosticsSnapshot(value.snapshot);
    }
    return value.ok === false && Object.hasOwn(value, "error") && ["disabled", "unavailable", "empty", "invalid-journal", "storage-failed"].includes(String(value.error));
}

/**
 * Recognizes a successful diagnostics clear result or its documented error response.
 *
 * @param value - Untrusted clear-diagnostics response.
 * @returns - Whether the value is a documented success or error response.
 */
export function isClearDiagnosticsResponse(value: unknown): value is ClearDiagnosticsResponse {
    if (!isRecord(value) || !hasOnlyOwnDiagnosticProperties(value) || !Object.hasOwn(value, "ok")) {
        return false;
    }
    if (value.ok === true) {
        return Object.keys(value).length === 1;
    }
    return value.ok === false && Object.keys(value).length === 2 && Object.hasOwn(value, "error") && ["disabled", "unavailable", "storage-failed"].includes(String(value.error));
}

/**
 * Recognizes any request accepted by the background message listener.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value matches any accepted background request.
 */
export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
    return isGetPopupStateMessage(value)
    || isSetGlobalEnabledMessage(value)
    || isGetSitesStateMessage(value)
    || isSetSiteEnabledMessage(value)
    || isGetDisplayStateMessage(value)
    || isSetDisplaySettingsMessage(value)
    || isResetAllSettingsMessage(value)
    || isGetDebugStateMessage(value)
    || isSetDebugEnabledMessage(value)
    || isGetDiagnosticsSnapshotMessage(value)
    || isClearDiagnosticsMessage(value);
}

/**
 * Recognizes ready or unavailable display state, including optional time-zone errors.
 *
 * @param value - Untrusted display-state response.
 * @returns - Whether the value is a complete ready or unavailable display state.
 */
export function isDisplayState(value: unknown): value is DisplayState {
    if (!isRecord(value)) {
        return false;
    }
    if (!Object.hasOwn(value, "availability")) {
        return false;
    }
    if (value.availability === "unavailable") {
        return Object.keys(value).length === 4
    && Object.hasOwn(value, "revision")
    && Object.hasOwn(value, "display")
    && Object.hasOwn(value, "failure")
    && value.revision === null
    && value.display === null
    && (value.failure === "settings-load" || value.failure === "fail-closed-cleanup");
    }
    return value.availability === "ready"
    && (Object.keys(value).length === 4 || Object.keys(value).length === 5)
    && Object.keys(value).every((key) => key === "availability" || key === "revision" || key === "display" || key === "debugEnabled" || key === "error")
    && Object.hasOwn(value, "revision")
    && Object.hasOwn(value, "display")
    && Object.hasOwn(value, "debugEnabled")
    && typeof value.revision === "number"
    && Number.isSafeInteger(value.revision)
    && value.revision >= 0
    && isDisplaySettings(value.display)
    && typeof value.debugEnabled === "boolean"
    && (!Object.hasOwn(value, "error") || value.error === "unavailable-time-zone");
}

/**
 * Recognizes ready or unavailable diagnostic logging state.
 *
 * @param value - Untrusted diagnostic-state response.
 * @returns - Whether the value is a complete ready or unavailable diagnostic state.
 */
export function isDebugState(value: unknown): value is DebugState {
    if (!isRecord(value) || !Object.hasOwn(value, "availability")) {
        return false;
    }
    if (value.availability === "unavailable") {
        return Object.keys(value).length === 4
      && Object.hasOwn(value, "revision")
      && Object.hasOwn(value, "enabled")
      && Object.hasOwn(value, "failure")
      && value.revision === null
      && value.enabled === null
      && (value.failure === "settings-load" || value.failure === "fail-closed-cleanup");
    }
    return value.availability === "ready"
    && Object.keys(value).length === 3
    && Object.hasOwn(value, "revision")
    && Object.hasOwn(value, "enabled")
    && typeof value.revision === "number"
    && Number.isSafeInteger(value.revision)
    && value.revision >= 0
    && typeof value.enabled === "boolean";
}

/**
 * Recognizes ready or unavailable popup state with its valid status and failure combinations.
 *
 * @param value - Untrusted popup-state response.
 * @returns - Whether the value is a complete valid popup state.
 */
export function isPopupState(value: unknown): value is PopupState {
    if (!isRecord(value)) {
        return false;
    }
    if (value.availability === "unavailable") {
        const keys = Object.keys(value);
        return (keys.length === 8)
      && value.revision === null && value.globalEnabled === null
      && (value.hostname === null || typeof value.hostname === "string")
      && value.siteEnabled === null
      && value.hasAdapter === false
      && (value.status === "settings-unavailable" || value.status === "runtime-failed")
      && (value.failure === "settings-load" || value.failure === "fail-closed-cleanup");
    }
    const keys = Object.keys(value);
    return (keys.length === 7 || keys.length === 8)
    && value.availability === "ready"
    && typeof value.revision === "number"
    && Number.isSafeInteger(value.revision)
    && value.revision >= 0
    && typeof value.globalEnabled === "boolean"
    && (value.hostname === null || typeof value.hostname === "string")
    && (typeof value.siteEnabled === "boolean" || value.siteEnabled === null)
    && typeof value.hasAdapter === "boolean"
    && ["active", "global-disabled", "site-disabled", "inaccessible", "runtime-failed", "no-rules"].includes(String(value.status))
    && (value.failure === undefined || (typeof value.failure === "string" && ["current-tab-query", "registration", "matching-tabs-query", "current-tab-inject", "current-tab-teardown", "document-status"].includes(value.failure)));
}

/**
 * Recognizes ready or unavailable site-preferences state.
 *
 * @param value - Untrusted sites-state response.
 * @returns - Whether the value is a complete valid sites state.
 */
export function isSitesState(value: unknown): value is SitesState {
    if (!isRecord(value)) {
        return false;
    }
    if (value.availability === "unavailable") {
        return Object.keys(value).length === 5
      && value.revision === null
      && value.globalEnabled === null
      && Array.isArray(value.sites)
      && value.sites.length === 0
      && (value.failure === "settings-load" || value.failure === "fail-closed-cleanup");
    }
    if (value.availability !== "ready"
    || Object.keys(value).length !== 4
    || typeof value.revision !== "number"
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
    || typeof value.globalEnabled !== "boolean"
    || !Array.isArray(value.sites)) {
        return false;
    }
    return value.sites.every((site) => isRecord(site)
    && Object.keys(site).length === 3
    && typeof site.hostname === "string"
    && typeof site.enabled === "boolean"
    && typeof site.hasAdapter === "boolean");
}

/**
 * Recognizes a global-activation update result and its popup state.
 *
 * @param value - Untrusted global-activation response.
 * @returns - Whether the value contains a valid update result and popup state.
 */
export function isSetGlobalEnabledResponse(value: unknown): value is SetGlobalEnabledResponse {
    if (!isRecord(value) || typeof value.ok !== "boolean" || !isPopupState(value.state)) {
        return false;
    }
    if (value.ok) {
        return Object.keys(value).length === 3 && typeof value.acceptedRevision === "number" && Number.isSafeInteger(value.acceptedRevision) && value.acceptedRevision >= 0;
    }
    if (Object.keys(value).length !== 3) {
        return false;
    }
    return value.error === "save-failed" || value.error === "settings-unavailable";
}

/**
 * Recognizes a site-activation update result and its surface-specific state.
 *
 * @param value - Untrusted site-activation response.
 * @returns - Whether the value contains a valid surface-specific update result.
 */
export function isSetSiteEnabledResponse(value: unknown): value is SetSiteEnabledResponse {
    if (!isRecord(value) || typeof value.ok !== "boolean") {
        return false;
    }
    if (value.surface === "popup") {
        if (!isPopupState(value.state)) {
            return false;
        }
    } else if (value.surface === "sites") {
        if (!isSitesState(value.state)) {
            return false;
        }
    } else {
        return false;
    }
    if (value.ok) {
        return Object.keys(value).length === 4
      && typeof value.acceptedRevision === "number"
      && Number.isSafeInteger(value.acceptedRevision)
      && value.acceptedRevision >= 0;
    }
    if (Object.keys(value).length !== 4) {
        return false;
    }
    return value.error === "save-failed" || value.error === "invalid-hostname" || value.error === "settings-unavailable";
}

/**
 * Recognizes a display-settings update result and any tab refresh failures.
 *
 * @param value - Untrusted display-settings response.
 * @returns - Whether the value contains a valid update result and refresh failures.
 */
export function isSetDisplaySettingsResponse(value: unknown): value is SetDisplaySettingsResponse {
    if (!isRecord(value) || !Object.hasOwn(value, "ok") || !Object.hasOwn(value, "state") || typeof value.ok !== "boolean" || !isDisplayState(value.state)) {
        return false;
    }
    if (!value.ok) {
        return Object.keys(value).length === 3
    && Object.hasOwn(value, "error")
    && (value.error === "invalid-format" || value.error === "invalid-time-zone" || value.error === "invalid-display-settings" || value.error === "save-failed" || value.error === "settings-unavailable");
    }
    if (Object.keys(value).length !== 4 || !Object.hasOwn(value, "acceptedRevision") || !Object.hasOwn(value, "refreshFailures") || typeof value.acceptedRevision !== "number" || !Number.isSafeInteger(value.acceptedRevision) || value.acceptedRevision < 0 || !Array.isArray(value.refreshFailures)) {
        return false;
    }
    return value.refreshFailures.every((failure) => isRecord(failure)
    && (Object.keys(failure).length === 2 || Object.keys(failure).length === 3)
    && Object.hasOwn(failure, "hostname")
    && Object.hasOwn(failure, "reason")
    && Object.keys(failure).every((key) => key === "hostname" || key === "tabId" || key === "reason")
    && (Object.keys(failure).length !== 3 || Object.hasOwn(failure, "tabId"))
    && typeof failure.hostname === "string"
    && (failure.tabId === undefined || (typeof failure.tabId === "number" && Number.isSafeInteger(failure.tabId) && failure.tabId >= 0))
    && (failure.reason === "matching-tabs-query" || failure.reason === "tab-update"));
}

/**
 * Recognizes a reset-all-settings result and its site-preferences state.
 *
 * @param value - Untrusted reset-all-settings response.
 * @returns - Whether the value contains a valid reset result and sites state.
 */
export function isResetAllSettingsResponse(value: unknown): value is ResetAllSettingsResponse {
    if (!isRecord(value) || !Object.hasOwn(value, "ok") || typeof value.ok !== "boolean" || !Object.hasOwn(value, "state")) {
        return false;
    }
    if (value.ok) {
        return Object.keys(value).length === 3
      && Object.hasOwn(value, "acceptedRevision")
      && typeof value.acceptedRevision === "number"
      && Number.isSafeInteger(value.acceptedRevision)
      && value.acceptedRevision >= 0
      && isSitesState(value.state)
      && value.state.availability === "ready";
    }
    return Object.keys(value).length === 3
    && Object.hasOwn(value, "error")
    && (value.error === "save-failed" || value.error === "settings-unavailable")
    && isSitesState(value.state);
}

/**
 * Recognizes a diagnostic-logging update result and any tab refresh failures.
 *
 * @param value - Untrusted diagnostic-policy response.
 * @returns - Whether the value contains a valid update result and refresh failures.
 */
export function isSetDebugEnabledResponse(value: unknown): value is SetDebugEnabledResponse {
    if (!isRecord(value) || !Object.hasOwn(value, "ok") || !Object.hasOwn(value, "state") || typeof value.ok !== "boolean" || !isDebugState(value.state)) {
        return false;
    }
    if (value.ok) {
        return (Object.keys(value).length === 3 || Object.keys(value).length === 4)
      && Object.keys(value).every((key) => key === "ok" || key === "acceptedRevision" || key === "state" || key === "refreshFailures")
      && Object.hasOwn(value, "acceptedRevision")
      && typeof value.acceptedRevision === "number"
      && Number.isSafeInteger(value.acceptedRevision)
      && value.acceptedRevision >= 0
      && (!Object.hasOwn(value, "refreshFailures") || (Array.isArray(value.refreshFailures)
        && value.refreshFailures.every((failure) => isRecord(failure)
          && (Object.keys(failure).length === 2 || Object.keys(failure).length === 3)
          && Object.keys(failure).every((key) => key === "hostname" || key === "reason" || key === "tabId")
          && Object.hasOwn(failure, "hostname")
          && Object.hasOwn(failure, "reason")
          && (Object.keys(failure).length !== 3 || Object.hasOwn(failure, "tabId"))
          && typeof failure.hostname === "string"
          && (failure.tabId === undefined || (typeof failure.tabId === "number" && Number.isSafeInteger(failure.tabId) && failure.tabId >= 0))
          && (failure.reason === "matching-tabs-query" || failure.reason === "tab-update"))));
    }
    return Object.keys(value).length === 3
    && Object.hasOwn(value, "error")
    && (value.error === "save-failed" || value.error === "settings-unavailable");
}
