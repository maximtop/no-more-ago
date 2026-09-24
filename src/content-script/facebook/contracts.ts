/**
 * @file Minimal cross-world contract for trusted Facebook story timestamps.
 */

import * as v from 'valibot';

/**
 * Source marker retained on Facebook bridge messages.
 */
export const FACEBOOK_PAYLOAD_MESSAGE_SOURCE = 'no-more-ago:facebook-payload' as const;

/**
 * Message type used when the main-world bridge finds story timestamp records.
 */
export const FACEBOOK_PAYLOAD_RECORDS_MESSAGE = 'story-timestamp-records' as const;

/**
 * Message type emitted when the main-world bridge is ready for lifecycle control.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_READY_MESSAGE = 'payload-bridge-ready' as const;

/**
 * Message type used by the isolated runtime to enable or disable bridge inspection.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE = 'payload-bridge-control' as const;

/**
 * Legacy main-world singleton key retained only for one-way upgrade cleanup.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_LEGACY_SLOT_KEY = 'no-more-ago.facebook-payload-bridge' as const;

/**
 * Current main-world singleton key shared with bridge tests and duplicate installations.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY = 'no-more-ago.facebook-payload-bridge-v3' as const;

/**
 * Facebook query parameter carrying an encrypted story tracking token.
 */
export const FACEBOOK_TRACKING_QUERY_PARAMETER = '__cft__[0]' as const;

/**
 * Facebook anchors that can carry the opaque Story timestamp association.
 */
export const FACEBOOK_TRACKED_LINK_SELECTOR = "a[href*='__cft__']" as const;

/**
 * Initial Facebook payload scripts eligible for bounded ingestion.
 */
export const FACEBOOK_PAYLOAD_SCRIPT_SELECTOR = "script[type='application/json'][data-sjs]" as const;

/**
 * Bounded processing contract shared by Facebook payload boundaries.
 */
export const FACEBOOK_PAYLOAD_LIMIT = {
    MAX_CHARACTERS: 8_000_000,
    MAX_VISITED_VALUES: 250_000,
    MAX_STREAM_LINES: 10_000,
    MAX_RECORDS_PER_UPDATE: 1_000,
    MAX_ASSOCIATIONS_PER_DOCUMENT: 2_000,
    MIN_TRACKING_TOKEN_CHARACTERS: 20,
    MAX_TRACKING_TOKEN_CHARACTERS: 2_048,
} as const;

/**
 * Lexical Unix-seconds form admitted at the Facebook page boundary.
 */
export const FACEBOOK_UNIX_SECONDS = /^\d{1,12}$/u;

/**
 * Small trusted record extracted from one structured Facebook Story object.
 */
export interface FacebookTimestampRecord {
    /**
     * Opaque token shared by the Story payload and its timestamp link.
     */
    readonly trackingToken: string;

    /**
     * Page-provided Unix timestamp in seconds, retained for shared validation.
     */
    readonly rawDatetime: string;
}

/**
 * One bounded payload update, including associations invalidated by conflicts.
 */
export interface FacebookTimestampPayloadUpdate {
    /**
     * Conflict-free Story timestamp associations found in the payload.
     */
    readonly records: readonly FacebookTimestampRecord[];

    /**
     * Tracking tokens contradicted within the same payload.
     */
    readonly invalidatedTrackingTokens: readonly string[];

    /**
     * Whether bounded parsing failed and retained associations must be discarded.
     */
    readonly invalidateAll: boolean;
}

/**
 * Cross-world message emitted by the Facebook response bridge.
 */
export interface FacebookPayloadMessage extends FacebookTimestampPayloadUpdate {
    /**
     * Stable source marker used to reject unrelated page messages.
     */
    readonly source: typeof FACEBOOK_PAYLOAD_MESSAGE_SOURCE;

    /**
     * Stable payload-message discriminant.
     */
    readonly type: typeof FACEBOOK_PAYLOAD_RECORDS_MESSAGE;
}

/**
 * Main-world readiness notification used to converge either installation order.
 */
export interface FacebookPayloadBridgeReadyMessage {
    /**
     * Stable source marker used to reject unrelated page messages.
     */
    readonly source: typeof FACEBOOK_PAYLOAD_MESSAGE_SOURCE;

    /**
     * Stable bridge-ready discriminant.
     */
    readonly type: typeof FACEBOOK_PAYLOAD_BRIDGE_READY_MESSAGE;
}

/**
 * Isolated-world lifecycle command accepted by the main-world bridge.
 */
export interface FacebookPayloadBridgeControlMessage {
    /**
     * Stable source marker used to reject unrelated page messages.
     */
    readonly source: typeof FACEBOOK_PAYLOAD_MESSAGE_SOURCE;

