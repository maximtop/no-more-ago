/**
 * @file Valibot schema and type guard for document runtime state.
 */

import * as v from "valibot";

import { UNAVAILABLE_TIME_ZONE_ERROR } from "../date/presentation-errors";
import type { DisplaySettings } from "../settings/snapshot";
import { nonNegativeSafeIntegerSchema } from "./view-state";
import {
    SETTINGS_STATE_FAILURES,
    STATE_AVAILABILITY,
} from "./view-state-values";

const readyDocumentStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.READY),
    revision: nonNegativeSafeIntegerSchema,
    enabled: v.boolean(),
    display: v.pipe(
        v.unknown(),
        v.transform<unknown, DisplaySettings>((value) => value as DisplaySettings),
    ),
    debugEnabled: v.boolean(),
    error: v.exactOptional(v.literal(UNAVAILABLE_TIME_ZONE_ERROR)),
});

const unavailableDocumentStateSchema = v.strictObject({
    availability: v.literal(STATE_AVAILABILITY.UNAVAILABLE),
    revision: v.null(),
    enabled: v.literal(false),
    display: v.null(),
    debugEnabled: v.literal(false),
    failure: v.picklist(SETTINGS_STATE_FAILURES),
});

/**
 * Complete ready or unavailable document runtime state.
 */
export const documentStateSchema = v.union([
    readyDocumentStateSchema,
    unavailableDocumentStateSchema,
]);

/**
 * Document runtime state inferred from its validation schema.
 */
export type DocumentState = v.InferOutput<typeof documentStateSchema>;

/**
 * Recognizes the routing fields of a document runtime state.
 *
 * @param value - Runtime state value.
 * @returns - Whether the value matches a document runtime state variant.
 */
export function isDocumentState(value: unknown): value is DocumentState {
    return v.safeParse(documentStateSchema, value).success;
}
