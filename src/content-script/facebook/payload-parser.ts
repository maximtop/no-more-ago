/**
 * @file Extracts minimal timestamp records from structured Facebook Story payloads.
 */

import * as v from "valibot";

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
 * Page-derived encrypted tracking value bounded enough to retain as an opaque mapping key.
 */
const trackingTokenSchema = v.pipe(
    v.string(),
    v.minLength(FACEBOOK_PAYLOAD_LIMIT.MIN_TRACKING_TOKEN_CHARACTERS),
    v.maxLength(FACEBOOK_PAYLOAD_LIMIT.MAX_TRACKING_TOKEN_CHARACTERS),
);

/**
 * Story creation time normalized to decimal seconds text under the shared Unix-seconds contract.
 */
const creationTimeSchema = v.union([
    v.pipe(
        v.number(),
        v.safeInteger(),
        v.minValue(0),
        v.transform((seconds) => String(seconds)),
    ),
    v.pipe(v.string(), v.regex(FACEBOOK_UNIX_SECONDS)),
]);

/**
 * Story fields the parser reads; a missing or unbounded token is skipped, not fatal.
 *
 * Arbitrary descendants are deliberately excluded: comment, media, Reel, actor,
 * and accessibility objects can carry tracking tokens without representing the
 * parent post timestamp. Only the direct Story token and the canonical
 * timestamp-section token are read.
 */
const storySchema = v.object({
    __typename: v.literal(FACEBOOK_STORY_TYPENAME),
    creation_time: creationTimeSchema,
    encrypted_click_tracking: v.fallback(v.optional(trackingTokenSchema), undefined),
    comet_sections: v.fallback(
        v.optional(v.object({
            timestamp: v.object({
                story: v.object({ encrypted_click_tracking: trackingTokenSchema }),
            }),
        })),
        undefined,
    ),
});

/**
 * Typed Story retaining only the proven timestamp fields.
 */
type FacebookStory = v.InferOutput<typeof storySchema>;

/**
 * Any payload object whose values are walked; page-authored keys pass through untouched.
 */
const payloadNodeSchema = v.looseObject({});

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
 * Returns tokens proven to represent the Story or its post timestamp section.
 *
 * @param story - Typed Story with its own creation time.
 * @returns - Direct Story and canonical timestamp-section tokens.
 */
function storyTimestampTokens(story: FacebookStory): readonly string[] {
    const tokens: string[] = [];
    if (story.encrypted_click_tracking !== undefined) {
        tokens.push(story.encrypted_click_tracking);
    }
    const timestampToken = story.comet_sections?.timestamp.story.encrypted_click_tracking;
    if (timestampToken !== undefined) {
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
            const node = v.safeParse(payloadNodeSchema, value);
            if (!node.success) {
                continue;
            }
            if (node.output.__typename === FACEBOOK_STORY_TYPENAME) {
                const story = v.safeParse(storySchema, node.output);
                if (story.success) {
                    const storyTime = story.output.creation_time;
                    for (const trackingToken of storyTimestampTokens(story.output)) {
                        if (!retainRecord(records, conflicts, trackingToken, storyTime)) {
                            return false;
                        }
                    }
                }
            }
            const children = Object.values(node.output);
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
