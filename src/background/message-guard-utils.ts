/**
 * @file Shared structural helpers for background message guards.
 */

/**
 * Recognizes a non-array object suitable for message-shape validation.
 *
 * @param value - Untrusted message value.
 * @returns - Whether the value is a non-array object record.
 */
export function isMessageRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
