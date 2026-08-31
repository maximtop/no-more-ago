/**
 * @file Minimal cross-world contract for trusted Facebook story timestamps.
 */

/**
 * Source marker retained on Facebook bridge messages.
 */
export const FACEBOOK_PAYLOAD_MESSAGE_SOURCE = "no-more-ago:facebook-payload" as const;

/**
 * Message type used when the main-world bridge finds story timestamp records.
 */
export const FACEBOOK_PAYLOAD_RECORDS_MESSAGE = "story-timestamp-records" as const;

/**
 * Message type emitted when the main-world bridge is ready for lifecycle control.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_READY_MESSAGE = "payload-bridge-ready" as const;

/**
 * Message type used by the isolated runtime to enable or disable bridge inspection.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE = "payload-bridge-control" as const;

/**
 * Legacy main-world singleton key retained only for one-way upgrade cleanup.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_LEGACY_SLOT_KEY =
    "no-more-ago.facebook-payload-bridge" as const;

/**
 * Current main-world singleton key shared with bridge tests and duplicate installations.
 */
export const FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY =
    "no-more-ago.facebook-payload-bridge-v3" as const;

/**
 * Facebook query parameter carrying an encrypted story tracking token.
 */
export const FACEBOOK_TRACKING_QUERY_PARAMETER = "__cft__[0]" as const;

/**
 * Facebook anchors that can carry the opaque Story timestamp association.
 */
export const FACEBOOK_TRACKED_LINK_SELECTOR = "a[href*='__cft__']" as const;

/**
 * Initial Facebook payload scripts eligible for bounded ingestion.
 */
export const FACEBOOK_PAYLOAD_SCRIPT_SELECTOR =
    "script[type='application/json'][data-sjs]" as const;

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

/**
 * Narrows an unknown value to an object carrying the shared Facebook message envelope.
 *
 * @param value - Candidate same-window message.
 * @param type - Expected message discriminant.
 * @returns - Whether source and type match the Facebook bridge contract.
 */
function isFacebookMessageEnvelope(
    value: unknown,
    type: string,
): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return candidate.source === FACEBOOK_PAYLOAD_MESSAGE_SOURCE
        && candidate.type === type;
}

/**
 * Validates one page-derived timestamp record at the isolated-world boundary.
 *
 * @param value - Candidate record supplied by a page message.
 * @returns - Whether the record has the bounded bridge shape.
 */
function isFacebookTimestampRecord(value: unknown): value is FacebookTimestampRecord {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return typeof candidate.trackingToken === "string"
        && candidate.trackingToken.length
            >= FACEBOOK_PAYLOAD_LIMIT.MIN_TRACKING_TOKEN_CHARACTERS
        && candidate.trackingToken.length
            <= FACEBOOK_PAYLOAD_LIMIT.MAX_TRACKING_TOKEN_CHARACTERS
        && typeof candidate.rawDatetime === "string"
        && FACEBOOK_UNIX_SECONDS.test(candidate.rawDatetime);
}

/**
 * Validates one bounded Facebook tracking token.
 *
 * @param value - Candidate token supplied by the page.
 * @returns - Whether the token fits the opaque association-key contract.
 */
function isTrackingToken(value: unknown): value is string {
    return typeof value === "string"
        && value.length >= FACEBOOK_PAYLOAD_LIMIT.MIN_TRACKING_TOKEN_CHARACTERS
        && value.length <= FACEBOOK_PAYLOAD_LIMIT.MAX_TRACKING_TOKEN_CHARACTERS;
}

/**
 * Validates an untrusted cross-world Facebook payload message.
 *
 * @param value - Candidate message supplied by the page.
 * @returns - Whether the message matches the bounded bridge contract.
 */
export function isFacebookPayloadMessage(value: unknown): value is FacebookPayloadMessage {
    if (!isFacebookMessageEnvelope(value, FACEBOOK_PAYLOAD_RECORDS_MESSAGE)) {
        return false;
    }
    if (
        !Array.isArray(value.records)
        || !Array.isArray(value.invalidatedTrackingTokens)
        || typeof value.invalidateAll !== "boolean"
        || !value.records.every(isFacebookTimestampRecord)
        || !value.invalidatedTrackingTokens.every(isTrackingToken)
    ) {
        return false;
    }
    return value.invalidateAll
        ? value.records.length === 0 && value.invalidatedTrackingTokens.length === 0
        : value.records.length + value.invalidatedTrackingTokens.length
            <= FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE;
}

/**
 * Validates an untrusted main-world bridge readiness message.
 *
 * @param value - Candidate message supplied by the page.
 * @returns - Whether the message announces the Facebook bridge.
 */
export function isFacebookPayloadBridgeReadyMessage(
    value: unknown,
): value is FacebookPayloadBridgeReadyMessage {
    return isFacebookMessageEnvelope(value, FACEBOOK_PAYLOAD_BRIDGE_READY_MESSAGE);
}

/**
 * Validates an untrusted isolated-world lifecycle command.
 *
 * @param value - Candidate message supplied by the page.
 * @returns - Whether the message carries a boolean bridge state.
 */
export function isFacebookPayloadBridgeControlMessage(
    value: unknown,
): value is FacebookPayloadBridgeControlMessage {
    return isFacebookMessageEnvelope(value, FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE)
        && typeof value.enabled === "boolean";
}

/**
 * Creates a bounded cross-world message from one extracted update.
 *
 * @param update - Valid records and invalidations to transfer into the isolated world.
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
