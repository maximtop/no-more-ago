/**
 * @file Valibot schema and type guard for document runtime state.
 */

import * as v from "valibot";

import { UNAVAILABLE_TIME_ZONE_ERROR } from "../date/presentation-errors";
import { isDisplaySettings, type DisplaySettings } from "../settings/snapshot";
import { strictMessageObject } from "./schema-utils";
import { nonNegativeSafeIntegerSchema } from "./view-state-schemas";
import {
    SETTINGS_STATE_FAILURES,
    STATE_AVAILABILITY,
} from "./view-state-values";

const readyDocumentStateSchema = strictMessageObject({
    availability: v.literal(STATE_AVAILABILITY.READY),
    revision: nonNegativeSafeIntegerSchema,
    enabled: v.boolean(),
    display: v.custom<DisplaySettings>(isDisplaySettings),
    debugEnabled: v.boolean(),
    error: v.exactOptional(v.literal(UNAVAILABLE_TIME_ZONE_ERROR)),
});

const unavailableDocumentStateSchema = strictMessageObject({
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
 * Validates an untrusted document runtime state through the canonical schema.
 *
 * @param value - Untrusted state value.
 * @returns - Whether the value is a valid document runtime state.
 */
export function isDocumentState(value: unknown): value is DocumentState {
    return v.safeParse(documentStateSchema, value).success;
}
