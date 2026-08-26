/**
 * @file Structural guards for UI state and settings-command responses.
 */

import { isDisplaySettings } from "../settings/snapshot";
import { isMessageRecord } from "./message-guard-utils";
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
 * Recognizes ready or unavailable display state, including optional time-zone errors.
 *
 * @param value - Untrusted display-state response.
 * @returns - Whether the value is a complete ready or unavailable display state.
 */
export function isDisplayState(value: unknown): value is DisplayState {
    if (!isMessageRecord(value) || !Object.hasOwn(value, "availability")) {
        return false;
    }
    if (value.availability === "unavailable") {
        return (
            Object.keys(value).length === 4
            && Object.hasOwn(value, "revision")
            && Object.hasOwn(value, "display")
            && Object.hasOwn(value, "failure")
            && value.revision === null
            && value.display === null
            && (value.failure === "settings-load" || value.failure === "fail-closed-cleanup")
        );
    }
    return (
        value.availability === "ready"
        && (Object.keys(value).length === 4 || Object.keys(value).length === 5)
        && Object.keys(value).every(
            (key) =>
                key === "availability"
                || key === "revision"
                || key === "display"
                || key === "debugEnabled"
                || key === "error",
        )
        && Object.hasOwn(value, "revision")
        && Object.hasOwn(value, "display")
        && Object.hasOwn(value, "debugEnabled")
        && typeof value.revision === "number"
        && Number.isSafeInteger(value.revision)
        && value.revision >= 0
        && isDisplaySettings(value.display)
        && typeof value.debugEnabled === "boolean"
        && (!Object.hasOwn(value, "error") || value.error === "unavailable-time-zone")
    );
}

/**
 * Recognizes ready or unavailable diagnostic logging state.
 *
 * @param value - Untrusted diagnostic-state response.
 * @returns - Whether the value is a complete ready or unavailable diagnostic state.
 */
export function isDebugState(value: unknown): value is DebugState {
    if (!isMessageRecord(value) || !Object.hasOwn(value, "availability")) {
        return false;
    }
    if (value.availability === "unavailable") {
        return (
            Object.keys(value).length === 4
            && Object.hasOwn(value, "revision")
            && Object.hasOwn(value, "enabled")
            && Object.hasOwn(value, "failure")
            && value.revision === null
            && value.enabled === null
            && (value.failure === "settings-load" || value.failure === "fail-closed-cleanup")
        );
    }
    return (
        value.availability === "ready"
        && Object.keys(value).length === 3
        && Object.hasOwn(value, "revision")
        && Object.hasOwn(value, "enabled")
        && typeof value.revision === "number"
        && Number.isSafeInteger(value.revision)
        && value.revision >= 0
        && typeof value.enabled === "boolean"
    );
}

/**
 * Recognizes ready or unavailable popup state and valid failure combinations.
 *
 * @param value - Untrusted popup-state response.
 * @returns - Whether the value is a complete valid popup state.
 */
export function isPopupState(value: unknown): value is PopupState {
    if (!isMessageRecord(value)) {
        return false;
    }
    if (value.availability === "unavailable") {
        const keys = Object.keys(value);
        return (
            keys.length === 8
            && value.revision === null
            && value.globalEnabled === null
            && (value.hostname === null || typeof value.hostname === "string")
            && value.siteEnabled === null
            && value.hasAdapter === false
            && (value.status === "settings-unavailable" || value.status === "runtime-failed")
            && (value.failure === "settings-load" || value.failure === "fail-closed-cleanup")
        );
    }
    const keys = Object.keys(value);
    return (
        (keys.length === 7 || keys.length === 8)
        && value.availability === "ready"
        && typeof value.revision === "number"
        && Number.isSafeInteger(value.revision)
        && value.revision >= 0
        && typeof value.globalEnabled === "boolean"
        && (value.hostname === null || typeof value.hostname === "string")
        && (typeof value.siteEnabled === "boolean" || value.siteEnabled === null)
        && typeof value.hasAdapter === "boolean"
        && [
            "active",
            "global-disabled",
            "site-disabled",
            "inaccessible",
            "runtime-failed",
            "no-rules",
        ].includes(String(value.status))
        && (
            value.failure === undefined
            || (
                typeof value.failure === "string"
                && [
                    "current-tab-query",
                    "registration",
                    "matching-tabs-query",
                    "current-tab-inject",
                    "current-tab-teardown",
                    "document-status",
                ].includes(value.failure)
            )
        )
    );
}

