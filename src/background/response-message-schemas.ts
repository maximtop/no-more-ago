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
    refreshFailureSchema,
    sitesStateSchema,
} from "./view-state-schemas";
import {
    DISPLAY_SETTINGS_ERRORS,
    SETTINGS_PERSISTENCE_ERRORS,
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
        surface: v.literal("popup"),
        state: popupStateSchema,
    }),
    strictMessageObject({
        ok: v.literal(true),
        acceptedRevision: nonNegativeSafeIntegerSchema,
        surface: v.literal("sites"),
        state: sitesStateSchema,
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: sitePersistenceErrorSchema,
        surface: v.literal("popup"),
        state: popupStateSchema,
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: sitePersistenceErrorSchema,
        surface: v.literal("sites"),
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
        refreshFailures: v.array(refreshFailureSchema),
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
        refreshFailures: v.exactOptional(v.array(refreshFailureSchema)),
    }),
    strictMessageObject({
        ok: v.literal(false),
        error: persistenceErrorSchema,
        state: debugStateSchema,
    }),
]);
