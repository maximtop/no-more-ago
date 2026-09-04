/**
 * @file Background view states projected for the popup and options surfaces.
 */

import type { UNAVAILABLE_TIME_ZONE_ERROR } from "../date/presentation-errors";
import { APPEARANCE, type Appearance, type DisplaySettings } from "../settings/snapshot";
import type { SiteScopeMode } from "../settings/site-scope";
import {
    POPUP_STATUS,
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
    type PopupRuntimeFailure,
    type ReadyPopupStatus,
    type RefreshFailureReason,
    type SettingsStateFailure,
    type UnavailablePopupStatus,
} from "./view-state-values";

/**
 * Popup projection built from a loaded settings snapshot.
 */
export interface ReadyPopupState {
    /**
     * Marks a projection built from a loaded settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.READY;

    /**
     * Settings revision the projection was built from.
     */
    readonly revision: number;

    /**
     * Whether the extension processes supported pages at all.
     */
    readonly globalEnabled: boolean;

    /**
     * Active tab hostname, or null when no supported page is open.
     */
    readonly hostname: string | null;

    /**
     * Whether the active hostname is enabled, or null when there is none.
     */
    readonly siteEnabled: boolean | null;

    /**
     * Whether site preferences work as an exclusion or an allow list.
     */
    readonly scopeMode: SiteScopeMode;

    /**
     * Appearance both extension surfaces render with.
     */
    readonly appearance: Appearance;

    /**
     * Activation status presented for the active tab.
     */
    readonly status: ReadyPopupStatus;

    /**
     * Runtime failure explaining a status the user can act on.
     */
    readonly failure?: PopupRuntimeFailure | undefined;
}

/**
 * Fail-closed popup projection used when settings cannot be read safely.
 */
export interface UnavailablePopupState {
    /**
     * Marks a projection built without a usable settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.UNAVAILABLE;

    /**
     * Absent settings revision.
     */
    readonly revision: null;

    /**
     * Absent global activation setting.
     */
    readonly globalEnabled: null;

    /**
     * Active tab hostname, or null when it is not known.
     */
    readonly hostname: string | null;

    /**
     * Absent per-site activation setting.
     */
    readonly siteEnabled: null;

    /**
     * Absent site scope mode.
     */
    readonly scopeMode: null;

    /**
     * Default appearance used while settings are unavailable.
     */
    readonly appearance: Appearance;

    /**
     * Status presented while settings are unavailable.
     */
    readonly status: UnavailablePopupStatus;

    /**
     * Settings failure that made the projection unavailable.
     */
    readonly failure: SettingsStateFailure;
}

/**
 * Site-scope projection built from a loaded settings snapshot.
 */
export interface ReadySitesState {
    /**
     * Marks a projection built from a loaded settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.READY;

    /**
     * Settings revision the projection was built from.
     */
    readonly revision: number;

    /**
     * Whether the extension processes supported pages at all.
     */
    readonly globalEnabled: boolean;

    /**
     * Whether site preferences work as an exclusion or an allow list.
     */
    readonly scopeMode: SiteScopeMode;

    /**
     * Hostnames excluded while the exclusion mode is active.
     */
    readonly excludedSites: readonly string[];

    /**
     * Hostnames allowed while the allow-list mode is active.
     */
    readonly allowedSites: readonly string[];
}

/**
 * Fail-closed site-scope projection used when settings cannot be read safely.
 */
export interface UnavailableSitesState {
    /**
     * Marks a projection built without a usable settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.UNAVAILABLE;

    /**
     * Absent settings revision.
     */
    readonly revision: null;

    /**
     * Absent global activation setting.
     */
    readonly globalEnabled: null;

    /**
     * Absent site scope mode.
     */
    readonly scopeMode: null;

    /**
     * No exclusions are listed while settings are unavailable.
     */
    readonly excludedSites: readonly [];

    /**
     * No allowances are listed while settings are unavailable.
     */
    readonly allowedSites: readonly [];

    /**
     * Settings failure that made the projection unavailable.
     */
    readonly failure: SettingsStateFailure;
}

/**
 * Display-settings projection built from a loaded settings snapshot.
 */
export interface ReadyDisplayState {
    /**
     * Marks a projection built from a loaded settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.READY;

    /**
     * Settings revision the projection was built from.
     */
    readonly revision: number;

    /**
     * Committed display settings.
     */
    readonly display: DisplaySettings;

    /**
     * Appearance both extension surfaces render with.
     */
    readonly appearance: Appearance;

    /**
     * Whether diagnostic logging is enabled.
     */
    readonly debugEnabled: boolean;

    /**
     * Presentation error reported when the configured time zone is unavailable.
     */
    readonly error?: typeof UNAVAILABLE_TIME_ZONE_ERROR;
}

