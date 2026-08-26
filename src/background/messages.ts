import type { DebugState, DisplayState, PopupState, ResetAllSettingsResponse, SetDebugEnabledResponse, SetDisplaySettingsResponse, SetGlobalEnabledResponse, SetSiteEnabledResponse, SitesState } from "./application";
import type { DiagnosticBrowserFamily, DiagnosticEvent } from "../diagnostics/events";
import { hasOnlyOwnDiagnosticProperties, isDiagnosticJournalEntries } from "../diagnostics/journal";
import { isDisplaySettings } from "../settings/snapshot";

export const GET_POPUP_STATE_MESSAGE = "no-more-ago:get-popup-state" as const;
export const SET_GLOBAL_ENABLED_MESSAGE = "no-more-ago:set-global-enabled" as const;
export const GET_SITES_STATE_MESSAGE = "no-more-ago:get-sites-state" as const;
export const SET_SITE_ENABLED_MESSAGE = "no-more-ago:set-site-enabled" as const;
export const GET_DISPLAY_STATE_MESSAGE = "no-more-ago:get-display-state" as const;
export const SET_DISPLAY_SETTINGS_MESSAGE = "no-more-ago:set-display-settings" as const;
export const RESET_ALL_SETTINGS_MESSAGE = "no-more-ago:reset-all-settings" as const;
export const GET_DEBUG_STATE_MESSAGE = "no-more-ago:get-debug-state" as const;
export const SET_DEBUG_ENABLED_MESSAGE = "no-more-ago:set-debug-enabled" as const;
export const GET_DIAGNOSTICS_SNAPSHOT_MESSAGE = "no-more-ago:get-diagnostics-snapshot" as const;
export const CLEAR_DIAGNOSTICS_MESSAGE = "no-more-ago:clear-diagnostics" as const;

export interface DiagnosticsEnvironment {
    readonly browserFamily: DiagnosticBrowserFamily;
    readonly extensionVersion?: string;
}

export interface DiagnosticsSnapshot {
    readonly entries: readonly DiagnosticEvent[];
    readonly environment: DiagnosticsEnvironment;
}

export type GetDiagnosticsSnapshotResponse =
  | { readonly ok: true; readonly snapshot: DiagnosticsSnapshot }
  | { readonly ok: false; readonly error: "disabled" | "unavailable" | "empty" | "invalid-journal" | "storage-failed" };

export type ClearDiagnosticsResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: "disabled" | "unavailable" | "storage-failed" };

export interface GetPopupStateMessage {
    readonly type: typeof GET_POPUP_STATE_MESSAGE;
}

export interface SetGlobalEnabledMessage {
    readonly type: typeof SET_GLOBAL_ENABLED_MESSAGE;
    readonly enabled: boolean;
}

export interface GetSitesStateMessage {
    readonly type: typeof GET_SITES_STATE_MESSAGE;
}

export interface SetSiteEnabledMessage {
    readonly type: typeof SET_SITE_ENABLED_MESSAGE;
    readonly hostname: string;
    readonly enabled: boolean;
    readonly surface: "popup" | "sites";
}

export interface GetDisplayStateMessage { readonly type: typeof GET_DISPLAY_STATE_MESSAGE; }
export interface SetDisplaySettingsMessage { readonly type: typeof SET_DISPLAY_SETTINGS_MESSAGE; readonly display: unknown; }
export interface ResetAllSettingsMessage { readonly type: typeof RESET_ALL_SETTINGS_MESSAGE; }
export interface GetDebugStateMessage { readonly type: typeof GET_DEBUG_STATE_MESSAGE; }
export interface SetDebugEnabledMessage { readonly type: typeof SET_DEBUG_ENABLED_MESSAGE; readonly enabled: boolean; }
export interface GetDiagnosticsSnapshotMessage { readonly type: typeof GET_DIAGNOSTICS_SNAPSHOT_MESSAGE; }
export interface ClearDiagnosticsMessage { readonly type: typeof CLEAR_DIAGNOSTICS_MESSAGE; }

