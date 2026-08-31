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
    invalidateAll: false,
};

const INVALIDATE_ALL_FACEBOOK_TIMESTAMP_UPDATE: FacebookTimestampPayloadUpdate = {
    records: [],
    invalidatedTrackingTokens: [],
    invalidateAll: true,
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
 * Visits either one JSON document or a bounded newline-delimited response stream.
 *
 * @param payloadText - Page-provided response or script payload.
 * @param visit - Visitor returning false when traversal must fail closed.
 * @returns - Whether parsing and every root traversal stayed within bounds.
 */
function visitPayloadRoots(
    payloadText: string,
    visit: (root: unknown) => boolean,
): boolean {
    const normalized = stripXssiPrefix(payloadText);
    if (normalized === "") {
        return true;
    }
    try {
        return visit(JSON.parse(normalized) as unknown);
    } catch {
        /* Facebook also returns newline-delimited JSON documents. */
    }
    let lineStart = 0;
    let lineCount = 0;
    while (lineStart <= normalized.length) {
        lineCount += 1;
        if (lineCount > FACEBOOK_PAYLOAD_LIMIT.MAX_STREAM_LINES) {
            return false;
        }
        const newline = normalized.indexOf("\n", lineStart);
        const lineEnd = newline === -1 ? normalized.length : newline;
        const line = normalized.slice(
            lineStart,
            lineEnd > lineStart && normalized[lineEnd - 1] === "\r"
                ? lineEnd - 1
                : lineEnd,
        );
        const document = stripXssiPrefix(line);
        if (document !== "") {
            try {
                if (!visit(JSON.parse(document) as unknown)) {
                    return false;
                }
            } catch {
                /* malformed stream entries cannot establish a trusted timestamp */
            }
        }
        if (newline === -1) {
            return true;
        }
        lineStart = newline + 1;
    }
    return true;
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
 * @returns - Whether the complete update remains representable within the bound.
 */
function retainRecord(
    records: Map<string, FacebookTimestampRecord>,
    conflicts: Set<string>,
    trackingToken: string,
    storyTime: string,
): boolean {
    if (conflicts.has(trackingToken)) {
        return true;
    }
    const existing = records.get(trackingToken);
    if (existing && existing.rawDatetime !== storyTime) {
        records.delete(trackingToken);
        conflicts.add(trackingToken);
        return true;
    }
    if (existing) {
        return true;
    }
    if (records.size + conflicts.size >= FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE) {
        return false;
    }
    records.set(trackingToken, { trackingToken, rawDatetime: storyTime });
    return true;
}

/**
 * Pushes children without a variadic call that could exceed the engine argument limit.
 *
 * @param stack - Traversal stack receiving children.
 * @param children - Parsed child values in document order.
 */
function pushChildren(stack: unknown[], children: readonly unknown[]): void {
    for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index]);
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
    const completed = visitPayloadRoots(payloadText, (root) => {
        const stack: unknown[] = [root];
        while (stack.length > 0) {
            if (visited >= FACEBOOK_PAYLOAD_LIMIT.MAX_VISITED_VALUES) {
                return false;
            }
            const value = stack.pop();
            visited += 1;
            if (Array.isArray(value)) {
                const children = value as readonly unknown[];
                const remaining = FACEBOOK_PAYLOAD_LIMIT.MAX_VISITED_VALUES
                    - visited
                    - stack.length;
                if (children.length > remaining) {
                    return false;
                }
                pushChildren(stack, children);
                continue;
            }
            if (!isRecord(value)) {
                continue;
            }
            if (value.__typename === FACEBOOK_STORY_TYPENAME) {
                const storyTime = rawCreationTime(value.creation_time);
                if (storyTime !== null) {
                    for (const trackingToken of storyTimestampTokens(value)) {
                        if (!retainRecord(records, conflicts, trackingToken, storyTime)) {
                            return false;
                        }
                    }
                }
            }
            const children = Object.values(value);
            const remaining = FACEBOOK_PAYLOAD_LIMIT.MAX_VISITED_VALUES
                - visited
                - stack.length;
            if (children.length > remaining) {
                return false;
            }
            pushChildren(stack, children);
        }
        return true;
    });
    if (!completed) {
        return INVALIDATE_ALL_FACEBOOK_TIMESTAMP_UPDATE;
    }
    return {
        records: [...records.values()],
        invalidatedTrackingTokens: [...conflicts],
        invalidateAll: false,
    };
}