    /**
     * Stable bridge-control discriminant.
     */
    readonly type: typeof FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE;

    /**
     * Whether selected response inspection may run.
     */
    readonly enabled: boolean;
}

const trackingTokenSchema = v.pipe(
    v.string(),
    v.minLength(FACEBOOK_PAYLOAD_LIMIT.MIN_TRACKING_TOKEN_CHARACTERS),
    v.maxLength(FACEBOOK_PAYLOAD_LIMIT.MAX_TRACKING_TOKEN_CHARACTERS),
);

/**
 * Bounded association a page message may transfer into the isolated world.
 */
const timestampRecordSchema = v.object({
    trackingToken: trackingTokenSchema,
    rawDatetime: v.pipe(v.string(), v.regex(FACEBOOK_UNIX_SECONDS)),
});

/**
 * Complete page-supplied payload message, bounded by the shared transfer limit.
 */
const payloadMessageSchema = v.pipe(
    v.object({
        source: v.literal(FACEBOOK_PAYLOAD_MESSAGE_SOURCE),
        type: v.literal(FACEBOOK_PAYLOAD_RECORDS_MESSAGE),
        records: v.array(timestampRecordSchema),
        invalidatedTrackingTokens: v.array(trackingTokenSchema),
        invalidateAll: v.boolean(),
    }),
    v.check((update) => (update.invalidateAll
        ? update.records.length === 0 && update.invalidatedTrackingTokens.length === 0
        : update.records.length + update.invalidatedTrackingTokens.length
            <= FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE)),
);

/**
 * Page-supplied announcement that a main-world bridge is installed.
 */
const bridgeReadyMessageSchema = v.object({
    source: v.literal(FACEBOOK_PAYLOAD_MESSAGE_SOURCE),
    type: v.literal(FACEBOOK_PAYLOAD_BRIDGE_READY_MESSAGE),
});

/**
 * Page-supplied lifecycle command accepted by the main-world bridge.
 */
const bridgeControlMessageSchema = v.object({
    source: v.literal(FACEBOOK_PAYLOAD_MESSAGE_SOURCE),
    type: v.literal(FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE),
    enabled: v.boolean(),
});

/**
 * Reads one bounded payload message posted by the page world.
 *
 * @param value - Message supplied by the page.
 *
 * @returns - Message with only contract fields retained, or null when unusable.
 */
export function readFacebookPayloadMessage(value: unknown): FacebookPayloadMessage | null {
    const parsed = v.safeParse(payloadMessageSchema, value);
    return parsed.success ? parsed.output : null;
}

/**
 * Reads one main-world bridge readiness announcement posted by the page world.
 *
 * @param value - Message supplied by the page.
 *
 * @returns - Whether the message announces the Facebook bridge.
 */
export function isFacebookPayloadBridgeReadyMessage(value: unknown): boolean {
    return v.is(bridgeReadyMessageSchema, value);
}

/**
 * Reads the requested inspection state from one page-posted lifecycle command.
 *
 * @param value - Message supplied by the page.
 *
 * @returns - Requested state, or null when the message is not a lifecycle command.
 */
export function readFacebookBridgeControlEnabled(value: unknown): boolean | null {
    const parsed = v.safeParse(bridgeControlMessageSchema, value);
    return parsed.success ? parsed.output.enabled : null;
}

/**
 * Creates a bounded cross-world message from one extracted update.
 *
 * @param update - Valid records and invalidations to transfer into the isolated world.
 *
 * @returns - Canonical Facebook payload message.
 */
export function createFacebookPayloadMessage(
    update: FacebookTimestampPayloadUpdate,
): FacebookPayloadMessage {
    return {
        source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
        type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
        records: update.records,
        invalidatedTrackingTokens: update.invalidatedTrackingTokens,
        invalidateAll: update.invalidateAll,
    };
}

/**
 * Creates the canonical main-world readiness notification.
 *
 * @returns - Facebook bridge readiness message.
 */
export function createFacebookPayloadBridgeReadyMessage(): FacebookPayloadBridgeReadyMessage {
    return {
        source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
        type: FACEBOOK_PAYLOAD_BRIDGE_READY_MESSAGE,
    };
}

/**
 * Creates one canonical isolated-world bridge lifecycle command.
 *
 * @param enabled - Whether selected response inspection may run.
 *
 * @returns - Facebook bridge control message.
 */
export function createFacebookPayloadBridgeControlMessage(
    enabled: boolean,
): FacebookPayloadBridgeControlMessage {
    return {
        source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
        type: FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE,
        enabled,
    };
}
