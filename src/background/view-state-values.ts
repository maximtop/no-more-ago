/**
 * @file Canonical finite values and derived types used by background view-state contracts.
 */

/**
 * Popup statuses available when settings loaded successfully.
 */
export const POPUP_READY_STATUSES = [
    "active",
    "global-disabled",
    "site-disabled",
    "inaccessible",
    "runtime-failed",
    "no-rules",
] as const;

/**
 * Popup statuses available when settings could not be loaded safely.
 */
export const POPUP_UNAVAILABLE_STATUSES = ["settings-unavailable", "runtime-failed"] as const;

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
 * Failure that prevents the popup from reporting normal active-tab status.
 */
export type PopupFailure = PopupRuntimeFailure | SettingsStateFailure;
