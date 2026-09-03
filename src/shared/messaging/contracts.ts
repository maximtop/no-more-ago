/**
 * @file Valibot-backed background request and diagnostic response contracts.
 */

import * as v from "valibot";
import { SAFE_EXTENSION_VERSION_PATTERN } from "../extension-version";
import { DIAGNOSTIC_BROWSER_FAMILIES } from "../diagnostics/contracts";
import { diagnosticEventSchema } from "../diagnostics/events";
import { APPEARANCES } from "../settings/snapshot";
import { SITE_SCOPE_MODES } from "../settings/site-scope";
import { SITE_SETTINGS_SURFACES } from "./view-state-values";
import type {
    DebugState,
    DisplayState,
    PopupState,
    SitesState,
} from "./view-state-schemas";
import type {
    ResetAllSettingsResponse,
    SetAppearanceResponse,
    SetDebugEnabledResponse,
    SetDisplaySettingsResponse,
    SetGlobalEnabledResponse,
    SetSiteEnabledResponse,
    SetSiteScopeModeResponse,
} from "./response-schemas";
import type { DocumentState } from "./document-state";

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
 * Requests the scope mode and both hostname lists.
 */
export const GET_SITES_STATE_MESSAGE = "no-more-ago:get-sites-state" as const;

/**
 * Changes a single site's activation setting.
 */
export const SET_SITE_ENABLED_MESSAGE = "no-more-ago:set-site-enabled" as const;

/**
 * Changes the active site scope mode.
 */
export const SET_SITE_SCOPE_MODE_MESSAGE = "no-more-ago:set-site-scope-mode" as const;

/**
 * Requests the current display configuration.
 */
export const GET_DISPLAY_STATE_MESSAGE = "no-more-ago:get-display-state" as const;

/**
 * Changes the display configuration.
 */
export const SET_DISPLAY_SETTINGS_MESSAGE = "no-more-ago:set-display-settings" as const;

/**
 * Changes the appearance applied to both extension surfaces.
 */
export const SET_APPEARANCE_MESSAGE = "no-more-ago:set-appearance" as const;

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
 * Named reasons a diagnostics read or clear fails.
 */
export const DIAGNOSTICS_ERROR = {
    DISABLED: "disabled",
    UNAVAILABLE: "unavailable",
    EMPTY: "empty",
    INVALID_JOURNAL: "invalid-journal",
    STORAGE_FAILED: "storage-failed",
} as const;

/**
 * Errors returned when a diagnostic snapshot cannot be read.
 */
export const DIAGNOSTICS_SNAPSHOT_ERRORS = [
    DIAGNOSTICS_ERROR.DISABLED,
    DIAGNOSTICS_ERROR.UNAVAILABLE,
    DIAGNOSTICS_ERROR.EMPTY,
    DIAGNOSTICS_ERROR.INVALID_JOURNAL,
    DIAGNOSTICS_ERROR.STORAGE_FAILED,
] as const;

/**
 * Errors returned when diagnostic entries cannot be cleared.
 */
export const DIAGNOSTICS_CLEAR_ERRORS = [
    DIAGNOSTICS_ERROR.DISABLED,
    DIAGNOSTICS_ERROR.UNAVAILABLE,
    DIAGNOSTICS_ERROR.STORAGE_FAILED,
] as const;

/**
 * Exact request for popup state.
 */
export const getPopupStateMessageSchema = v.strictObject({
    type: v.literal(GET_POPUP_STATE_MESSAGE),
});

/**
 * Exact request for document runtime state.
 */
export const getDocumentStateMessageSchema = v.strictObject({
    type: v.literal(GET_DOCUMENT_STATE_MESSAGE),
});

/**
 * Exact request for a global activation change.
 */
export const setGlobalEnabledMessageSchema = v.strictObject({
    type: v.literal(SET_GLOBAL_ENABLED_MESSAGE),
    enabled: v.boolean(),
    surface: v.picklist(SITE_SETTINGS_SURFACES),
});

/**
 * Exact request for the scope mode and both hostname lists.
 */
export const getSitesStateMessageSchema = v.strictObject({
    type: v.literal(GET_SITES_STATE_MESSAGE),
});

/**
 * Exact request for a site activation change.
 */
