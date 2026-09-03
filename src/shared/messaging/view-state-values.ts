/**
 * @file Canonical finite values and derived types used by background view-state contracts.
 */

/**
 * Named popup statuses shared by state producers, validators, and UI consumers.
 */
export const POPUP_STATUS = {
    ACTIVE: "active",
    GLOBAL_DISABLED: "global-disabled",
    SITE_EXCLUDED: "site-excluded",
    SITE_NOT_SELECTED: "site-not-selected",
    INACCESSIBLE: "inaccessible",
    RUNTIME_FAILED: "runtime-failed",
    SETTINGS_UNAVAILABLE: "settings-unavailable",
} as const;

/**
 * UI surfaces that request distinct site-setting projections.
 */
export const SITE_SETTINGS_SURFACE = {
    POPUP: "popup",
    SITES: "sites",
} as const;

/**
 * Availability discriminants shared by all state projections.
 */
export const STATE_AVAILABILITY = {
    READY: "ready",
    UNAVAILABLE: "unavailable",
} as const;

/**
 * Complete set of site-setting response surfaces.
 */
export const SITE_SETTINGS_SURFACES = [
    SITE_SETTINGS_SURFACE.POPUP,
    SITE_SETTINGS_SURFACE.SITES,
] as const;

/**
 * Popup statuses available when settings loaded successfully.
 */
export const POPUP_READY_STATUSES = [
    POPUP_STATUS.ACTIVE,
    POPUP_STATUS.GLOBAL_DISABLED,
    POPUP_STATUS.SITE_EXCLUDED,
    POPUP_STATUS.SITE_NOT_SELECTED,
    POPUP_STATUS.INACCESSIBLE,
    POPUP_STATUS.RUNTIME_FAILED,
] as const;

/**
 * Popup statuses available when settings could not be loaded safely.
 */
export const POPUP_UNAVAILABLE_STATUSES = [
    POPUP_STATUS.SETTINGS_UNAVAILABLE,
    POPUP_STATUS.RUNTIME_FAILED,
] as const;

/**
 * Named runtime failures that may accompany a ready popup projection.
 */
export const POPUP_RUNTIME_FAILURE = {
    CURRENT_TAB_QUERY: "current-tab-query",
    REGISTRATION: "registration",
    MATCHING_TABS_QUERY: "matching-tabs-query",
    CURRENT_TAB_INJECT: "current-tab-inject",
    CURRENT_TAB_TEARDOWN: "current-tab-teardown",
    DOCUMENT_STATUS: "document-status",
} as const;

/**
 * Complete runtime failure set accepted by the popup schema.
 */
export const POPUP_RUNTIME_FAILURES = [
    POPUP_RUNTIME_FAILURE.CURRENT_TAB_QUERY,
    POPUP_RUNTIME_FAILURE.REGISTRATION,
    POPUP_RUNTIME_FAILURE.MATCHING_TABS_QUERY,
    POPUP_RUNTIME_FAILURE.CURRENT_TAB_INJECT,
    POPUP_RUNTIME_FAILURE.CURRENT_TAB_TEARDOWN,
    POPUP_RUNTIME_FAILURE.DOCUMENT_STATUS,
] as const;

/**
 * Settings failures shared by unavailable view projections.
 */
export const SETTINGS_STATE_FAILURE = {
    SETTINGS_LOAD: "settings-load",
    FAIL_CLOSED_CLEANUP: "fail-closed-cleanup",
} as const;

/**
 * Complete settings failure set accepted by unavailable view projections.
 */
export const SETTINGS_STATE_FAILURES = [
    SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
    SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP,
] as const;

/**
 * Named errors shared by settings persistence commands.
 */
export const SETTINGS_PERSISTENCE_ERROR = {
    SAVE_FAILED: "save-failed",
    SETTINGS_UNAVAILABLE: "settings-unavailable",
} as const;

/**
 * Errors shared by settings persistence commands.
 */
export const SETTINGS_PERSISTENCE_ERRORS = [
    SETTINGS_PERSISTENCE_ERROR.SAVE_FAILED,
    SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE,
] as const;