/**
 * Recognizes ready or unavailable site-preferences state.
 *
 * @param value - Untrusted sites-state response.
 * @returns - Whether the value is a complete valid sites state.
 */
export function isSitesState(value: unknown): value is SitesState {
    if (!isMessageRecord(value)) {
        return false;
    }
    if (value.availability === "unavailable") {
        return (
            Object.keys(value).length === 5
            && value.revision === null
            && value.globalEnabled === null
            && Array.isArray(value.sites)
            && value.sites.length === 0
            && (value.failure === "settings-load" || value.failure === "fail-closed-cleanup")
        );
    }
    if (
        value.availability !== "ready"
        || Object.keys(value).length !== 4
        || typeof value.revision !== "number"
        || !Number.isSafeInteger(value.revision)
        || value.revision < 0
        || typeof value.globalEnabled !== "boolean"
        || !Array.isArray(value.sites)
    ) {
        return false;
    }
    return value.sites.every(
        (site) =>
            isMessageRecord(site)
            && Object.keys(site).length === 3
            && typeof site.hostname === "string"
            && typeof site.enabled === "boolean"
            && typeof site.hasAdapter === "boolean",
    );
}

/**
 * Recognizes a global-activation update result and its popup state.
 *
 * @param value - Untrusted global-activation response.
 * @returns - Whether the value contains a valid update result and popup state.
 */
export function isSetGlobalEnabledResponse(value: unknown): value is SetGlobalEnabledResponse {
    if (!isMessageRecord(value) || typeof value.ok !== "boolean" || !isPopupState(value.state)) {
        return false;
    }
    if (value.ok) {
        return (
            Object.keys(value).length === 3
            && typeof value.acceptedRevision === "number"
            && Number.isSafeInteger(value.acceptedRevision)
            && value.acceptedRevision >= 0
        );
    }
    return Object.keys(value).length === 3
        && (value.error === "save-failed" || value.error === "settings-unavailable");
}

/**
 * Recognizes a site-activation update result and its surface-specific state.
 *
 * @param value - Untrusted site-activation response.
 * @returns - Whether the value contains a valid surface-specific update result.
 */
export function isSetSiteEnabledResponse(value: unknown): value is SetSiteEnabledResponse {
    if (!isMessageRecord(value) || typeof value.ok !== "boolean") {
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
        return (
            Object.keys(value).length === 4
            && typeof value.acceptedRevision === "number"
            && Number.isSafeInteger(value.acceptedRevision)
            && value.acceptedRevision >= 0
        );
    }
    return Object.keys(value).length === 4
        && (
            value.error === "save-failed"
            || value.error === "invalid-hostname"
            || value.error === "settings-unavailable"
        );
}

/**
 * Recognizes a display-settings update result and any tab refresh failures.
 *
 * @param value - Untrusted display-settings response.
 * @returns - Whether the value contains a valid update result and refresh failures.
 */
export function isSetDisplaySettingsResponse(value: unknown): value is SetDisplaySettingsResponse {
    if (
        !isMessageRecord(value)
        || !Object.hasOwn(value, "ok")
        || !Object.hasOwn(value, "state")
        || typeof value.ok !== "boolean"
        || !isDisplayState(value.state)
    ) {
        return false;
    }
    if (!value.ok) {
        return (
            Object.keys(value).length === 3
            && Object.hasOwn(value, "error")
            && (
                value.error === "invalid-format"
                || value.error === "invalid-time-zone"
                || value.error === "invalid-display-settings"
                || value.error === "save-failed"
                || value.error === "settings-unavailable"
            )
        );
    }
    return (
        Object.keys(value).length === 4
        && Object.hasOwn(value, "acceptedRevision")
        && Object.hasOwn(value, "refreshFailures")
        && typeof value.acceptedRevision === "number"
        && Number.isSafeInteger(value.acceptedRevision)
        && value.acceptedRevision >= 0
        && Array.isArray(value.refreshFailures)
        && value.refreshFailures.every(isRefreshFailure)
    );
}

