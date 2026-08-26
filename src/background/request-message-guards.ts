/**
 * @file Valibot schemas and type guards for background runtime requests.
 */

import * as v from "valibot";
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
    type BackgroundMessage,
    type ClearDiagnosticsMessage,
    type GetDebugStateMessage,
    type GetDiagnosticsSnapshotMessage,
    type GetDisplayStateMessage,
    type GetPopupStateMessage,
    type GetSitesStateMessage,
    type ResetAllSettingsMessage,
    type SetDebugEnabledMessage,
    type SetDisplaySettingsMessage,
    type SetGlobalEnabledMessage,
    type SetSiteEnabledMessage,
} from "./message-contracts";
import { strictMessageObject } from "./message-schema-utils";

const getPopupStateSchema = strictMessageObject({
    type: v.literal(GET_POPUP_STATE_MESSAGE),
});
const setGlobalEnabledSchema = strictMessageObject({
    type: v.literal(SET_GLOBAL_ENABLED_MESSAGE),
    enabled: v.boolean(),
});
const getSitesStateSchema = strictMessageObject({
    type: v.literal(GET_SITES_STATE_MESSAGE),
});
const setSiteEnabledSchema = strictMessageObject({
    type: v.literal(SET_SITE_ENABLED_MESSAGE),
    hostname: v.string(),
    enabled: v.boolean(),
    surface: v.picklist(["popup", "sites"]),
});
const getDisplayStateSchema = strictMessageObject({
    type: v.literal(GET_DISPLAY_STATE_MESSAGE),
});
const setDisplaySettingsSchema = strictMessageObject({
    type: v.literal(SET_DISPLAY_SETTINGS_MESSAGE),
    display: v.unknown(),
});
const resetAllSettingsSchema = strictMessageObject({
    type: v.literal(RESET_ALL_SETTINGS_MESSAGE),
});
const getDebugStateSchema = strictMessageObject({
    type: v.literal(GET_DEBUG_STATE_MESSAGE),
});
const setDebugEnabledSchema = strictMessageObject({
    type: v.literal(SET_DEBUG_ENABLED_MESSAGE),
    enabled: v.boolean(),
});
const getDiagnosticsSnapshotSchema = strictMessageObject({
    type: v.literal(GET_DIAGNOSTICS_SNAPSHOT_MESSAGE),
});
const clearDiagnosticsSchema = strictMessageObject({
    type: v.literal(CLEAR_DIAGNOSTICS_MESSAGE),
});
const backgroundMessageSchema = v.union([
    getPopupStateSchema,
    setGlobalEnabledSchema,
    getSitesStateSchema,
    setSiteEnabledSchema,
    getDisplayStateSchema,
    setDisplaySettingsSchema,
    resetAllSettingsSchema,
    getDebugStateSchema,
    setDebugEnabledSchema,
    getDiagnosticsSnapshotSchema,
    clearDiagnosticsSchema,
]);

/**
 * Recognizes the exact get-popup-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact popup-state request.
 */
export function isGetPopupStateMessage(value: unknown): value is GetPopupStateMessage {
    return v.is(getPopupStateSchema, value);
}

/**
 * Recognizes a set-global-enabled request with a boolean enabled flag.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid global-activation update request.
 */
export function isSetGlobalEnabledMessage(value: unknown): value is SetGlobalEnabledMessage {
    return v.is(setGlobalEnabledSchema, value);
}

/**
 * Recognizes the exact get-sites-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact sites-state request.
 */
export function isGetSitesStateMessage(value: unknown): value is GetSitesStateMessage {
    return v.is(getSitesStateSchema, value);
}

/**
 * Recognizes a site update request with hostname, flag, and response surface.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid site-activation update request.
 */
export function isSetSiteEnabledMessage(value: unknown): value is SetSiteEnabledMessage {
    return v.is(setSiteEnabledSchema, value);
}

/**
 * Recognizes the exact get-display-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact display-state request.
 */
export function isGetDisplayStateMessage(value: unknown): value is GetDisplayStateMessage {
    return v.is(getDisplayStateSchema, value);
}

/**
 * Recognizes a display-settings request with an arbitrary display payload.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid display-settings update request.
 */
export function isSetDisplaySettingsMessage(value: unknown): value is SetDisplaySettingsMessage {
    return v.is(setDisplaySettingsSchema, value);
}

/**
 * Recognizes the exact reset-all-settings request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact reset-all-settings request.
 */
export function isResetAllSettingsMessage(value: unknown): value is ResetAllSettingsMessage {
    return v.is(resetAllSettingsSchema, value);
}

/**
 * Recognizes the exact get-debug-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact diagnostic-state request.
 */
export function isGetDebugStateMessage(value: unknown): value is GetDebugStateMessage {
    return v.is(getDebugStateSchema, value);
}

/**
 * Recognizes a set-debug-enabled request with a boolean enabled flag.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid diagnostic-policy update request.
 */
export function isSetDebugEnabledMessage(value: unknown): value is SetDebugEnabledMessage {
    return v.is(setDebugEnabledSchema, value);
}

/**
 * Recognizes the exact get-diagnostics-snapshot request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact diagnostics-snapshot request.
 */
export function isGetDiagnosticsSnapshotMessage(
    value: unknown,
): value is GetDiagnosticsSnapshotMessage {
    return v.is(getDiagnosticsSnapshotSchema, value);
}

/**
 * Recognizes the exact clear-diagnostics request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact clear-diagnostics request.
 */
export function isClearDiagnosticsMessage(value: unknown): value is ClearDiagnosticsMessage {
    return v.is(clearDiagnosticsSchema, value);
}

/**
 * Recognizes any request accepted by the background message listener.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value matches any accepted request.
 */
export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
    return v.is(backgroundMessageSchema, value);
}