/**
 * Named errors accepted by per-site settings commands.
 */
export const SITE_SETTINGS_ERROR = {
    ...SETTINGS_PERSISTENCE_ERROR,
    INVALID_HOSTNAME: "invalid-hostname",
    LIST_FULL: "list-full",
} as const;

/**
 * Errors accepted by per-site settings commands.
 */
export const SITE_SETTINGS_ERRORS = [
    ...SETTINGS_PERSISTENCE_ERRORS,
    SITE_SETTINGS_ERROR.INVALID_HOSTNAME,
    SITE_SETTINGS_ERROR.LIST_FULL,
] as const;

/**
 * Named errors accepted by display-settings commands.
 */
export const DISPLAY_SETTINGS_ERROR = {
    ...SETTINGS_PERSISTENCE_ERROR,
    INVALID_FORMAT: "invalid-format",
    INVALID_TIME_ZONE: "invalid-time-zone",
    INVALID_DISPLAY_SETTINGS: "invalid-display-settings",
} as const;

/**
 * Errors accepted by display-settings commands.
 */
export const DISPLAY_SETTINGS_ERRORS = [
    DISPLAY_SETTINGS_ERROR.INVALID_FORMAT,
    DISPLAY_SETTINGS_ERROR.INVALID_TIME_ZONE,
    DISPLAY_SETTINGS_ERROR.INVALID_DISPLAY_SETTINGS,
    ...SETTINGS_PERSISTENCE_ERRORS,
] as const;

/**
 * Named failure reasons reported when a matching tab cannot be refreshed.
 */
export const REFRESH_FAILURE_REASON = {
    MATCHING_TABS_QUERY: "matching-tabs-query",
    TAB_UPDATE: "tab-update",
} as const;

/**
 * Complete failure reason set accepted by refresh response schemas.
 */
export const REFRESH_FAILURE_REASONS = [
    REFRESH_FAILURE_REASON.MATCHING_TABS_QUERY,
    REFRESH_FAILURE_REASON.TAB_UPDATE,
] as const;

/**
 * Popup status available after settings load successfully.
 */
export type ReadyPopupStatus = (typeof POPUP_READY_STATUSES)[number];

/**
 * Popup status available while settings are unavailable.
 */
export type UnavailablePopupStatus = (typeof POPUP_UNAVAILABLE_STATUSES)[number];

/**
 * Runtime failure that may accompany a ready popup projection.
 */
export type PopupRuntimeFailure = (typeof POPUP_RUNTIME_FAILURES)[number];

/**
 * Settings failure shared by unavailable view projections.
 */
export type SettingsStateFailure = (typeof SETTINGS_STATE_FAILURES)[number];

/**
 * Error shared by settings persistence commands.
 */
export type SettingsPersistenceError = (typeof SETTINGS_PERSISTENCE_ERRORS)[number];

/**
 * Error accepted by per-site settings commands.
 */
export type SiteSettingsError = (typeof SITE_SETTINGS_ERRORS)[number];

/**
 * Error accepted by display-settings commands.
 */
export type DisplaySettingsError = (typeof DISPLAY_SETTINGS_ERRORS)[number];

/**
 * Failure reported when a matching tab cannot be refreshed.
 */
export type RefreshFailureReason = (typeof REFRESH_FAILURE_REASONS)[number];

/**
 * Availability and activation status presented for the active tab.
 */
export type PopupStatus = ReadyPopupStatus | UnavailablePopupStatus;

/**
 * UI surface whose site-setting projection is requested.
 */
export type SiteSettingsSurface = (typeof SITE_SETTINGS_SURFACES)[number];

/**
 * Availability discriminant for a state projection.
 */
export type StateAvailability = (typeof STATE_AVAILABILITY)[keyof typeof STATE_AVAILABILITY];

/**
 * Failure that prevents the popup from reporting normal active-tab status.
 */
export type PopupFailure = PopupRuntimeFailure | SettingsStateFailure;