export type BackgroundMessage = GetPopupStateMessage | SetGlobalEnabledMessage | GetSitesStateMessage | SetSiteEnabledMessage | GetDisplayStateMessage | SetDisplaySettingsMessage | ResetAllSettingsMessage | GetDebugStateMessage | SetDebugEnabledMessage | GetDiagnosticsSnapshotMessage | ClearDiagnosticsMessage;
export type BackgroundResponse = PopupState | SitesState | DisplayState | DebugState | SetGlobalEnabledResponse | SetSiteEnabledResponse | SetDisplaySettingsResponse | ResetAllSettingsResponse | SetDebugEnabledResponse | GetDiagnosticsSnapshotResponse | ClearDiagnosticsResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isGetPopupStateMessage(value: unknown): value is GetPopupStateMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_POPUP_STATE_MESSAGE;
}

export function isSetGlobalEnabledMessage(value: unknown): value is SetGlobalEnabledMessage {
    return isRecord(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "type")
    && Object.hasOwn(value, "enabled")
    && value.type === SET_GLOBAL_ENABLED_MESSAGE
    && typeof value.enabled === "boolean";
}

export function isGetSitesStateMessage(value: unknown): value is GetSitesStateMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_SITES_STATE_MESSAGE;
}

/** Checks the exact envelope only; hostname semantics belong to the writer. */
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

export function isGetDisplayStateMessage(value: unknown): value is GetDisplayStateMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_DISPLAY_STATE_MESSAGE;
}

/** Envelope-only guard; semantic display validation belongs to SettingsService. */
export function isSetDisplaySettingsMessage(value: unknown): value is SetDisplaySettingsMessage {
    return isRecord(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "type")
    && Object.hasOwn(value, "display")
    && value.type === SET_DISPLAY_SETTINGS_MESSAGE;
}

export function isResetAllSettingsMessage(value: unknown): value is ResetAllSettingsMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === RESET_ALL_SETTINGS_MESSAGE;
}

export function isGetDebugStateMessage(value: unknown): value is GetDebugStateMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_DEBUG_STATE_MESSAGE;
}

export function isSetDebugEnabledMessage(value: unknown): value is SetDebugEnabledMessage {
    return isRecord(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "type")
    && Object.hasOwn(value, "enabled")
    && value.type === SET_DEBUG_ENABLED_MESSAGE
    && typeof value.enabled === "boolean";
}

export function isGetDiagnosticsSnapshotMessage(value: unknown): value is GetDiagnosticsSnapshotMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE;
}

export function isClearDiagnosticsMessage(value: unknown): value is ClearDiagnosticsMessage {
    return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "type") && value.type === CLEAR_DIAGNOSTICS_MESSAGE;
}

export function isDiagnosticsSnapshot(value: unknown): value is DiagnosticsSnapshot {
    if (!isRecord(value) || !hasOnlyOwnDiagnosticProperties(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "entries") || !Object.hasOwn(value, "environment") || !isDiagnosticJournalEntries(value.entries) || value.entries.length === 0) return false;
    const environment = value.environment;
    if (!isRecord(environment) || !hasOnlyOwnDiagnosticProperties(environment) || !Object.hasOwn(environment, "browserFamily") || !["chromium", "firefox", "other"].includes(String(environment.browserFamily))) return false;
    if ("extensionVersion" in environment && !Object.hasOwn(environment, "extensionVersion")) return false;
    const count = Object.hasOwn(environment, "extensionVersion") ? 2 : 1;
    if (Object.keys(environment).length !== count) return false;
    return count === 1 || (typeof environment.extensionVersion === "string" && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/u.test(environment.extensionVersion));
}

export function isGetDiagnosticsSnapshotResponse(value: unknown): value is GetDiagnosticsSnapshotResponse {
    if (!isRecord(value) || !hasOnlyOwnDiagnosticProperties(value) || !Object.hasOwn(value, "ok") || Object.keys(value).length !== 2) return false;
    if (value.ok === true) return Object.hasOwn(value, "snapshot") && isDiagnosticsSnapshot(value.snapshot);
    return value.ok === false && Object.hasOwn(value, "error") && ["disabled", "unavailable", "empty", "invalid-journal", "storage-failed"].includes(String(value.error));
}

