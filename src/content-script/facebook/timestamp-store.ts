/**
 * @file Stores Facebook Story timestamps and maps them to exact page-owned links.
 */

import {
    FACEBOOK_PAYLOAD_LIMIT,
    FACEBOOK_TRACKING_QUERY_PARAMETER,
    type FacebookTimestampRecord,
} from "./contracts";
import { extractFacebookTimestampRecords } from "./payload-parser";

const FACEBOOK_TIMESTAMP_SELECTOR = "a[href*='__cft__']" as const;
const FACEBOOK_PAYLOAD_SCRIPT_SELECTOR = "script[type='application/json'][data-sjs]" as const;

/**
 * Observable association changes consumed by targeted Facebook reconciliation.
 */
export const FACEBOOK_TIMESTAMP_RECORD_CHANGE = {
    AVAILABLE: "available",
    INVALIDATED: "invalidated",
} as const;

/**
 * One change to the availability of a bounded Facebook timestamp association.
 */
export interface FacebookTimestampRecordChange {
    /**
     * Opaque token whose usable timestamp association changed.
     */
    readonly trackingToken: string;

    /**
     * Whether the token became usable or must have any rendered source restored.
     */
    readonly state: (typeof FACEBOOK_TIMESTAMP_RECORD_CHANGE)[
        keyof typeof FACEBOOK_TIMESTAMP_RECORD_CHANGE
    ];
}

/**
 * Internal retained association states.
 */
const FACEBOOK_TIMESTAMP_ASSOCIATION_STATE = {
    RECORD: "record",
    CONFLICT: "conflict",
} as const;

/**
 * Retained usable record or fail-closed conflict marker.
 */
type FacebookTimestampAssociation =
    | {
        /**
         * Identifies an available association.
         */
        readonly state: typeof FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.RECORD;

        /**
         * Minimal timestamp record associated with the token.
         */
        readonly record: FacebookTimestampRecord;
    }
    | {
        /**
         * Identifies a token rejected after contradictory evidence.
         */
        readonly state: typeof FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.CONFLICT;
    };

/**
 * Per-document bounded associations and parsed initial payload scripts.
 */
interface FacebookTimestampStore {
    /**
     * Available records and conflicts in shared insertion order for bounded eviction.
     */
    readonly associations: Map<string, FacebookTimestampAssociation>;

    /**
     * Initial-page payload scripts already parsed for this document.
     */
    readonly parsedScripts: WeakSet<HTMLScriptElement>;
}

const stores = new WeakMap<Document, FacebookTimestampStore>();

/**
 * Returns the mutable store owned by one document.
 *
 * @param document - Document whose Facebook payload state is requested.
 * @returns - Existing or newly created timestamp store.
 */
function getStore(document: Document): FacebookTimestampStore {
    const existing = stores.get(document);
    if (existing) {
        return existing;
    }
    const created: FacebookTimestampStore = {
        associations: new Map(),
        parsedScripts: new WeakSet(),
    };
    stores.set(document, created);
    return created;
}

/**
 * Extracts the tracking token from an eligible Facebook link URL.
 *
 * @param element - Candidate page-owned anchor.
 * @returns - Exact encrypted tracking token, or null when the link is unsuitable.
 */
export function getFacebookTrackingToken(element: Element): string | null {
    if (
        element.namespaceURI !== "http://www.w3.org/1999/xhtml"
        || element.localName !== "a"
    ) {
        return null;
    }
    const href = element.getAttribute("href");
    if (!href) {
        return null;
    }
    try {
        const token = new URL(href, element.ownerDocument.baseURI)
            .searchParams.get(FACEBOOK_TRACKING_QUERY_PARAMETER);
        return token && token.trim() !== "" ? token : null;
    } catch {
        return null;
    }
}

/**
 * Stores new records while rejecting cross-payload conflicts and bounding retained history.
 *
 * @param document - Document receiving the records.
 * @param records - Structurally validated Story timestamps.
 * @returns - Availability changes requiring targeted source reconciliation.
 */
