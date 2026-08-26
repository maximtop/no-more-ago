/**
 * @file Safe strict-object schema construction for untrusted runtime messages.
 */

import * as v from "valibot";

/**
 * Creates a strict object schema that rejects inherited fields and accessors before parsing.
 *
 * @param entries - Valibot schemas for every accepted own property.
 * @returns - Strict schema guarded against prototype and accessor input.
 */
export function strictMessageObject<const Entries extends v.ObjectEntries>(entries: Entries) {
    const schema = v.strictObject(entries);
    return v.pipe(
        v.custom<v.InferInput<typeof schema>>((input) => hasSafeProperties(input, entries)),
        schema,
    );
}

/**
 * Checks that schema fields are own data properties and no enumerable field is inherited.
 *
 * @param input - Untrusted candidate object.
 * @param entries - Schema entries whose inherited presence must be rejected.
 * @returns - Whether the candidate is safe to pass to an object schema.
 */
function hasSafeProperties(input: unknown, entries: v.ObjectEntries): boolean {
    try {
        if (typeof input !== "object" || input === null || Array.isArray(input)) {
            return false;
        }
        if ("toJSON" in input) {
            return false;
        }
        for (const key of Object.keys(entries)) {
            if (key in input && !Object.hasOwn(input, key)) {
                return false;
            }
        }
        for (const key in input) {
            if (!Object.hasOwn(input, key)) {
                return false;
            }
        }
        return Object.keys(input).every((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(input, key);
            return descriptor !== undefined && Object.hasOwn(descriptor, "value");
        });
    } catch {
        return false;
    }
}
