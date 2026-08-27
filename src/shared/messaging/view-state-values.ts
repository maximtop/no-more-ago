/**
 * @file Canonical finite values and derived types used by background view-state contracts.
 */

/**
 * Named popup statuses shared by state producers, validators, and UI consumers.
 */
export const POPUP_STATUS = {
    ACTIVE: "active",
    GLOBAL_DISABLED: "global-disabled",
    SITE_DISABLED: "site-disabled",
    INACCESSIBLE: "inaccessible",
    RUNTIME_FAILED: "runtime-failed",
    NO_RULES: "no-rules",
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
    POPUP_STATUS.SITE_DISABLED,
    POPUP_STATUS.INACCESSIBLE,
    POPUP_STATUS.RUNTIME_FAILED,
    POPUP_STATUS.NO_RULES,
] as const;

/**
 * Popup statuses available when settings could not be loaded safely.
 */
export const POPUP_UNAVAILABLE_STATUSES = [
    POPUP_STATUS.SETTINGS_UNAVAILABLE,
    POPUP_STATUS.RUNTIME_FAILED,
] as const;

/**
 * Runtime failures that may accompany a ready popup projection.
 */
export const POPUP_RUNTIME_FAILURES = [
    "current-tab-query",
    "registration",
    "matching-tabs-query",
    "current-tab-inject",
    "current-tab-teardown",
    "document-status",
] as const;

/**
 * Settings failures shared by unavailable view projections.
 */
export const SETTINGS_STATE_FAILURES = ["settings-load", "fail-closed-cleanup"] as const;

/**
 * Errors shared by settings persistence commands.
 */
export const SETTINGS_PERSISTENCE_ERRORS = ["save-failed", "settings-unavailable"] as const;

/**
 * Additional semantic error accepted by per-site settings commands.
 */
export const SITE_SETTINGS_ERRORS = [
    ...SETTINGS_PERSISTENCE_ERRORS,
    "invalid-hostname",
] as const;

/**
 * Errors accepted by display-settings commands.
 */
export const DISPLAY_SETTINGS_ERRORS = [
    "invalid-format",
    "invalid-time-zone",
    "invalid-display-settings",
    ...SETTINGS_PERSISTENCE_ERRORS,
] as const;

/**
 * Failure reasons reported when a matching tab cannot be refreshed.
 */
export const REFRESH_FAILURE_REASONS = ["matching-tabs-query", "tab-update"] as const;

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
 * Failure that prevents the popup from reporting normal active-tab status.
 */
export type PopupFailure = PopupRuntimeFailure | SettingsStateFailure;