export const setSiteEnabledMessageSchema = v.strictObject({
    type: v.literal(SET_SITE_ENABLED_MESSAGE),
    hostname: v.string(),
    enabled: v.boolean(),
    surface: v.picklist(SITE_SETTINGS_SURFACES),
});

/**
 * Exact request for a scope-mode change.
 */
export const setSiteScopeModeMessageSchema = v.strictObject({
    type: v.literal(SET_SITE_SCOPE_MODE_MESSAGE),
    mode: v.picklist(SITE_SCOPE_MODES),
});

/**
 * Exact request for display state.
 */
export const getDisplayStateMessageSchema = v.strictObject({
    type: v.literal(GET_DISPLAY_STATE_MESSAGE),
});

/**
 * Exact request for a display-settings change.
 */
export const setDisplaySettingsMessageSchema = v.strictObject({
    type: v.literal(SET_DISPLAY_SETTINGS_MESSAGE),
    display: v.unknown(),
});

/**
 * Exact request for an appearance change.
 */
export const setAppearanceMessageSchema = v.strictObject({
    type: v.literal(SET_APPEARANCE_MESSAGE),
    appearance: v.picklist(APPEARANCES),
});

/**
 * Exact request to reset all settings.
 */
export const resetAllSettingsMessageSchema = v.strictObject({
    type: v.literal(RESET_ALL_SETTINGS_MESSAGE),
});

/**
 * Exact request for diagnostic logging state.
 */
export const getDebugStateMessageSchema = v.strictObject({
    type: v.literal(GET_DEBUG_STATE_MESSAGE),
});

/**
 * Exact request for a diagnostic logging change.
 */
export const setDebugEnabledMessageSchema = v.strictObject({
    type: v.literal(SET_DEBUG_ENABLED_MESSAGE),
    enabled: v.boolean(),
});

/**
 * Exact request for stored diagnostics.
 */
export const getDiagnosticsSnapshotMessageSchema = v.strictObject({
    type: v.literal(GET_DIAGNOSTICS_SNAPSHOT_MESSAGE),
});

/**
 * Exact request to clear stored diagnostics.
 */
export const clearDiagnosticsMessageSchema = v.strictObject({
    type: v.literal(CLEAR_DIAGNOSTICS_MESSAGE),
});

/**
 * Every request accepted by the background runtime listener.
 */
export const backgroundMessageSchema = v.union([
    getPopupStateMessageSchema,
    getDocumentStateMessageSchema,
    setGlobalEnabledMessageSchema,
    getSitesStateMessageSchema,
    setSiteEnabledMessageSchema,
    setSiteScopeModeMessageSchema,
    getDisplayStateMessageSchema,
    setDisplaySettingsMessageSchema,
    setAppearanceMessageSchema,
    resetAllSettingsMessageSchema,
    getDebugStateMessageSchema,
    setDebugEnabledMessageSchema,
    getDiagnosticsSnapshotMessageSchema,
    clearDiagnosticsMessageSchema,
]);

const diagnosticsEnvironmentSchema = v.strictObject({
    browserFamily: v.picklist(DIAGNOSTIC_BROWSER_FAMILIES),
    extensionVersion: v.exactOptional(
        v.pipe(v.string(), v.regex(SAFE_EXTENSION_VERSION_PATTERN)),
    ),
});

/**
 * Diagnostic snapshot returned to the options page.
 */
export const diagnosticsSnapshotSchema = v.strictObject({
    entries: v.pipe(v.array(diagnosticEventSchema), v.readonly()),
    environment: diagnosticsEnvironmentSchema,
});

/**
 * Result of reading stored diagnostics.
 */
export const getDiagnosticsSnapshotResponseSchema = v.union([
    v.strictObject({
        ok: v.literal(true),
        snapshot: diagnosticsSnapshotSchema,
    }),
    v.strictObject({
        ok: v.literal(false),
        error: v.picklist(DIAGNOSTICS_SNAPSHOT_ERRORS),
    }),
]);

/**
 * Result of clearing stored diagnostics.
 */
export const clearDiagnosticsResponseSchema = v.union([
    v.strictObject({ ok: v.literal(true) }),
    v.strictObject({
        ok: v.literal(false),
        error: v.picklist(DIAGNOSTICS_CLEAR_ERRORS),
    }),
]);

