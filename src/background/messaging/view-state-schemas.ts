/**
 * @file Valibot schemas for background view states shared by response validators.
 */

import * as v from "valibot";
import { UNAVAILABLE_TIME_ZONE_ERROR } from "../../core/presentation-errors";
import { isDisplaySettings, type DisplaySettings } from "../../settings/snapshot";
import { strictMessageObject } from "./schema-utils";
import {
    POPUP_READY_STATUSES,
    POPUP_RUNTIME_FAILURES,
    POPUP_UNAVAILABLE_STATUSES,
    REFRESH_FAILURE_REASONS,
    SETTINGS_STATE_FAILURES,
} from "./view-state-values";

const revisionSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const settingsFailureSchema = v.picklist(SETTINGS_STATE_FAILURES);
const popupStatusSchema = v.picklist(POPUP_READY_STATUSES);
const popupFailureSchema = v.picklist(POPUP_RUNTIME_FAILURES);
const readyPopupStateSchema = strictMessageObject({
    availability: v.literal("ready"),
    revision: revisionSchema,
    globalEnabled: v.boolean(),
    hostname: v.nullable(v.string()),
    siteEnabled: v.nullable(v.boolean()),
    hasAdapter: v.boolean(),
    status: popupStatusSchema,
    failure: v.optional(popupFailureSchema),
});
const unavailablePopupStateSchema = strictMessageObject({
    availability: v.literal("unavailable"),
    revision: v.null(),
    globalEnabled: v.null(),
    hostname: v.nullable(v.string()),
    siteEnabled: v.null(),
    hasAdapter: v.literal(false),
    status: v.picklist(POPUP_UNAVAILABLE_STATUSES),
    failure: settingsFailureSchema,
});
const siteListEntrySchema = strictMessageObject({
    hostname: v.string(),
    enabled: v.boolean(),
    hasAdapter: v.boolean(),
});

/**
 * Complete ready site-preferences state accepted after a successful reset.
 */
export const readySitesStateSchema = strictMessageObject({
    availability: v.literal("ready"),
    revision: revisionSchema,
    globalEnabled: v.boolean(),
    sites: v.array(siteListEntrySchema),
});

const unavailableSitesStateSchema = strictMessageObject({
    availability: v.literal("unavailable"),
    revision: v.null(),
    globalEnabled: v.null(),
    sites: v.tuple([]),
    failure: settingsFailureSchema,
});
const readyDisplayStateSchema = strictMessageObject({
    availability: v.literal("ready"),
    revision: revisionSchema,
    display: v.custom<DisplaySettings>(isDisplaySettings),
    debugEnabled: v.boolean(),
    error: v.exactOptional(v.literal(UNAVAILABLE_TIME_ZONE_ERROR)),
});
const unavailableDisplayStateSchema = strictMessageObject({
    availability: v.literal("unavailable"),
    revision: v.null(),
    display: v.null(),
    failure: settingsFailureSchema,
});
const readyDebugStateSchema = strictMessageObject({
    availability: v.literal("ready"),
    revision: revisionSchema,
    enabled: v.boolean(),
});
const unavailableDebugStateSchema = strictMessageObject({
    availability: v.literal("unavailable"),
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
 * Complete ready or unavailable site-preferences projection.
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
export const refreshFailureSchema = strictMessageObject({
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
 * Site-list entry inferred from its runtime validation schema.
 */
export type SiteListEntry = v.InferOutput<typeof siteListEntrySchema>;

/**
 * Site preferences view inferred from its runtime validation schema.
 */
export type SitesState = v.InferOutput<typeof sitesStateSchema>;

/**
 * Display settings view inferred from its runtime validation schema.
 */
export type DisplayState = v.InferOutput<typeof displayStateSchema>;

/**
 * Diagnostic logging view inferred from its runtime validation schema.
 */
export type DebugState = v.InferOutput<typeof debugStateSchema>;

/**
 * Per-tab refresh failure inferred from its runtime validation schema.
 */
export type RefreshFailure = v.InferOutput<typeof refreshFailureSchema>;
