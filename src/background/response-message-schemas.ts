/**
 * @file Valibot schemas for settings-command responses sent to extension views.
 */

import * as v from "valibot";
import { strictMessageObject } from "./message-schema-utils";
import {
    debugStateSchema,
    displayStateSchema,
    nonNegativeSafeIntegerSchema,
    popupStateSchema,
    readySitesStateSchema,
    refreshFailuresSchema,
    sitesStateSchema,
} from "./view-state-schemas";
import {
    DISPLAY_SETTINGS_ERRORS,
    SETTINGS_PERSISTENCE_ERRORS,
    SITE_SETTINGS_SURFACE,
    SITE_SETTINGS_ERRORS,
} from "./view-state-values";

const persistenceErrorSchema = v.picklist(SETTINGS_PERSISTENCE_ERRORS);
const sitePersistenceErrorSchema = v.picklist(SITE_SETTINGS_ERRORS);

/**
 * Result of changing global activation.
 */
export const setGlobalEnabledResponseSchema = v.union([
    strictMessageObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        state: popupStateSchema,
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: persistenceErrorSchema,
        state: popupStateSchema,
    }),
]);

/**
 * Result of changing one site's activation on either supported UI surface.
 */
export const setSiteEnabledResponseSchema = v.union([
    strictMessageObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.POPUP),
        state: popupStateSchema,
    }),
    strictMessageObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.SITES),
        state: sitesStateSchema,
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: sitePersistenceErrorSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.POPUP),
        state: popupStateSchema,
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: sitePersistenceErrorSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.SITES),
        state: sitesStateSchema,
    }),
]);

/**
 * Result of changing display settings and refreshing matching tabs.
 */
export const setDisplaySettingsResponseSchema = v.union([
    strictMessageObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        state: displayStateSchema,
        refreshFailures: refreshFailuresSchema,
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: v.picklist(DISPLAY_SETTINGS_ERRORS),
        state: displayStateSchema,
    }),
]);

/**
 * Result of restoring all settings to their defaults.
 */
export const resetAllSettingsResponseSchema = v.union([
    strictMessageObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        state: readySitesStateSchema,
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: persistenceErrorSchema,
        state: sitesStateSchema,
    }),
]);

/**
 * Result of changing diagnostic logging and refreshing matching tabs.
 */
export const setDebugEnabledResponseSchema = v.union([
    strictMessageObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        state: debugStateSchema,
        refreshFailures: v.exactOptional(refreshFailuresSchema),
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: persistenceErrorSchema,
        state: debugStateSchema,
    }),
]);

/**
 * Global activation response inferred from its runtime validation schema.
 */
export type SetGlobalEnabledResponse = v.InferOutput<typeof setGlobalEnabledResponseSchema>;

/**
 * Site activation response inferred from its runtime validation schema.
 */
export type SetSiteEnabledResponse = v.InferOutput<typeof setSiteEnabledResponseSchema>;

/**
 * Display settings response inferred from its runtime validation schema.
 */
export type SetDisplaySettingsResponse = v.InferOutput<typeof setDisplaySettingsResponseSchema>;

/**
 * Reset response inferred from its runtime validation schema.
 */
export type ResetAllSettingsResponse = v.InferOutput<typeof resetAllSettingsResponseSchema>;

/**
 * Diagnostic logging response inferred from its runtime validation schema.
 */
export type SetDebugEnabledResponse = v.InferOutput<typeof setDebugEnabledResponseSchema>;