export function isClearDiagnosticsResponse(value: unknown): value is ClearDiagnosticsResponse {
    if (!isRecord(value) || !hasOnlyOwnDiagnosticProperties(value) || !Object.hasOwn(value, "ok")) return false;
    if (value.ok === true) return Object.keys(value).length === 1;
    return value.ok === false && Object.keys(value).length === 2 && Object.hasOwn(value, "error") && ["disabled", "unavailable", "storage-failed"].includes(String(value.error));
}

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

export function isDisplayState(value: unknown): value is DisplayState {
    if (!isRecord(value)) return false;
    if (!Object.hasOwn(value, "availability")) return false;
    if (value.availability === "unavailable") return Object.keys(value).length === 4
    && Object.hasOwn(value, "revision")
    && Object.hasOwn(value, "display")
    && Object.hasOwn(value, "failure")
    && value.revision === null
    && value.display === null
    && (value.failure === "settings-load" || value.failure === "fail-closed-cleanup");
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

export function isDebugState(value: unknown): value is DebugState {
    if (!isRecord(value) || !Object.hasOwn(value, "availability")) return false;
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

export function isPopupState(value: unknown): value is PopupState {
    if (!isRecord(value)) return false;
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

export function isSitesState(value: unknown): value is SitesState {
    if (!isRecord(value)) return false;
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
    || !Array.isArray(value.sites)) return false;
    return value.sites.every((site) => isRecord(site)
    && Object.keys(site).length === 3
    && typeof site.hostname === "string"
    && typeof site.enabled === "boolean"
    && typeof site.hasAdapter === "boolean");
}

export function isSetGlobalEnabledResponse(value: unknown): value is SetGlobalEnabledResponse {
    if (!isRecord(value) || typeof value.ok !== "boolean" || !isPopupState(value.state)) return false;
    if (value.ok) return Object.keys(value).length === 3 && typeof value.acceptedRevision === "number" && Number.isSafeInteger(value.acceptedRevision) && value.acceptedRevision >= 0;
    if (Object.keys(value).length !== 3) return false;
    return value.error === "save-failed" || value.error === "settings-unavailable";
}

export function isSetSiteEnabledResponse(value: unknown): value is SetSiteEnabledResponse {
    if (!isRecord(value) || typeof value.ok !== "boolean") return false;
    if (value.surface === "popup") {
        if (!isPopupState(value.state)) return false;
    } else if (value.surface === "sites") {
        if (!isSitesState(value.state)) return false;
    } else return false;
    if (value.ok) {
        return Object.keys(value).length === 4
      && typeof value.acceptedRevision === "number"
      && Number.isSafeInteger(value.acceptedRevision)
      && value.acceptedRevision >= 0;
    }
    if (Object.keys(value).length !== 4) return false;
    return value.error === "save-failed" || value.error === "invalid-hostname" || value.error === "settings-unavailable";
}

export function isSetDisplaySettingsResponse(value: unknown): value is SetDisplaySettingsResponse {
    if (!isRecord(value) || !Object.hasOwn(value, "ok") || !Object.hasOwn(value, "state") || typeof value.ok !== "boolean" || !isDisplayState(value.state)) return false;
    if (!value.ok) return Object.keys(value).length === 3
    && Object.hasOwn(value, "error")
    && (value.error === "invalid-format" || value.error === "invalid-time-zone" || value.error === "invalid-display-settings" || value.error === "save-failed" || value.error === "settings-unavailable");
    if (Object.keys(value).length !== 4 || !Object.hasOwn(value, "acceptedRevision") || !Object.hasOwn(value, "refreshFailures") || typeof value.acceptedRevision !== "number" || !Number.isSafeInteger(value.acceptedRevision) || value.acceptedRevision < 0 || !Array.isArray(value.refreshFailures)) return false;
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

export function isResetAllSettingsResponse(value: unknown): value is ResetAllSettingsResponse {
    if (!isRecord(value) || !Object.hasOwn(value, "ok") || typeof value.ok !== "boolean" || !Object.hasOwn(value, "state")) return false;
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

export function isSetDebugEnabledResponse(value: unknown): value is SetDebugEnabledResponse {
    if (!isRecord(value) || !Object.hasOwn(value, "ok") || !Object.hasOwn(value, "state") || typeof value.ok !== "boolean" || !isDebugState(value.state)) return false;
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
