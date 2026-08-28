/**
 * @file Safe strict-object schema construction for untrusted runtime messages.
 */

import * as v from "valibot";

/**
 * Creates a strict object schema for extension runtime messages.
 *
 * @param entries - Valibot schemas for every accepted own property.
 * @returns - Strict schema that rejects undeclared message properties.
 */
export function strictMessageObject<const Entries extends v.ObjectEntries>(entries: Entries) {
    return v.strictObject(entries);
}