export function storeFacebookTimestampRecords(
    document: Document,
    records: readonly FacebookTimestampRecord[],
): readonly FacebookTimestampRecordChange[] {
    const store = getStore(document);
    const changed = new Map<string, FacebookTimestampRecordChange>();
    for (const record of records) {
        const existing = store.associations.get(record.trackingToken);
        if (existing?.state === FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.CONFLICT) {
            continue;
        }
        if (existing?.state === FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.RECORD) {
            if (existing.record.rawDatetime === record.rawDatetime) {
                continue;
            }
            store.associations.set(record.trackingToken, {
                state: FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.CONFLICT,
            });
            changed.set(record.trackingToken, {
                trackingToken: record.trackingToken,
                state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED,
            });
            continue;
        }
        store.associations.set(record.trackingToken, {
            state: FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.RECORD,
            record,
        });
        changed.set(record.trackingToken, {
            trackingToken: record.trackingToken,
            state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.AVAILABLE,
        });
        while (
            store.associations.size
            > FACEBOOK_PAYLOAD_LIMIT.MAX_ASSOCIATIONS_PER_DOCUMENT
        ) {
            const oldest = store.associations.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            store.associations.delete(oldest);
            changed.set(oldest, {
                trackingToken: oldest,
                state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED,
            });
        }
    }
    return [...changed.values()];
}

/**
 * Parses every newly observed initial-page Facebook JSON script once.
 *
 * @param document - Facebook document whose scripts are inspected.
 * @returns - Availability changes produced by newly parsed scripts.
 */
export function ingestFacebookPayloadScripts(
    document: Document,
): readonly FacebookTimestampRecordChange[] {
    const store = getStore(document);
    const changed = new Map<string, FacebookTimestampRecordChange>();
    for (const element of document.querySelectorAll(FACEBOOK_PAYLOAD_SCRIPT_SELECTOR)) {
        if (!(element instanceof HTMLScriptElement) || store.parsedScripts.has(element)) {
            continue;
        }
        const payloadText = element.textContent;
        if (payloadText.trim() === "") {
            continue;
        }
        store.parsedScripts.add(element);
        const records = extractFacebookTimestampRecords(payloadText);
        for (const change of storeFacebookTimestampRecords(document, records)) {
            changed.set(change.trackingToken, change);
        }
    }
    return [...changed.values()];
}

/**
 * Returns the exact Story record associated with one page-owned timestamp link.
 *
 * @param element - Candidate Facebook timestamp link.
 * @returns - Matching record, or null when the payload provides no unambiguous proof.
 */
export function getFacebookTimestampRecord(element: Element): FacebookTimestampRecord | null {
    const token = getFacebookTrackingToken(element);
    const association = token
        ? stores.get(element.ownerDocument)?.associations.get(token)
        : undefined;
    return association?.state === FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.RECORD
        ? association.record
        : null;
}

/**
 * Finds connected timestamp sources affected by a set of newly available tracking tokens.
 *
 * @param document - Facebook document to search.
 * @param tokens - Exact tracking tokens whose records changed.
 * @returns - Page-owned anchors suitable for targeted reconciliation.
 */
export function findFacebookTimestampSources(
    document: Document,
    tokens: readonly string[],
): readonly Element[] {
    if (tokens.length === 0) {
        return [];
    }
    const selected = new Set(tokens);
    return [...document.querySelectorAll(FACEBOOK_TIMESTAMP_SELECTOR)].filter((element) => {
        const token = getFacebookTrackingToken(element);
        return token !== null && selected.has(token);
    });
}

/**
 * Drops all retained records for a document during teardown or isolated testing.
 *
 * @param document - Document whose Facebook timestamp state is discarded.
 */
export function clearFacebookTimestampRecords(document: Document): void {
    stores.delete(document);
}
