/**
 * @file Background request and diagnostic response contracts.
 */

import type { DiagnosticBrowserFamily, DiagnosticEvent } from "../diagnostics/events";
import type { DisplaySettings } from "../settings/snapshot";
import type { SiteSettingsSurface } from "./view-state-values";

/**
 * Requests popup state for the active tab.
 */
export const GET_POPUP_STATE_MESSAGE = "no-more-ago:get-popup-state" as const;

/**
 * Requests the current document runtime state.
 */
export const GET_DOCUMENT_STATE_MESSAGE = "no-more-ago:get-document-state" as const;

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
 * Errors returned when a diagnostic snapshot cannot be read.
 */
export const DIAGNOSTICS_SNAPSHOT_ERRORS = [
    "disabled",
    "unavailable",
    "empty",
    "storage-failed",
] as const;

/**
 * Errors returned when diagnostic entries cannot be cleared.
 */
export const DIAGNOSTICS_CLEAR_ERRORS = [
    "disabled",
    "unavailable",
    "storage-failed",
] as const;

/**
 * Request for popup state.
 */
interface GetPopupStateMessage {
    /**
     * Popup-state request discriminant.
     */
    readonly type: typeof GET_POPUP_STATE_MESSAGE;
}

/**
 * Request for document runtime state.
 */
interface GetDocumentStateMessage {
    /**
     * Document-state request discriminant.
     */
    readonly type: typeof GET_DOCUMENT_STATE_MESSAGE;
}

/**
 * Request for a global activation change.
 */
interface SetGlobalEnabledMessage {
    /**
     * Global activation discriminant.
     */
    readonly type: typeof SET_GLOBAL_ENABLED_MESSAGE;

    /**
     * Requested global activation setting.
     */
    readonly enabled: boolean;
}

/**
 * Request for site-preferences state.
 */
interface GetSitesStateMessage {
    /**
     * Sites-state request discriminant.
     */
    readonly type: typeof GET_SITES_STATE_MESSAGE;
}

/**
 * Request for a site activation change.
 */
interface SetSiteEnabledMessage {
    /**
     * Site activation discriminant.
     */
    readonly type: typeof SET_SITE_ENABLED_MESSAGE;

    /**
     * Exact hostname whose setting changes.
     */
    readonly hostname: string;

    /**
     * Requested per-site activation setting.
     */
    readonly enabled: boolean;

    /**
     * UI surface whose projection the response must carry.
     */
    readonly surface: SiteSettingsSurface;
}

/**
 * Request for display state.
 */
interface GetDisplayStateMessage {
    /**
     * Display-state request discriminant.
     */
    readonly type: typeof GET_DISPLAY_STATE_MESSAGE;
}

/**
 * Request for a display-settings change.
 */
interface SetDisplaySettingsMessage {
    /**
     * Display-settings discriminant.
     */
    readonly type: typeof SET_DISPLAY_SETTINGS_MESSAGE;

    /**
     * Display settings the options page asks to persist.
     */
    readonly display: DisplaySettings;
}

/**
 * Request to reset all settings.
 */
interface ResetAllSettingsMessage {
    /**
     * Reset discriminant.
     */
    readonly type: typeof RESET_ALL_SETTINGS_MESSAGE;
}

/**
 * Request for diagnostic logging state.
 */
interface GetDebugStateMessage {
    /**
     * Diagnostic-state request discriminant.
     */
    readonly type: typeof GET_DEBUG_STATE_MESSAGE;
}

/**
 * Request for a diagnostic logging change.
 */
interface SetDebugEnabledMessage {
    /**
     * Diagnostic logging discriminant.
     */
    readonly type: typeof SET_DEBUG_ENABLED_MESSAGE;

    /**
     * Requested diagnostic logging setting.
     */
    readonly enabled: boolean;
}

/**
 * Request for stored diagnostics.
 */
interface GetDiagnosticsSnapshotMessage {
    /**
     * Diagnostic snapshot discriminant.
     */
    readonly type: typeof GET_DIAGNOSTICS_SNAPSHOT_MESSAGE;
}

/**
 * Request to clear stored diagnostics.
 */
interface ClearDiagnosticsMessage {
    /**
     * Diagnostic clear discriminant.
     */
    readonly type: typeof CLEAR_DIAGNOSTICS_MESSAGE;
}

/**
 * Every request accepted by the background runtime listener.
 */
export type BackgroundMessage =
    | GetPopupStateMessage
    | GetDocumentStateMessage
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
 * Trusted browser and extension metadata attached to an exported archive.
 */
export interface DiagnosticsEnvironment {
    /**
     * Coarse browser family recorded by the background context.
     */
    readonly browserFamily: DiagnosticBrowserFamily;

    /**
     * Extension version recorded by the background context.
     */
    readonly extensionVersion?: string;
}

/**
 * Diagnostic snapshot returned to the options page.
 */
export interface DiagnosticsSnapshot {
    /**
     * Persisted diagnostic events, oldest first.
     */
    readonly entries: readonly DiagnosticEvent[];

    /**
     * Trusted metadata describing where the entries were collected.
     */
    readonly environment: DiagnosticsEnvironment;
}

/**
 * Result of reading stored diagnostics.
 */
export type GetDiagnosticsSnapshotResponse =
    | {
        /**
         * Marks a readable diagnostic snapshot.
         */
        readonly ok: true;

        /**
         * Persisted diagnostics ready for export.
         */
        readonly snapshot: DiagnosticsSnapshot;
    }
    | {
        /**
         * Marks diagnostics that could not be read.
         */
        readonly ok: false;

        /**
         * Reason the snapshot could not be read.
         */
        readonly error: DiagnosticsSnapshotError;
    };

/**
 * Result of clearing stored diagnostics.
 */
export type ClearDiagnosticsResponse =
    | {
        /**
         * Marks a successful clear.
         */
        readonly ok: true;
    }
    | {
        /**
         * Marks diagnostics that could not be cleared.
         */
        readonly ok: false;

        /**
         * Reason the entries could not be cleared.
         */
        readonly error: DiagnosticsClearError;
    };

/**
 * Error returned when diagnostics cannot be read.
 */
export type DiagnosticsSnapshotError = (typeof DIAGNOSTICS_SNAPSHOT_ERRORS)[number];

/**
 * Error returned when diagnostics cannot be cleared.
 */
export type DiagnosticsClearError = (typeof DIAGNOSTICS_CLEAR_ERRORS)[number];
