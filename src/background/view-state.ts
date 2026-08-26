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
 * Fields shared by every view state backed by an available settings snapshot.
 */
interface ReadyViewState {
    /**
     * Indicates that settings were loaded successfully.
     */
    readonly availability: "ready";

    /**
     * Authoritative settings revision represented by the view.
     */
    readonly revision: number;
}

/**
 * Fields shared by every view state produced while settings are unavailable.
 */
interface UnavailableViewState {
    /**
     * Indicates that settings could not be loaded safely.
     */
    readonly availability: "unavailable";

    /**
     * Absence of an authoritative settings revision.
     */
    readonly revision: null;

    /**
     * Stable failure that prevented a ready settings view.
     */
    readonly failure: SettingsStateFailure;
}

/**
 * Common successful result returned by a settings mutation command.
 */
interface SuccessfulSettingsCommand<State> {
    /**
     * Indicates that the requested mutation completed successfully.
     */
    readonly ok: true;

    /**
     * Settings revision accepted by the command.
     */
    readonly acceptedRevision: number;

    /**
     * Authoritative view state after the mutation.
     */
    readonly state: State;
}

/**
 * Common failed result returned by a settings mutation command.
 */
interface FailedSettingsCommand<ErrorCode, State> {
    /**
     * Indicates that the requested mutation failed safely.
     */
    readonly ok: false;

    /**
     * Stable reason the settings mutation failed.
     */
    readonly error: ErrorCode;

    /**
     * Last authoritative view state retained after the failure.
     */
    readonly state: State;
}

/**
 * Successful settings mutation projected for one extension UI surface.
 */
interface SuccessfulSurfaceCommand<Surface, State> extends SuccessfulSettingsCommand<State> {
    /**
     * UI surface whose state shape is returned.
     */
    readonly surface: Surface;
}

/**
 * Failed settings mutation projected for one extension UI surface.
 */
interface FailedSurfaceCommand<Surface, ErrorCode, State>
    extends FailedSettingsCommand<ErrorCode, State> {
    /**
     * UI surface whose fallback state shape is returned.
     */
    readonly surface: Surface;
}

/**
 * Active-tab popup projection backed by available settings.
 */
interface ReadyPopupState extends ReadyViewState {
    /**
     * Whether timestamp replacement is globally enabled.
     */
    readonly globalEnabled: boolean;

    /**
     * Canonical active-tab hostname, or null for inaccessible tabs.
     */
    readonly hostname: string | null;

    /**
     * Effective site setting, or null when no hostname is available.
     */
    readonly siteEnabled: boolean | null;

    /**
     * Whether a runtime adapter supports the active hostname.
     */
    readonly hasAdapter: boolean;

    /**
     * Current activation status shown by the popup.
     */
    readonly status: ReadyPopupStatus;

    /**
     * Runtime failure associated with the active tab, when present.
     */
    readonly failure?: PopupRuntimeFailure;
}

/**
 * Fail-closed popup projection produced without trustworthy settings.
 */
interface UnavailablePopupState extends UnavailableViewState {
    /**
     * Absence of a trustworthy global setting.
     */
    readonly globalEnabled: null;

    /**
     * Canonical active-tab hostname when it could still be determined.
     */
    readonly hostname: string | null;

    /**
     * Absence of a trustworthy site setting.
     */
    readonly siteEnabled: null;

    /**
     * Adapters are treated as unavailable while settings fail closed.
     */
    readonly hasAdapter: false;

    /**
     * Unavailable status shown by the popup.
     */
    readonly status: UnavailablePopupStatus;
}

/**
 * Popup view of settings and runtime state for the active tab.
 */
export type PopupState = ReadyPopupState | UnavailablePopupState;

/**
 * Result of changing the global activation setting, including the updated popup state.
 */
export type SetGlobalEnabledResponse =
    | SuccessfulSettingsCommand<PopupState>
    | FailedSettingsCommand<SettingsPersistenceError, PopupState>;

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
 * Site-preferences projection backed by available settings.
 */
