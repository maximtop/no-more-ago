/**
 * @file Public background view states and settings-command responses.
 */

import type { DisplaySettings } from "../settings/snapshot";

export type { DisplaySettings } from "../settings/snapshot";

/**
 * Availability and activation status presented for the active tab.
 */
export type PopupStatus =
    | "active"
    | "global-disabled"
    | "site-disabled"
    | "inaccessible"
    | "runtime-failed"
    | "no-rules"
    | "settings-unavailable";

/**
 * Failure that prevents the popup from reporting normal active-tab status.
 */
export type PopupFailure =
    | "current-tab-query"
    | "registration"
    | "matching-tabs-query"
    | "current-tab-inject"
    | "current-tab-teardown"
    | "document-status"
    | "settings-load"
    | "fail-closed-cleanup";

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
        readonly status: Exclude<PopupStatus, "settings-unavailable">;
        readonly failure?: Exclude<PopupFailure, "settings-load" | "fail-closed-cleanup">;
    }
    | {
        readonly availability: "unavailable";
        readonly revision: null;
        readonly globalEnabled: null;
        readonly hostname: string | null;
        readonly siteEnabled: null;
        readonly hasAdapter: false;
        readonly status: "settings-unavailable" | "runtime-failed";
        readonly failure: "settings-load" | "fail-closed-cleanup";
    };

/**
 * Result of changing the global activation setting, including the updated popup state.
 */
export type SetGlobalEnabledResponse =
    | { readonly ok: true; readonly acceptedRevision: number; readonly state: PopupState }
    | {
        readonly ok: false;
        readonly error: "save-failed" | "settings-unavailable";
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
        readonly failure: "settings-load" | "fail-closed-cleanup";
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
        readonly error: "save-failed" | "invalid-hostname" | "settings-unavailable";
        readonly surface: "popup";
        readonly state: PopupState;
    }
    | {
        readonly ok: false;
        readonly error: "save-failed" | "invalid-hostname" | "settings-unavailable";
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
        readonly error: "save-failed" | "settings-unavailable";
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
        readonly error?: "unavailable-time-zone";
    }
    | {
        readonly availability: "unavailable";
        readonly revision: null;
        readonly display: null;
        readonly failure: "settings-load" | "fail-closed-cleanup";
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
        readonly failure: "settings-load" | "fail-closed-cleanup";
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
        readonly error: "save-failed" | "settings-unavailable";
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
    readonly reason: "matching-tabs-query" | "tab-update";
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
    readonly reason: "matching-tabs-query" | "tab-update";
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
        readonly error:
              | "invalid-format"
              | "invalid-time-zone"
              | "invalid-display-settings"
              | "save-failed"
              | "settings-unavailable";
        readonly state: DisplayState;
    };
