/**
 * @file Type guards backed by declarative Valibot UI-state and command-response schemas.
 */

import * as v from "valibot";
import {
    resetAllSettingsResponseSchema,
    setDebugEnabledResponseSchema,
    setDisplaySettingsResponseSchema,
    setGlobalEnabledResponseSchema,
    setSiteEnabledResponseSchema,
} from "./response-message-schemas";
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
import {
    debugStateSchema,
    displayStateSchema,
    popupStateSchema,
    sitesStateSchema,
} from "./view-state-schemas";

/**
 * Recognizes ready or unavailable display state, including optional time-zone errors.
 *
 * @param value - Untrusted display-state response.
 * @returns - Whether the value is a complete ready or unavailable display state.
 */
export function isDisplayState(value: unknown): value is DisplayState {
    return v.is(displayStateSchema, value);
}

/**
 * Recognizes ready or unavailable diagnostic logging state.
 *
 * @param value - Untrusted diagnostic-state response.
 * @returns - Whether the value is a complete ready or unavailable diagnostic state.
 */
export function isDebugState(value: unknown): value is DebugState {
    return v.is(debugStateSchema, value);
}

/**
 * Recognizes ready or unavailable popup state and valid failure combinations.
 *
 * @param value - Untrusted popup-state response.
 * @returns - Whether the value is a complete valid popup state.
 */
export function isPopupState(value: unknown): value is PopupState {
    return v.is(popupStateSchema, value);
}

/**
 * Recognizes ready or unavailable site-preferences state.
 *
 * @param value - Untrusted sites-state response.
 * @returns - Whether the value is a complete valid sites state.
 */
export function isSitesState(value: unknown): value is SitesState {
    return v.is(sitesStateSchema, value);
}

/**
 * Recognizes a global-activation update result and its popup state.
 *
 * @param value - Untrusted global-activation response.
 * @returns - Whether the value contains a valid update result and popup state.
 */
export function isSetGlobalEnabledResponse(value: unknown): value is SetGlobalEnabledResponse {
    return v.is(setGlobalEnabledResponseSchema, value);
}

/**
 * Recognizes a site-activation update result and its surface-specific state.
 *
 * @param value - Untrusted site-activation response.
 * @returns - Whether the value contains a valid surface-specific update result.
 */
export function isSetSiteEnabledResponse(value: unknown): value is SetSiteEnabledResponse {
    return v.is(setSiteEnabledResponseSchema, value);
}

/**
 * Recognizes a display-settings update result and any tab refresh failures.
 *
 * @param value - Untrusted display-settings response.
 * @returns - Whether the value contains a valid update result and refresh failures.
 */
export function isSetDisplaySettingsResponse(value: unknown): value is SetDisplaySettingsResponse {
    return v.is(setDisplaySettingsResponseSchema, value);
}

/**
 * Recognizes a reset-all-settings result and its site-preferences state.
 *
 * @param value - Untrusted reset-all-settings response.
 * @returns - Whether the value contains a valid reset result and sites state.
 */
export function isResetAllSettingsResponse(value: unknown): value is ResetAllSettingsResponse {
    return v.is(resetAllSettingsResponseSchema, value);
}

/**
 * Recognizes a diagnostic-logging update result and any tab refresh failures.
 *
 * @param value - Untrusted diagnostic-policy response.
 * @returns - Whether the value contains a valid update result and refresh failures.
 */
export function isSetDebugEnabledResponse(value: unknown): value is SetDebugEnabledResponse {
    return v.is(setDebugEnabledResponseSchema, value);
}
