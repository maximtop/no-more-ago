/**
 * @file Extracts minimal timestamp records from structured Facebook Story payloads.
 */

import {
    FACEBOOK_PAYLOAD_LIMIT,
    FACEBOOK_UNIX_SECONDS,
    type FacebookTimestampRecord,
} from "./contracts";

const FACEBOOK_STORY_TYPENAME = "Story" as const;
const XSSI_PREFIX = "for (;;);" as const;

/**
 * Removes the Facebook cross-site script inclusion prefix from one JSON document.
 *
 * @param value - Candidate serialized JSON document.
 * @returns - Trimmed document without the optional prefix.
 */
function stripXssiPrefix(value: string): string {
    const trimmed = value.trim();
    return trimmed.startsWith(XSSI_PREFIX)
        ? trimmed.slice(XSSI_PREFIX.length).trim()
        : trimmed;
}

/**
 * Parses either one JSON document or Facebook's newline-delimited response stream.
 *
 * @param payloadText - Page-provided response or script payload.
 * @returns - Successfully parsed JSON roots.
 */
function parsePayloadRoots(payloadText: string): readonly unknown[] {
    const normalized = stripXssiPrefix(payloadText);
    if (normalized === "") {
        return [];
    }
    try {
        return [JSON.parse(normalized) as unknown];
    } catch {
        const roots: unknown[] = [];
        for (const line of normalized.split(/\r?\n/u)) {
            const document = stripXssiPrefix(line);
            if (document === "") {
                continue;
            }
            try {
                roots.push(JSON.parse(document) as unknown);
            } catch {
                /* malformed stream entries cannot establish a trusted timestamp */
            }
        }
        return roots;
    }
}

/**
 * Narrows a parsed JSON value to a non-array object.
 *
 * @param value - Parsed JSON value to inspect.
 * @returns - Whether the value is an object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalizes a Story creation time while preserving shared Unix-seconds validation.
 *
 * @param value - Story creation_time field.
 * @returns - Decimal seconds text, or null when the field cannot be eligible.
 */
function rawCreationTime(value: unknown): string | null {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return String(value);
    }
    return typeof value === "string" && FACEBOOK_UNIX_SECONDS.test(value) ? value : null;
}

/**
 * Checks whether a page-derived encrypted tracking value is safely bounded.
 *
 * @param value - Candidate encrypted_click_tracking field.
 * @returns - Whether the value can be retained as an opaque mapping key.
 */
function isTrackingToken(value: unknown): value is string {
    return typeof value === "string"
        && value.length >= FACEBOOK_PAYLOAD_LIMIT.MIN_TRACKING_TOKEN_CHARACTERS
        && value.length <= FACEBOOK_PAYLOAD_LIMIT.MAX_TRACKING_TOKEN_CHARACTERS;
}

/**
 * One pending JSON value and the nearest structurally proven Story timestamp.
 */
interface TraversalEntry {
    /**
     * Parsed JSON value to inspect.
     */
    readonly value: unknown;

    /**
     * Timestamp inherited from the nearest Story ancestor.
     */
    readonly storyTime: string | null;
}

/**
 * Extracts bounded, conflict-free Story timestamps from a Facebook JSON payload.
 *
 * Records are keyed by the encrypted tracking token also carried by Facebook's
 * timestamp link. Conflicting timestamps for one token are discarded.
 *
 * @param payloadText - Serialized initial-page or GraphQL payload.
 * @returns - Minimal records suitable for cross-world transfer and DOM matching.
 */
export function extractFacebookTimestampRecords(
    payloadText: string,
): readonly FacebookTimestampRecord[] {
    if (
        payloadText.length === 0
        || payloadText.length > FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS
        || !payloadText.includes("creation_time")
        || !payloadText.includes("encrypted_click_tracking")
        || !payloadText.includes(FACEBOOK_STORY_TYPENAME)
    ) {
        return [];
    }
    const stack: TraversalEntry[] = parsePayloadRoots(payloadText).map((value) => ({
        value,
        storyTime: null,
    }));
    const records = new Map<string, FacebookTimestampRecord>();
    const conflicts = new Set<string>();
    let visited = 0;
    while (stack.length > 0 && visited < FACEBOOK_PAYLOAD_LIMIT.MAX_VISITED_VALUES) {
        const entry = stack.pop();
        if (!entry) {
            break;
        }
        const { value } = entry;
        visited += 1;
        if (Array.isArray(value)) {
            for (const child of value) {
                stack.push({ value: child, storyTime: entry.storyTime });
            }
            continue;
        }
        if (!isRecord(value)) {
            continue;
        }
        const storyTime = value.__typename === FACEBOOK_STORY_TYPENAME
            ? rawCreationTime(value.creation_time)
            : entry.storyTime;
        const trackingToken = value.encrypted_click_tracking;
        if (storyTime !== null && isTrackingToken(trackingToken) && !conflicts.has(trackingToken)) {
            const candidate = { trackingToken, rawDatetime: storyTime };
            const existing = records.get(candidate.trackingToken);
            if (existing && existing.rawDatetime !== candidate.rawDatetime) {
                records.delete(candidate.trackingToken);
                conflicts.add(candidate.trackingToken);
            } else if (
                !existing
                && records.size < FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE
            ) {
                records.set(candidate.trackingToken, candidate);
            }
        }
        for (const child of Object.values(value)) {
            stack.push({ value: child, storyTime });
        }
    }
    return [...records.values()];
}
