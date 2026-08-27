/**
 * @file Public background view-state types inferred from Valibot schemas.
 */

export type { DisplaySettings } from "../settings/snapshot";
export { UNAVAILABLE_TIME_ZONE_ERROR } from "../date/presentation-errors";
export type {
    DebugState,
    DisplayState,
    PopupState,
    SiteListEntry,
    SitesState,
} from "./view-state-schemas";
export type {
    ResetAllSettingsResponse,
    SetDebugEnabledResponse,
    SetDisplaySettingsResponse,
    SetGlobalEnabledResponse,
    SetSiteEnabledResponse,
} from "./response-schemas";
export type { RefreshFailure as DebugRefreshFailure } from "./view-state-schemas";
export type { RefreshFailure as DisplayRefreshFailure } from "./view-state-schemas";
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
