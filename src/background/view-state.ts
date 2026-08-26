/**
 * @file Public background view states and settings-command responses.
 */

import type { DisplaySettings } from "../settings/snapshot";
import { UNAVAILABLE_TIME_ZONE_ERROR } from "../core/presentation-errors";
import type {
    DisplaySettingsError,
    PopupRuntimeFailure,
    ReadyPopupStatus,
    RefreshFailureReason,
    SettingsPersistenceError,
    SettingsStateFailure,
    SiteSettingsError,
    UnavailablePopupStatus,
} from "./view-state-values";

export type { DisplaySettings } from "../settings/snapshot";
export { UNAVAILABLE_TIME_ZONE_ERROR } from "../core/presentation-errors";
export type {
    DisplaySettingsError,
    PopupFailure,
    PopupRuntimeFailure,
    PopupStatus,
    ReadyPopupStatus,
    RefreshFailureReason,
    SettingsPersistenceError,
    SettingsStateFailure,
    SiteSettingsError,
    UnavailablePopupStatus,
} from "./view-state-values";

/**
 * Popup view of settings and runtime state for the active tab.
 */
export type PopupState =
    | {
        readonly availability: "ready";
        readonly revision: number;
        readonly globalEnabled: boolean;
        readonly hostname: string | null;
        readonly siteEnabled: boolean | null;
        readonly hasAdapter: boolean;
        readonly status: ReadyPopupStatus;
        readonly failure?: PopupRuntimeFailure;
    }
    | {
        readonly availability: "unavailable";
        readonly revision: null;
        readonly globalEnabled: null;
        readonly hostname: string | null;
        readonly siteEnabled: null;
        readonly hasAdapter: false;
        readonly status: UnavailablePopupStatus;
        readonly failure: SettingsStateFailure;
    };

/**
 * Result of changing the global activation setting, including the updated popup state.
 */
export type SetGlobalEnabledResponse =
    | { readonly ok: true; readonly acceptedRevision: number; readonly state: PopupState }
    | {
        readonly ok: false;
        readonly error: SettingsPersistenceError;
        readonly state: PopupState;
    };

/**
 * A hostname shown in the site preferences list.
 */
export interface SiteListEntry {
    /**
     * Hostname whose preference is shown.
     */
    readonly hostname: string;

    /**
     * Whether timestamp rendering is enabled for this hostname.
     */
    readonly enabled: boolean;

    /**
     * Whether a runtime adapter supports this hostname.
     */
    readonly hasAdapter: boolean;
}

/**
 * Site-preferences view returned to the extension UI.
 */
export type SitesState =
    | {
        readonly availability: "ready";
        readonly revision: number;
        readonly globalEnabled: boolean;
        readonly sites: readonly SiteListEntry[];
    }
    | {
        readonly availability: "unavailable";
        readonly revision: null;
        readonly globalEnabled: null;
        readonly sites: readonly [];
        readonly failure: SettingsStateFailure;
    };

/**
 * Result of changing one site's activation setting and refreshing its source surface.
 */
export type SetSiteEnabledResponse =
    | {
        readonly ok: true;
        readonly acceptedRevision: number;
        readonly surface: "popup";
        readonly state: PopupState;
    }
    | {
        readonly ok: true;
        readonly acceptedRevision: number;
        readonly surface: "sites";
        readonly state: SitesState;
    }
    | {
        readonly ok: false;
        readonly error: SiteSettingsError;
        readonly surface: "popup";
        readonly state: PopupState;
    }
    | {
        readonly ok: false;
        readonly error: SiteSettingsError;
        readonly surface: "sites";
        readonly state: SitesState;
    };

/**
 * Result of restoring all settings to their defaults.
 */
export type ResetAllSettingsResponse =
    | {
        readonly ok: true;
        readonly acceptedRevision: number;
        readonly state: Extract<SitesState, { readonly availability: "ready" }>;
    }
    | {
        readonly ok: false;
        readonly error: SettingsPersistenceError;
        readonly state: SitesState;
    };

/**
 * Current display configuration and its time-zone availability.
 */
export type DisplayState =
    | {
        readonly availability: "ready";
        readonly revision: number;
        readonly display: DisplaySettings;
        readonly debugEnabled: boolean;
        readonly error?: typeof UNAVAILABLE_TIME_ZONE_ERROR;
    }
    | {
        readonly availability: "unavailable";
        readonly revision: null;
        readonly display: null;
        readonly failure: SettingsStateFailure;
    };

/**
 * Current diagnostic logging setting.
 */
export type DebugState =
    | { readonly availability: "ready"; readonly revision: number; readonly enabled: boolean }
    | {
        readonly availability: "unavailable";
        readonly revision: null;
        readonly enabled: null;
        readonly failure: SettingsStateFailure;
    };

/**
 * Result of changing diagnostic logging, including tabs that could not be updated.
 */
export type SetDebugEnabledResponse =
    | {
        readonly ok: true;
        readonly acceptedRevision: number;
        readonly state: DebugState;
        readonly refreshFailures?: readonly DebugRefreshFailure[];
    }
    | {
        readonly ok: false;
        readonly error: SettingsPersistenceError;
        readonly state: DebugState;
    };

/**
 * A tab that did not acknowledge a diagnostic-policy update.
 */
export interface DebugRefreshFailure {
    /**
     * Adapter hostname whose matching tab could not be updated.
     */
    readonly hostname: string;

    /**
     * Identifier of the tab that failed, when tab discovery succeeded.
     */
    readonly tabId?: number;

    /**
     * Whether tab discovery or the per-tab message failed.
     */
    readonly reason: RefreshFailureReason;
}

/**
 * A tab that did not acknowledge a display-settings update.
 */
export interface DisplayRefreshFailure {
    /**
     * Adapter hostname whose matching tab could not be updated.
     */
    readonly hostname: string;

    /**
     * Identifier of the tab that failed, when tab discovery succeeded.
     */
    readonly tabId?: number;

    /**
     * Whether tab discovery or the per-tab message failed.
     */
    readonly reason: RefreshFailureReason;
}

/**
 * Result of changing display settings, including tabs that could not be refreshed.
 */
export type SetDisplaySettingsResponse =
    | {
        readonly ok: true;
        readonly acceptedRevision: number;
        readonly state: DisplayState;
        readonly refreshFailures: readonly DisplayRefreshFailure[];
    }
    | {
        readonly ok: false;
        readonly error: DisplaySettingsError;
        readonly state: DisplayState;
    };