/**
 * Fail-closed display projection used when settings cannot be read safely.
 */
export interface UnavailableDisplayState {
    /**
     * Marks a projection built without a usable settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.UNAVAILABLE;

    /**
     * Absent settings revision.
     */
    readonly revision: null;

    /**
     * Absent display settings.
     */
    readonly display: null;

    /**
     * Default appearance used while settings are unavailable.
     */
    readonly appearance: Appearance;

    /**
     * Settings failure that made the projection unavailable.
     */
    readonly failure: SettingsStateFailure;
}

/**
 * Diagnostic-policy projection built from a loaded settings snapshot.
 */
export interface ReadyDebugState {
    /**
     * Marks a projection built from a loaded settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.READY;

    /**
     * Settings revision the projection was built from.
     */
    readonly revision: number;

    /**
     * Whether diagnostic logging is enabled.
     */
    readonly enabled: boolean;
}

/**
 * Fail-closed diagnostic projection used when settings cannot be read safely.
 */
export interface UnavailableDebugState {
    /**
     * Marks a projection built without a usable settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.UNAVAILABLE;

    /**
     * Absent settings revision.
     */
    readonly revision: null;

    /**
     * Absent diagnostic logging setting.
     */
    readonly enabled: null;

    /**
     * Settings failure that made the projection unavailable.
     */
    readonly failure: SettingsStateFailure;
}

/**
 * Complete ready or unavailable popup projection.
 */
export type PopupState = ReadyPopupState | UnavailablePopupState;

/**
 * Complete ready or unavailable site-scope projection.
 */
export type SitesState = ReadySitesState | UnavailableSitesState;

/**
 * Complete ready or unavailable display-settings projection.
 */
export type DisplayState = ReadyDisplayState | UnavailableDisplayState;

/**
 * Complete ready or unavailable diagnostic-policy projection.
 */
export type DebugState = ReadyDebugState | UnavailableDebugState;

/**
 * Exact tab-refresh failure reported after a settings update.
 */
export interface RefreshFailure {
    /**
     * Hostname of the tab that could not be refreshed.
     */
    readonly hostname: string;

    /**
     * Identifier of the tab that could not be refreshed, when known.
     */
    readonly tabId?: number | undefined;

    /**
     * Reason the tab could not be refreshed.
     */
    readonly reason: RefreshFailureReason;
}

/**
 * Builds the shared fail-closed popup projection used when settings cannot be read safely.
 *
 * @param failure - Settings failure that made the projection unavailable.
 * @param hostname - Active tab hostname, when it is still known.
 * @returns - Complete unavailable popup state.
 */
export function createUnavailablePopupState(
    failure: SettingsStateFailure = SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
    hostname: string | null = null,
): UnavailablePopupState {
    return {
        availability: STATE_AVAILABILITY.UNAVAILABLE,
        revision: null,
        globalEnabled: null,
        hostname,
        siteEnabled: null,
        scopeMode: null,
        appearance: APPEARANCE.SYSTEM,
        status: failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
            ? POPUP_STATUS.RUNTIME_FAILED
            : POPUP_STATUS.SETTINGS_UNAVAILABLE,
        failure,
    };
}

/**
 * Builds the fail-closed sites projection used when settings cannot be read safely.
 *
 * @param failure - Settings failure that made the projection unavailable.
 * @returns - Complete unavailable sites state.
 */
export function createUnavailableSitesState(
    failure: SettingsStateFailure = SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
): UnavailableSitesState {
    return {
        availability: STATE_AVAILABILITY.UNAVAILABLE,
        revision: null,
        globalEnabled: null,
        scopeMode: null,
        excludedSites: [],
        allowedSites: [],
        failure,
    };
}

/**
 * Builds the fail-closed display projection used when settings cannot be read safely.
 *
 * @param failure - Settings failure that made the projection unavailable.
 * @returns - Complete unavailable display state.
 */
export function createUnavailableDisplayState(
    failure: SettingsStateFailure = SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
): UnavailableDisplayState {
    return {
        availability: STATE_AVAILABILITY.UNAVAILABLE,
        revision: null,
        display: null,
        appearance: APPEARANCE.SYSTEM,
        failure,
    };
}

/**
 * Builds the fail-closed debug projection used when settings cannot be read safely.
 *
 * @param failure - Settings failure that made the projection unavailable.
 * @returns - Complete unavailable debug state.
 */
export function createUnavailableDebugState(
    failure: SettingsStateFailure = SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
): UnavailableDebugState {
    return {
        availability: STATE_AVAILABILITY.UNAVAILABLE,
        revision: null,
        enabled: null,
        failure,
    };
}
