/**
 * @file Background runtime message and response contracts.
 */

import type { DiagnosticBrowserFamily, DiagnosticEvent } from "../diagnostics/events";
import type {
    DebugState,
    DisplayState,
    PopupState,
    ResetAllSettingsResponse,
    SetDebugEnabledResponse,
    SetDisplaySettingsResponse,
    SetGlobalEnabledResponse,
    SetSiteEnabledResponse,
    SitesState,
} from "./view-state";

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
 * Errors returned when a diagnostic snapshot cannot be read safely.
 */
export const DIAGNOSTICS_SNAPSHOT_ERRORS = [
    "disabled",
    "unavailable",
    "empty",
    "invalid-journal",
    "storage-failed",
] as const;

/**
 * Error returned when a diagnostic snapshot cannot be read safely.
 */
export type DiagnosticsSnapshotError = (typeof DIAGNOSTICS_SNAPSHOT_ERRORS)[number];

/**
 * Errors returned when diagnostic entries cannot be cleared safely.
 */
export const DIAGNOSTICS_CLEAR_ERRORS = [
    "disabled",
    "unavailable",
    "storage-failed",
] as const;

/**
 * Error returned when diagnostic entries cannot be cleared safely.
 */
export type DiagnosticsClearError = (typeof DIAGNOSTICS_CLEAR_ERRORS)[number];

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
    | {
        readonly ok: false;
        readonly error: DiagnosticsSnapshotError;
    };

/**
 * Result of clearing persisted diagnostic events.
 */
export type ClearDiagnosticsResponse =
    | { readonly ok: true }
    | { readonly ok: false; readonly error: DiagnosticsClearError };

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
export type BackgroundMessage =
    | GetPopupStateMessage
    | SetGlobalEnabledMessage
    | GetSitesStateMessage
    | SetSiteEnabledMessage
    | GetDisplayStateMessage
    | SetDisplaySettingsMessage
    | ResetAllSettingsMessage
    | GetDebugStateMessage
    | SetDebugEnabledMessage
    | GetDiagnosticsSnapshotMessage
    | ClearDiagnosticsMessage;

/**
 * Every response returned by the background runtime message listener.
 */
export type BackgroundResponse =
    | PopupState
    | SitesState
    | DisplayState
    | DebugState
    | SetGlobalEnabledResponse
    | SetSiteEnabledResponse
    | SetDisplaySettingsResponse
    | ResetAllSettingsResponse
    | SetDebugEnabledResponse
    | GetDiagnosticsSnapshotResponse
    | ClearDiagnosticsResponse;
