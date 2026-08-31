/**
 * @file Extracts minimal timestamp records from structured Facebook Story payloads.
 */

import {
    FACEBOOK_PAYLOAD_LIMIT,
    FACEBOOK_UNIX_SECONDS,
    type FacebookTimestampPayloadUpdate,
    type FacebookTimestampRecord,
} from "./contracts";

const EMPTY_FACEBOOK_TIMESTAMP_UPDATE: FacebookTimestampPayloadUpdate = {
    records: [],
    invalidatedTrackingTokens: [],
};

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
 * Lazily parses either one JSON document or Facebook's newline-delimited response stream.
 *
 * @param payloadText - Page-provided response or script payload.
 * @returns - Successfully parsed JSON roots in document order.
 */
function* parsePayloadRoots(payloadText: string) {
    const normalized = stripXssiPrefix(payloadText);
    if (normalized === "") {
        return;
    }
    try {
        yield JSON.parse(normalized) as unknown;
        return;
    } catch {
        for (const line of normalized.split(/\r?\n/u)) {
            const document = stripXssiPrefix(line);
            if (document === "") {
                continue;
            }
            try {
                yield JSON.parse(document) as unknown;
            } catch {
                /* malformed stream entries cannot establish a trusted timestamp */
            }
        }
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
 * Reads a nested object property without accepting arrays.
 *
 * @param value - Candidate parent record.
 * @param property - Direct property to read.
 * @returns - Nested record, or null when the path is not an object path.
 */
function nestedRecord(
    value: Record<string, unknown>,
    property: string,
): Record<string, unknown> | null {
    const nested = value[property];
    return isRecord(nested) ? nested : null;
}

/**
 * Returns tokens proven to represent the Story or its post timestamp section.
 *
 * Arbitrary descendants are deliberately excluded: comment, media, Reel, actor,
 * and accessibility objects can carry tracking tokens without representing the
 * parent post timestamp.
 *
 * @param story - Typed Story with its own creation time.
 * @returns - Direct Story and canonical timestamp-section tokens.
 */
function storyTimestampTokens(story: Record<string, unknown>): readonly string[] {
    const tokens: string[] = [];
    if (isTrackingToken(story.encrypted_click_tracking)) {
        tokens.push(story.encrypted_click_tracking);
    }
    const cometSections = nestedRecord(story, "comet_sections");
    const timestamp = cometSections && nestedRecord(cometSections, "timestamp");
    const timestampStory = timestamp && nestedRecord(timestamp, "story");
    const timestampToken = timestampStory?.encrypted_click_tracking;
    if (isTrackingToken(timestampToken)) {
        tokens.push(timestampToken);
    }
    return tokens;
}

/**
 * Retains one conflict-free association within the record transfer bound.
 *
 * @param records - Available associations collected so far.
 * @param conflicts - Tokens already invalidated by contradictory timestamps.
 * @param trackingToken - Proven Story timestamp token.
 * @param storyTime - Story-owned Unix-seconds value.
 */
function retainRecord(
    records: Map<string, FacebookTimestampRecord>,
    conflicts: Set<string>,
    trackingToken: string,
    storyTime: string,
): void {
    if (conflicts.has(trackingToken)) {
        return;
    }
    const existing = records.get(trackingToken);
    if (existing && existing.rawDatetime !== storyTime) {
        records.delete(trackingToken);
        conflicts.add(trackingToken);
    } else if (
        !existing
        && records.size + conflicts.size < FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE
    ) {
        records.set(trackingToken, { trackingToken, rawDatetime: storyTime });
    }
}

/**
 * Extracts a bounded Story timestamp update from one Facebook JSON payload.
 *
 * @param payloadText - Serialized initial-page or GraphQL payload.
 * @returns - Conflict-free records plus tokens contradicted within the payload.
 */
export function extractFacebookTimestampUpdate(
    payloadText: string,
): FacebookTimestampPayloadUpdate {
    if (
        payloadText.length === 0
        || payloadText.length > FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS
        || !payloadText.includes("creation_time")
        || !payloadText.includes("encrypted_click_tracking")
        || !payloadText.includes(FACEBOOK_STORY_TYPENAME)
    ) {
        return EMPTY_FACEBOOK_TIMESTAMP_UPDATE;
    }
    const records = new Map<string, FacebookTimestampRecord>();
    const conflicts = new Set<string>();
    let visited = 0;
    for (const root of parsePayloadRoots(payloadText)) {
        const stack: unknown[] = [root];
        while (stack.length > 0) {
            if (visited >= FACEBOOK_PAYLOAD_LIMIT.MAX_VISITED_VALUES) {
                return EMPTY_FACEBOOK_TIMESTAMP_UPDATE;
            }
            const value = stack.pop();
            visited += 1;
            if (Array.isArray(value)) {
                const children = value as readonly unknown[];
                const remaining = FACEBOOK_PAYLOAD_LIMIT.MAX_VISITED_VALUES
                    - visited
                    - stack.length;
                if (children.length > remaining) {
                    return EMPTY_FACEBOOK_TIMESTAMP_UPDATE;
                }
                stack.push(...children);
                continue;
            }
            if (!isRecord(value)) {
                continue;
            }
            if (value.__typename === FACEBOOK_STORY_TYPENAME) {
                const storyTime = rawCreationTime(value.creation_time);
                if (storyTime !== null) {
                    for (const trackingToken of storyTimestampTokens(value)) {
                        retainRecord(records, conflicts, trackingToken, storyTime);
                    }
                }
            }
            const children = Object.values(value);
            const remaining = FACEBOOK_PAYLOAD_LIMIT.MAX_VISITED_VALUES
                - visited
                - stack.length;
            if (children.length > remaining) {
                return EMPTY_FACEBOOK_TIMESTAMP_UPDATE;
            }
            stack.push(...children);
        }
    }
    return {
        records: [...records.values()],
        invalidatedTrackingTokens: [...conflicts],
    };
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
    return extractFacebookTimestampUpdate(payloadText).records;
}
