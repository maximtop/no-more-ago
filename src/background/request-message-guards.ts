/**
 * @file Structural guards for requests accepted by the background runtime.
 */

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
import { isMessageRecord } from "./message-guard-utils";

/**
 * Recognizes the exact get-popup-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact popup-state request.
 */
export function isGetPopupStateMessage(value: unknown): value is GetPopupStateMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 1
        && Object.hasOwn(value, "type")
        && value.type === GET_POPUP_STATE_MESSAGE
    );
}

/**
 * Recognizes a set-global-enabled request with a boolean enabled flag.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid global-activation update request.
 */
export function isSetGlobalEnabledMessage(value: unknown): value is SetGlobalEnabledMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 2
        && Object.hasOwn(value, "type")
        && Object.hasOwn(value, "enabled")
        && value.type === SET_GLOBAL_ENABLED_MESSAGE
        && typeof value.enabled === "boolean"
    );
}

/**
 * Recognizes the exact get-sites-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact sites-state request.
 */
export function isGetSitesStateMessage(value: unknown): value is GetSitesStateMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 1
        && Object.hasOwn(value, "type")
        && value.type === GET_SITES_STATE_MESSAGE
    );
}

/**
 * Recognizes a site update request with hostname, flag, and response surface.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid site-activation update request.
 */
export function isSetSiteEnabledMessage(value: unknown): value is SetSiteEnabledMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 4
        && Object.hasOwn(value, "type")
        && Object.hasOwn(value, "hostname")
        && Object.hasOwn(value, "enabled")
        && Object.hasOwn(value, "surface")
        && value.type === SET_SITE_ENABLED_MESSAGE
        && typeof value.hostname === "string"
        && typeof value.enabled === "boolean"
        && (value.surface === "popup" || value.surface === "sites")
    );
}

/**
 * Recognizes the exact get-display-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact display-state request.
 */
export function isGetDisplayStateMessage(value: unknown): value is GetDisplayStateMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 1
        && Object.hasOwn(value, "type")
        && value.type === GET_DISPLAY_STATE_MESSAGE
    );
}

/**
 * Recognizes a display-settings request with an arbitrary display payload.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid display-settings update request.
 */
export function isSetDisplaySettingsMessage(value: unknown): value is SetDisplaySettingsMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 2
        && Object.hasOwn(value, "type")
        && Object.hasOwn(value, "display")
        && value.type === SET_DISPLAY_SETTINGS_MESSAGE
    );
}

/**
 * Recognizes the exact reset-all-settings request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact reset-all-settings request.
 */
export function isResetAllSettingsMessage(value: unknown): value is ResetAllSettingsMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 1
        && Object.hasOwn(value, "type")
        && value.type === RESET_ALL_SETTINGS_MESSAGE
    );
}

/**
 * Recognizes the exact get-debug-state request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact diagnostic-state request.
 */
export function isGetDebugStateMessage(value: unknown): value is GetDebugStateMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 1
        && Object.hasOwn(value, "type")
        && value.type === GET_DEBUG_STATE_MESSAGE
    );
}

/**
 * Recognizes a set-debug-enabled request with a boolean enabled flag.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is a valid diagnostic-policy update request.
 */
export function isSetDebugEnabledMessage(value: unknown): value is SetDebugEnabledMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 2
        && Object.hasOwn(value, "type")
        && Object.hasOwn(value, "enabled")
        && value.type === SET_DEBUG_ENABLED_MESSAGE
        && typeof value.enabled === "boolean"
    );
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
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 1
        && Object.hasOwn(value, "type")
        && value.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE
    );
}

/**
 * Recognizes the exact clear-diagnostics request shape.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value is an exact clear-diagnostics request.
 */
export function isClearDiagnosticsMessage(value: unknown): value is ClearDiagnosticsMessage {
    return (
        isMessageRecord(value)
        && Object.keys(value).length === 1
        && Object.hasOwn(value, "type")
        && value.type === CLEAR_DIAGNOSTICS_MESSAGE
    );
}

/**
 * Recognizes any request accepted by the background message listener.
 *
 * @param value - Untrusted background request.
 * @returns - Whether the value matches any accepted request.
 */
export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
    return (
        isGetPopupStateMessage(value)
        || isSetGlobalEnabledMessage(value)
        || isGetSitesStateMessage(value)
        || isSetSiteEnabledMessage(value)
        || isGetDisplayStateMessage(value)
        || isSetDisplaySettingsMessage(value)
        || isResetAllSettingsMessage(value)
        || isGetDebugStateMessage(value)
        || isSetDebugEnabledMessage(value)
        || isGetDiagnosticsSnapshotMessage(value)
        || isClearDiagnosticsMessage(value)
    );
}
