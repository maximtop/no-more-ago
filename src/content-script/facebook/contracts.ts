/**
 * @file Minimal cross-world contract for trusted Facebook story timestamps.
 */

import {
    FACEBOOK_BRIDGE_LEASE_ID,
    FACEBOOK_BRIDGE_SECRET,
} from "../../shared/messaging/facebook-bridge";

/**
 * Source marker retained on Facebook bridge messages.
 */
export const FACEBOOK_PAYLOAD_MESSAGE_SOURCE = "no-more-ago:facebook-payload" as const;

/**
 * Message type used when the main-world bridge finds story timestamp records.
 */
export const FACEBOOK_PAYLOAD_RECORDS_MESSAGE = "story-timestamp-records" as const;

/**
 * Facebook query parameter carrying an encrypted story tracking token.
 */
export const FACEBOOK_TRACKING_QUERY_PARAMETER = "__cft__[0]" as const;

/**
 * Facebook anchors that can carry the opaque Story timestamp association.
 */
export const FACEBOOK_TRACKED_LINK_SELECTOR = "a[href*='__cft__']" as const;

/**
 * Bounded processing contract shared by Facebook payload boundaries.
 */
export const FACEBOOK_PAYLOAD_LIMIT = {
    MAX_CHARACTERS: 8_000_000,
    MAX_VISITED_VALUES: 250_000,
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
 * Hexadecimal SHA-256 HMAC attached to one authenticated record message.
 */
const FACEBOOK_PAYLOAD_SIGNATURE = /^[\da-f]{64}$/u;

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
 * Cross-world message emitted by the Facebook response bridge.
 */
export interface FacebookPayloadMessage {
    /**
     * Stable source marker used to reject unrelated page messages.
     */
    readonly source: typeof FACEBOOK_PAYLOAD_MESSAGE_SOURCE;

    /**
     * Stable payload-message discriminant.
     */
    readonly type: typeof FACEBOOK_PAYLOAD_RECORDS_MESSAGE;

    /**
     * Browser-mediated lease that authenticated this message.
     */
    readonly leaseId: string;

    /**
     * Monotonic message identity within the lease, used to reject replay.
     */
    readonly sequence: number;

    /**
     * Bounded story timestamp records extracted in the main world.
     */
    readonly records: readonly FacebookTimestampRecord[];

    /**
     * HMAC over the complete canonical envelope and minimal records.
     */
    readonly signature: string;
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
 * Validates an untrusted cross-world Facebook payload message.
 *
 * @param value - Candidate message supplied by the page.
 * @returns - Whether the message matches the bounded bridge contract.
 */
export function isFacebookPayloadMessage(value: unknown): value is FacebookPayloadMessage {
    if (!isFacebookMessageEnvelope(value, FACEBOOK_PAYLOAD_RECORDS_MESSAGE)) {
        return false;
    }
    return typeof value.leaseId === "string"
        && FACEBOOK_BRIDGE_LEASE_ID.test(value.leaseId)
        && typeof value.sequence === "number"
        && Number.isSafeInteger(value.sequence)
        && value.sequence >= 0
        && Array.isArray(value.records)
        && value.records.length <= FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE
        && value.records.every(isFacebookTimestampRecord)
        && typeof value.signature === "string"
        && FACEBOOK_PAYLOAD_SIGNATURE.test(value.signature);
}

/**
 * Serializes the authenticated portion of one record message deterministically.
 *
 * @param leaseId - Browser-mediated lease identity.
 * @param sequence - Per-lease message identity.
 * @param records - Minimal Story timestamp records.
 * @returns - Canonical UTF-8 input for HMAC signing and verification.
 */
function facebookPayloadSignatureInput(
    leaseId: string,
    sequence: number,
    records: readonly FacebookTimestampRecord[],
): string {
    return JSON.stringify({
        source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
        type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
        leaseId,
        sequence,
        records,
    });
}

/**
 * Decodes a validated hexadecimal secret or signature.
 *
 * @param value - Even-length hexadecimal input.
 * @returns - Binary bytes represented by the input.
 */
function hexadecimalBytes(value: string): ArrayBuffer {
    const buffer = new ArrayBuffer(value.length / 2);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < value.length; index += 2) {
        bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
    }
    return buffer;
}

/**
 * Encodes binary HMAC bytes as lowercase hexadecimal.
 *
 * @param value - Binary signature bytes.
 * @returns - Two-character hexadecimal encoding for every byte.
 */
function hexadecimal(value: ArrayBuffer): string {
    return [...new Uint8Array(value)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Imports one internal per-lease secret as a Web Crypto HMAC key.
 *
 * @param secret - Background-generated 256-bit hexadecimal secret.
 * @param usage - Whether the key signs in MAIN or verifies in ISOLATED.
 * @returns - Imported non-extractable SHA-256 HMAC key.
 */
async function importFacebookPayloadKey(
    secret: string,
    usage: "sign" | "verify",
): Promise<CryptoKey> {
    if (!FACEBOOK_BRIDGE_SECRET.test(secret)) {
        throw new Error("Invalid Facebook bridge secret");
    }
    return crypto.subtle.importKey(
        "raw",
        hexadecimalBytes(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        [usage],
    );
}

/**
 * Creates one authenticated cross-world message from extracted Story records.
 *
 * @param records - Valid records to transfer into the isolated world.
 * @param leaseId - Browser-mediated lease identity.
 * @param sequence - Unique per-lease message identity.
 * @param secret - Per-lease HMAC secret unavailable to page scripts.
 * @returns - Canonical signed Facebook payload message.
 */
export async function createFacebookPayloadMessage(
    records: readonly FacebookTimestampRecord[],
    leaseId: string,
    sequence: number,
    secret: string,
): Promise<FacebookPayloadMessage> {
    const input = facebookPayloadSignatureInput(leaseId, sequence, records);
    const key = await importFacebookPayloadKey(secret, "sign");
    const signature = hexadecimal(await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(input),
    ));
    return {
        source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
        type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
        leaseId,
        sequence,
        records,
        signature,
    };
}

/**
 * Verifies that a structurally valid record message belongs to the active lease.
 *
 * @param message - Untrusted same-window record envelope.
 * @param secret - Isolated-world copy of the active per-lease HMAC secret.
 * @returns - Whether the complete canonical envelope has a valid signature.
 */
export async function verifyFacebookPayloadMessage(
    message: FacebookPayloadMessage,
    secret: string,
): Promise<boolean> {
    try {
        const key = await importFacebookPayloadKey(secret, "verify");
        return await crypto.subtle.verify(
            "HMAC",
            key,
            hexadecimalBytes(message.signature),
            new TextEncoder().encode(facebookPayloadSignatureInput(
                message.leaseId,
                message.sequence,
                message.records,
            )),
        );
    } catch {
        return false;
    }
}
