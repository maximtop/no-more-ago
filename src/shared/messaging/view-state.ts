/**
 * @file Background view states projected for the popup and options surfaces.
 */

import type { UNAVAILABLE_TIME_ZONE_ERROR } from "../date/presentation-errors";
import type { DisplaySettings } from "../settings/snapshot";
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
interface ReadyPopupState {
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
interface UnavailablePopupState {
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
     * Active tab hostname, or null when no supported page is open.
     */
    readonly hostname: string | null;

    /**
     * Absent per-site activation setting.
     */
    readonly siteEnabled: null;

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
 * One hostname listed on the options page with its activation setting.
 */
export interface SiteListEntry {
    /**
     * Canonical hostname the preference applies to.
     */
    readonly hostname: string;

    /**
     * Whether processing is enabled for the hostname.
     */
    readonly enabled: boolean;
}

/**
 * Site-preferences projection built from a loaded settings snapshot.
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
     * Explicit per-site preferences, sorted by hostname.
     */
    readonly sites: readonly SiteListEntry[];
}

/**
 * Fail-closed site-preferences projection used when settings cannot be read.
 */
interface UnavailableSitesState {
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
     * No preferences are listed while settings are unavailable.
     */
    readonly sites: readonly [];

    /**
     * Settings failure that made the projection unavailable.
     */
    readonly failure: SettingsStateFailure;
}

/**
 * Display-settings projection built from a loaded settings snapshot.
 */
interface ReadyDisplayState {
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
interface UnavailableDisplayState {
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
     * Settings failure that made the projection unavailable.
     */
    readonly failure: SettingsStateFailure;
}

/**
 * Diagnostic-policy projection built from a loaded settings snapshot.
 */
interface ReadyDebugState {
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
interface UnavailableDebugState {
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
 * Complete ready or unavailable site-preferences projection.
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
 * @returns - Complete unavailable popup state.
 */
export function createUnavailablePopupState(
    failure: SettingsStateFailure = SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
): PopupState {
    return {
        availability: STATE_AVAILABILITY.UNAVAILABLE,
        revision: null,
        globalEnabled: null,
        hostname: null,
        siteEnabled: null,
        status: failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
            ? POPUP_STATUS.RUNTIME_FAILED
            : POPUP_STATUS.SETTINGS_UNAVAILABLE,
        failure,
    };
}
