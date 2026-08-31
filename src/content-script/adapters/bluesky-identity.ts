/**
 * @file Shared validation for public Bluesky actors, record keys, and post URIs.
 */

const HANDLE_MAX_LENGTH = 253;
const HANDLE_LABEL_MAX_LENGTH = 63;
const DID_MAX_LENGTH = 2_048;
const RECORD_KEY_MAX_LENGTH = 512;
const HANDLE_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u;
const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
const RECORD_KEY_PATTERN = /^[A-Za-z0-9._~:-]+$/u;

/**
 * AT Protocol collection containing Bluesky post records.
 */
export const BLUESKY_POST_COLLECTION = "app.bsky.feed.post" as const;

const ESCAPED_POST_COLLECTION = BLUESKY_POST_COLLECTION.replaceAll(".", "\\.");
const POST_URI_PATTERN = new RegExp(
    `^at://([^/]+)/${ESCAPED_POST_COLLECTION}/([^/]+)$`,
    "u",
);

/**
 * Normalizes a valid DNS-style Bluesky handle.
 *
 * @param value - Untrusted handle value.
 * @returns - Lowercase handle, or null when invalid.
 */
export function normalizeBlueskyHandle(value: string): string | null {
    if (value.length > HANDLE_MAX_LENGTH || !value.includes(".")) {
        return null;
    }
    const labels = value.split(".");
    if (labels.some(
        (label) => label.length === 0
            || label.length > HANDLE_LABEL_MAX_LENGTH
            || !HANDLE_LABEL_PATTERN.test(label),
    )) {
        return null;
    }
    return value.toLowerCase();
}

/**
 * Checks one public decentralized identifier against the supported Bluesky contract.
 *
 * @param value - Untrusted DID value.
 * @returns - Whether the value is a bounded supported DID.
 */
export function isValidBlueskyDid(value: string): boolean {
    return value.length <= DID_MAX_LENGTH && DID_PATTERN.test(value);
}

/**
 * Normalizes an accepted public handle or preserves an accepted DID.
 *
 * @param value - Untrusted actor value.
 * @returns - Canonical public actor, or null when unsupported.
 */
export function normalizeBlueskyActor(value: string): string | null {
    return value.startsWith("did:")
        ? isValidBlueskyDid(value) ? value : null
        : normalizeBlueskyHandle(value);
}

/**
 * Checks one AT Protocol record key against the supported post contract.
 *
 * @param value - Untrusted record key.
 * @returns - Whether the value is bounded and unambiguous.
 */
export function isValidBlueskyRecordKey(value: string): boolean {
    return value.length <= RECORD_KEY_MAX_LENGTH && RECORD_KEY_PATTERN.test(value);
}

/**
 * Builds one canonical AT URI from a validated DID and post record key.
 *
 * @param did - Valid Bluesky DID.
 * @param recordKey - Valid post record key.
 * @returns - Canonical public Bluesky post URI.
 */
export function createBlueskyPostUri(did: string, recordKey: string): string {
    return `at://${did}/${BLUESKY_POST_COLLECTION}/${recordKey}`;
}

/**
 * Checks one canonical public Bluesky post URI.
 *
 * @param value - Untrusted AT URI.
 * @returns - Whether the URI contains a valid DID and post record key.
 */
export function isValidBlueskyPostUri(value: string): boolean {
    const match = POST_URI_PATTERN.exec(value);
    const did = match?.[1];
    const recordKey = match?.[2];
    return did !== undefined
        && recordKey !== undefined
        && isValidBlueskyDid(did)
        && isValidBlueskyRecordKey(recordKey);
}