/**
 * Recognizes a reset-all-settings result and its site-preferences state.
 *
 * @param value - Untrusted reset-all-settings response.
 * @returns - Whether the value contains a valid reset result and sites state.
 */
export function isResetAllSettingsResponse(value: unknown): value is ResetAllSettingsResponse {
    if (
        !isMessageRecord(value)
        || !Object.hasOwn(value, "ok")
        || typeof value.ok !== "boolean"
        || !Object.hasOwn(value, "state")
    ) {
        return false;
    }
    if (value.ok) {
        return (
            Object.keys(value).length === 3
            && Object.hasOwn(value, "acceptedRevision")
            && typeof value.acceptedRevision === "number"
            && Number.isSafeInteger(value.acceptedRevision)
            && value.acceptedRevision >= 0
            && isSitesState(value.state)
            && value.state.availability === "ready"
        );
    }
    return (
        Object.keys(value).length === 3
        && Object.hasOwn(value, "error")
        && (value.error === "save-failed" || value.error === "settings-unavailable")
        && isSitesState(value.state)
    );
}

/**
 * Recognizes a diagnostic-logging update result and any tab refresh failures.
 *
 * @param value - Untrusted diagnostic-policy response.
 * @returns - Whether the value contains a valid update result and refresh failures.
 */
export function isSetDebugEnabledResponse(value: unknown): value is SetDebugEnabledResponse {
    if (
        !isMessageRecord(value)
        || !Object.hasOwn(value, "ok")
        || !Object.hasOwn(value, "state")
        || typeof value.ok !== "boolean"
        || !isDebugState(value.state)
    ) {
        return false;
    }
    if (value.ok) {
        return (
            (Object.keys(value).length === 3 || Object.keys(value).length === 4)
            && Object.keys(value).every(
                (key) =>
                    key === "ok"
                    || key === "acceptedRevision"
                    || key === "state"
                    || key === "refreshFailures",
            )
            && Object.hasOwn(value, "acceptedRevision")
            && typeof value.acceptedRevision === "number"
            && Number.isSafeInteger(value.acceptedRevision)
            && value.acceptedRevision >= 0
            && (
                !Object.hasOwn(value, "refreshFailures")
                || (
                    Array.isArray(value.refreshFailures)
                    && value.refreshFailures.every(isRefreshFailure)
                )
            )
        );
    }
    return (
        Object.keys(value).length === 3
        && Object.hasOwn(value, "error")
        && (value.error === "save-failed" || value.error === "settings-unavailable")
    );
}

/**
 * Recognizes a document refresh failure with optional tab identity.
 *
 * @param value - Untrusted refresh failure.
 * @returns - Whether the value is a valid refresh failure.
 */
function isRefreshFailure(value: unknown): boolean {
    return (
        isMessageRecord(value)
        && (Object.keys(value).length === 2 || Object.keys(value).length === 3)
        && Object.hasOwn(value, "hostname")
        && Object.hasOwn(value, "reason")
        && Object.keys(value).every(
            (key) => key === "hostname" || key === "tabId" || key === "reason",
        )
        && (Object.keys(value).length !== 3 || Object.hasOwn(value, "tabId"))
        && typeof value.hostname === "string"
        && (
            value.tabId === undefined
            || (
                typeof value.tabId === "number"
                && Number.isSafeInteger(value.tabId)
                && value.tabId >= 0
            )
        )
        && (value.reason === "matching-tabs-query" || value.reason === "tab-update")
    );
}
