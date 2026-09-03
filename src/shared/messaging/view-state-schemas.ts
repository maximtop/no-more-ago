/**
 * @file Valibot schemas for background view states shared by response validators.
 */

import * as v from "valibot";
import { UNAVAILABLE_TIME_ZONE_ERROR } from "../date/presentation-errors";
import { APPEARANCE, APPEARANCES, type DisplaySettings } from "../settings/snapshot";
import { SITE_SCOPE_MODES } from "../settings/site-scope";
import {
    POPUP_READY_STATUSES,
    POPUP_RUNTIME_FAILURES,
    POPUP_UNAVAILABLE_STATUSES,
    REFRESH_FAILURE_REASONS,
    SETTINGS_STATE_FAILURES,
    STATE_AVAILABILITY,
    SETTINGS_STATE_FAILURE,
    POPUP_STATUS,
    type SettingsStateFailure,
} from "./view-state-values";

const revisionSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const settingsFailureSchema = v.picklist(SETTINGS_STATE_FAILURES);
const popupStatusSchema = v.picklist(POPUP_READY_STATUSES);
const popupFailureSchema = v.picklist(POPUP_RUNTIME_FAILURES);
const scopeModeSchema = v.picklist(SITE_SCOPE_MODES);
const appearanceSchema = v.picklist(APPEARANCES);
const hostnameListSchema = v.pipe(v.array(v.string()), v.readonly());
const readyPopupStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.READY),
    revision: revisionSchema,
    globalEnabled: v.boolean(),
    hostname: v.nullable(v.string()),
    siteEnabled: v.nullable(v.boolean()),
    scopeMode: scopeModeSchema,
    appearance: appearanceSchema,
    status: popupStatusSchema,
    failure: v.optional(popupFailureSchema),
});
const unavailablePopupStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.UNAVAILABLE),
    revision: v.null(),
    globalEnabled: v.null(),
    hostname: v.nullable(v.string()),
    siteEnabled: v.null(),
    scopeMode: v.null(),
    appearance: appearanceSchema,
    status: v.picklist(POPUP_UNAVAILABLE_STATUSES),
    failure: settingsFailureSchema,
});

/**
 * Complete ready site-scope state accepted after a successful reset.
 */
export const readySitesStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.READY),
    revision: revisionSchema,
    globalEnabled: v.boolean(),
    scopeMode: scopeModeSchema,
    excludedSites: hostnameListSchema,
    allowedSites: hostnameListSchema,
});

const unavailableSitesStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.UNAVAILABLE),
    revision: v.null(),
    globalEnabled: v.null(),
    scopeMode: v.null(),
    excludedSites: v.tuple([]),
    allowedSites: v.tuple([]),
    failure: settingsFailureSchema,
});
const readyDisplayStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.READY),
    revision: revisionSchema,
    display: v.pipe(
        v.unknown(),
        v.transform<unknown, DisplaySettings>((value) => value as DisplaySettings),
    ),
    appearance: appearanceSchema,
    debugEnabled: v.boolean(),
    error: v.exactOptional(v.literal(UNAVAILABLE_TIME_ZONE_ERROR)),
});
const unavailableDisplayStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.UNAVAILABLE),
    revision: v.null(),
    display: v.null(),
    appearance: appearanceSchema,
    failure: settingsFailureSchema,
});
const readyDebugStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.READY),
    revision: revisionSchema,
    enabled: v.boolean(),
});
const unavailableDebugStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.UNAVAILABLE),
    revision: v.null(),
    enabled: v.null(),
    failure: settingsFailureSchema,
});

/**
 * Non-negative safe integer used for settings revisions and discovered tab identifiers.
 */
export const nonNegativeSafeIntegerSchema = revisionSchema;

/**
 * Complete ready or unavailable popup projection.
 */
export const popupStateSchema = v.union([
    readyPopupStateSchema,
    unavailablePopupStateSchema,
]);

/**
 * Complete ready or unavailable site-scope projection.
 */
export const sitesStateSchema = v.union([
    readySitesStateSchema,
    unavailableSitesStateSchema,
]);

/**
 * Complete ready or unavailable display-settings projection.
 */
export const displayStateSchema = v.union([
    readyDisplayStateSchema,
    unavailableDisplayStateSchema,
]);

/**
 * Complete ready or unavailable diagnostic-policy projection.
 */
export const debugStateSchema = v.union([
    readyDebugStateSchema,
    unavailableDebugStateSchema,
]);

/**
 * Exact tab-refresh failure reported after a settings update.
 */
export const refreshFailureSchema = v.strictObject({
    hostname: v.string(),
    tabId: v.optional(nonNegativeSafeIntegerSchema),
    reason: v.picklist(REFRESH_FAILURE_REASONS),
});

/**
 * Immutable collection of tab-refresh failures returned by settings commands.
 */
export const refreshFailuresSchema = v.pipe(
    v.array(refreshFailureSchema),
    v.readonly(),
);

/**
 * Popup view inferred from its runtime validation schema.
 */
export type PopupState = v.InferOutput<typeof popupStateSchema>;

/**
 * Popup view while settings are available.
 */
export type ReadyPopupState = v.InferOutput<typeof readyPopupStateSchema>;

/**
 * Popup view while settings are unavailable.
 */
export type UnavailablePopupState = v.InferOutput<typeof unavailablePopupStateSchema>;

/**
 * Site scope view inferred from its runtime validation schema.
 */
export type SitesState = v.InferOutput<typeof sitesStateSchema>;

/**
 * Site scope view while settings are unavailable.
 */
export type UnavailableSitesState = v.InferOutput<typeof unavailableSitesStateSchema>;

/**
 * Display settings view inferred from its runtime validation schema.
 */
export type DisplayState = v.InferOutput<typeof displayStateSchema>;

/**
 * Display settings view while settings are unavailable.
 */
export type UnavailableDisplayState = v.InferOutput<typeof unavailableDisplayStateSchema>;

/**
 * Diagnostic logging view inferred from its runtime validation schema.
 */
export type DebugState = v.InferOutput<typeof debugStateSchema>;

/**
 * Diagnostic logging view while settings are unavailable.
 */
export type UnavailableDebugState = v.InferOutput<typeof unavailableDebugStateSchema>;

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

/**
 * Per-tab refresh failure inferred from its runtime validation schema.
 */
export type RefreshFailure = v.InferOutput<typeof refreshFailureSchema>;