interface ReadySitesState extends ReadyViewState {
    /**
     * Whether timestamp replacement is globally enabled.
     */
    readonly globalEnabled: boolean;

    /**
     * Known site preferences and adapter availability.
     */
    readonly sites: readonly SiteListEntry[];
}

/**
 * Fail-closed site-preferences projection.
 */
interface UnavailableSitesState extends UnavailableViewState {
    /**
     * Absence of a trustworthy global setting.
     */
    readonly globalEnabled: null;

    /**
     * Empty list returned instead of untrusted site preferences.
     */
    readonly sites: readonly [];
}

/**
 * Site-preferences view returned to the extension UI.
 */
export type SitesState = ReadySitesState | UnavailableSitesState;

/**
 * Result of changing one site's activation setting and refreshing its source surface.
 */
export type SetSiteEnabledResponse =
    | SuccessfulSurfaceCommand<"popup", PopupState>
    | SuccessfulSurfaceCommand<"sites", SitesState>
    | FailedSurfaceCommand<"popup", SiteSettingsError, PopupState>
    | FailedSurfaceCommand<"sites", SiteSettingsError, SitesState>;

/**
 * Result of restoring all settings to their defaults.
 */
export type ResetAllSettingsResponse =
    | SuccessfulSettingsCommand<ReadySitesState>
    | FailedSettingsCommand<SettingsPersistenceError, SitesState>;

/**
 * Display-settings projection backed by available settings.
 */
interface ReadyDisplayState extends ReadyViewState {
    /**
     * Active timestamp presentation settings.
     */
    readonly display: DisplaySettings;

    /**
     * Whether diagnostic logging is currently enabled.
     */
    readonly debugEnabled: boolean;

    /**
     * Runtime presentation warning associated with the saved settings.
     */
    readonly error?: typeof UNAVAILABLE_TIME_ZONE_ERROR;
}

/**
 * Fail-closed display-settings projection.
 */
interface UnavailableDisplayState extends UnavailableViewState {
    /**
     * Absence of trustworthy display settings.
     */
    readonly display: null;
}

/**
 * Current display configuration and its time-zone availability.
 */
export type DisplayState = ReadyDisplayState | UnavailableDisplayState;

/**
 * Diagnostic-policy projection backed by available settings.
 */
interface ReadyDebugState extends ReadyViewState {
    /**
     * Whether bounded diagnostic logging is enabled.
     */
    readonly enabled: boolean;
}

/**
 * Fail-closed diagnostic-policy projection.
 */
interface UnavailableDebugState extends UnavailableViewState {
    /**
     * Absence of a trustworthy diagnostic logging setting.
     */
    readonly enabled: null;
}

/**
 * Current diagnostic logging setting.
 */
export type DebugState = ReadyDebugState | UnavailableDebugState;

/**
 * Successful diagnostic-policy update with optional per-tab refresh failures.
 */
interface SuccessfulDebugSettingsCommand extends SuccessfulSettingsCommand<DebugState> {
    /**
     * Matching tabs that did not acknowledge the new diagnostic policy.
     */
    readonly refreshFailures?: readonly DebugRefreshFailure[];
}

/**
 * Result of changing diagnostic logging, including tabs that could not be updated.
 */
export type SetDebugEnabledResponse =
    | SuccessfulDebugSettingsCommand
    | FailedSettingsCommand<SettingsPersistenceError, DebugState>;

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
 * Successful display-settings update with required per-tab refresh results.
 */
interface SuccessfulDisplaySettingsCommand extends SuccessfulSettingsCommand<DisplayState> {
    /**
     * Matching tabs that did not acknowledge the new presentation settings.
     */
    readonly refreshFailures: readonly DisplayRefreshFailure[];
}

/**
 * Result of changing display settings, including tabs that could not be refreshed.
 */
export type SetDisplaySettingsResponse =
    | SuccessfulDisplaySettingsCommand
    | FailedSettingsCommand<DisplaySettingsError, DisplayState>;
