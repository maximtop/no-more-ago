/**
 * @file Valibot schemas for settings-command responses sent to extension views.
 */

import * as v from "valibot";
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
 * Result of changing global activation on either supported UI surface.
 */
export const setGlobalEnabledResponseSchema = v.union([
    v.strictObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.POPUP),
        state: popupStateSchema,
    }),
    v.strictObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.SITES),
        state: sitesStateSchema,
    }),
    v.strictObject({
        ok: v.literal(false),
        error: persistenceErrorSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.POPUP),
        state: popupStateSchema,
    }),
    v.strictObject({
        ok: v.literal(false),
        error: persistenceErrorSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.SITES),
        state: sitesStateSchema,
    }),
]);

/**
 * Result of changing one site's activation on either supported UI surface.
 */
export const setSiteEnabledResponseSchema = v.union([
    v.strictObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.POPUP),
        state: popupStateSchema,
    }),
    v.strictObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.SITES),
        state: sitesStateSchema,
    }),
    v.strictObject({
        ok: v.literal(false),
        error: sitePersistenceErrorSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.POPUP),
        state: popupStateSchema,
    }),
    v.strictObject({
        ok: v.literal(false),
        error: sitePersistenceErrorSchema,
        surface: v.literal(SITE_SETTINGS_SURFACE.SITES),
        state: sitesStateSchema,
    }),
]);

/**
 * Result of changing the active site scope mode.
 */
export const setSiteScopeModeResponseSchema = v.union([
    v.strictObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        state: sitesStateSchema,
    }),
    v.strictObject({
        ok: v.literal(false),
        error: persistenceErrorSchema,
        state: sitesStateSchema,
    }),
]);

/**
 * Result of changing display settings and refreshing matching tabs.
 */
export const setDisplaySettingsResponseSchema = v.union([
    v.strictObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        state: displayStateSchema,
        refreshFailures: refreshFailuresSchema,
    }),
    v.strictObject({
        ok: v.literal(false),
        error: v.picklist(DISPLAY_SETTINGS_ERRORS),
        state: displayStateSchema,
    }),
]);

/**
 * Result of changing the appearance applied to both surfaces.
 */
export const setAppearanceResponseSchema = v.union([
    v.strictObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        state: displayStateSchema,
    }),
    v.strictObject({
        ok: v.literal(false),
        error: persistenceErrorSchema,
        state: displayStateSchema,
    }),
]);

/**
 * Result of restoring all settings to their defaults.
 */
export const resetAllSettingsResponseSchema = v.union([
    v.strictObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        state: readySitesStateSchema,
    }),
    v.strictObject({
        ok: v.literal(false),
        error: persistenceErrorSchema,
        state: sitesStateSchema,
    }),
]);

/**
 * Result of changing diagnostic logging and refreshing matching tabs.
 */
export const setDebugEnabledResponseSchema = v.union([
    v.strictObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        state: debugStateSchema,
        refreshFailures: v.exactOptional(refreshFailuresSchema),
    }),
    v.strictObject({
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
 * Scope-mode response inferred from its runtime validation schema.
 */
export type SetSiteScopeModeResponse = v.InferOutput<typeof setSiteScopeModeResponseSchema>;

/**
 * Display settings response inferred from its runtime validation schema.
 */
export type SetDisplaySettingsResponse = v.InferOutput<typeof setDisplaySettingsResponseSchema>;

/**
 * Appearance response inferred from its runtime validation schema.
 */
export type SetAppearanceResponse = v.InferOutput<typeof setAppearanceResponseSchema>;

/**
 * Reset response inferred from its runtime validation schema.
 */
export type ResetAllSettingsResponse = v.InferOutput<typeof resetAllSettingsResponseSchema>;

/**
 * Diagnostic logging response inferred from its runtime validation schema.
 */
export type SetDebugEnabledResponse = v.InferOutput<typeof setDebugEnabledResponseSchema>;