/**
 * Background request inferred from the request schema.
 */
export type BackgroundMessage = v.InferOutput<typeof backgroundMessageSchema>;

/**
 * Popup-state request inferred from its schema.
 */
export type GetPopupStateMessage = v.InferOutput<typeof getPopupStateMessageSchema>;

/**
 * Document-state request inferred from its schema.
 */
export type GetDocumentStateMessage = v.InferOutput<typeof getDocumentStateMessageSchema>;

/**
 * Global activation request inferred from its schema.
 */
export type SetGlobalEnabledMessage = v.InferOutput<typeof setGlobalEnabledMessageSchema>;

/**
 * Sites-state request inferred from its schema.
 */
export type GetSitesStateMessage = v.InferOutput<typeof getSitesStateMessageSchema>;

/**
 * Site activation request inferred from its schema.
 */
export type SetSiteEnabledMessage = v.InferOutput<typeof setSiteEnabledMessageSchema>;

/**
 * Scope-mode request inferred from its schema.
 */
export type SetSiteScopeModeMessage = v.InferOutput<typeof setSiteScopeModeMessageSchema>;

/**
 * Display-state request inferred from its schema.
 */
export type GetDisplayStateMessage = v.InferOutput<typeof getDisplayStateMessageSchema>;

/**
 * Display-settings request inferred from its schema.
 */
export type SetDisplaySettingsMessage = v.InferOutput<typeof setDisplaySettingsMessageSchema>;

/**
 * Appearance request inferred from its schema.
 */
export type SetAppearanceMessage = v.InferOutput<typeof setAppearanceMessageSchema>;

/**
 * Reset request inferred from its schema.
 */
export type ResetAllSettingsMessage = v.InferOutput<typeof resetAllSettingsMessageSchema>;

/**
 * Diagnostic-state request inferred from its schema.
 */
export type GetDebugStateMessage = v.InferOutput<typeof getDebugStateMessageSchema>;

/**
 * Diagnostic setting request inferred from its schema.
 */
export type SetDebugEnabledMessage = v.InferOutput<typeof setDebugEnabledMessageSchema>;

/**
 * Diagnostic snapshot request inferred from its schema.
 */
export type GetDiagnosticsSnapshotMessage = v.InferOutput<
    typeof getDiagnosticsSnapshotMessageSchema
>;

/**
 * Diagnostic clear request inferred from its schema.
 */
export type ClearDiagnosticsMessage = v.InferOutput<typeof clearDiagnosticsMessageSchema>;

/**
 * Diagnostic snapshot inferred from its response schema.
 */
export type DiagnosticsSnapshot = v.InferOutput<typeof diagnosticsSnapshotSchema>;

/**
 * Diagnostic environment inferred from its schema.
 */
export type DiagnosticsEnvironment = v.InferOutput<typeof diagnosticsEnvironmentSchema>;

/**
 * Diagnostic snapshot result inferred from its schema.
 */
export type GetDiagnosticsSnapshotResponse = v.InferOutput<
    typeof getDiagnosticsSnapshotResponseSchema
>;

/**
 * Diagnostic clear result inferred from its schema.
 */
export type ClearDiagnosticsResponse = v.InferOutput<typeof clearDiagnosticsResponseSchema>;

/**
 * Error returned when diagnostics cannot be read.
 */
export type DiagnosticsSnapshotError = (typeof DIAGNOSTICS_SNAPSHOT_ERRORS)[number];

/**
 * Error returned when diagnostics cannot be cleared.
 */
export type DiagnosticsClearError = (typeof DIAGNOSTICS_CLEAR_ERRORS)[number];

/**
 * Every response returned by the background runtime listener.
 */
export type BackgroundResponse =
    | PopupState
    | DocumentState
    | SitesState
    | DisplayState
    | DebugState
    | SetGlobalEnabledResponse
    | SetSiteEnabledResponse
    | SetSiteScopeModeResponse
    | SetDisplaySettingsResponse
    | SetAppearanceResponse
    | ResetAllSettingsResponse
    | SetDebugEnabledResponse
    | GetDiagnosticsSnapshotResponse
    | ClearDiagnosticsResponse;
