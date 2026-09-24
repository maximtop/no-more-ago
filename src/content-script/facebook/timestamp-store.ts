/**
 * @file Stores Facebook Story timestamps and maps them to exact page-owned links.
 */

import {
    FACEBOOK_PAYLOAD_LIMIT,
    FACEBOOK_PAYLOAD_SCRIPT_SELECTOR,
    FACEBOOK_TRACKED_LINK_SELECTOR,
    FACEBOOK_TRACKING_QUERY_PARAMETER,
    type FacebookTimestampPayloadUpdate,
    type FacebookTimestampRecord,
} from './contracts';
import { extractFacebookTimestampUpdate } from './payload-parser';

/**
 * Observable association changes consumed by targeted Facebook reconciliation.
 */
export const FACEBOOK_TIMESTAMP_RECORD_CHANGE = {
    AVAILABLE: 'available',
    INVALIDATED: 'invalidated',
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
    RECORD: 'record',
    CONFLICT: 'conflict',
} as const;

/**
 * Retained usable record or fail-closed conflict marker.
 */
type FacebookTimestampAssociation = | {
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
 *
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
 * Evicts oldest retained associations and reports lost availability.
 *
 * @param store - Mutable per-document association store.
 * @param changed - Change batch receiving eviction invalidations.
 */
function enforceAssociationLimit(
    store: FacebookTimestampStore,
    changed: Map<string, FacebookTimestampRecordChange>,
): void {
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

/**
 * Extracts the tracking token from an eligible Facebook link URL.
 *
 * @param element - Candidate page-owned anchor.
 *
 * @returns - Exact encrypted tracking token, or null when the link is unsuitable.
 */
export function getFacebookTrackingToken(element: Element): string | null {
    if (
        element.namespaceURI !== 'http://www.w3.org/1999/xhtml'
        || element.localName !== 'a'
    ) {
        return null;
    }
    const href = element.getAttribute('href');
    if (!href) {
        return null;
    }
    try {
        const token = new URL(href, element.ownerDocument.baseURI)
            .searchParams.get(FACEBOOK_TRACKING_QUERY_PARAMETER);
        return token && token.trim() !== '' ? token : null;
    } catch {
        return null;
    }
}

/**
 * Stores one payload update while preserving conflict invalidations across payloads.
 *
 * @param document - Document receiving the update.
 * @param update - Structurally validated records and same-payload conflicts.
 *
 * @returns - Availability changes requiring targeted source reconciliation.
 */
export function storeFacebookTimestampUpdate(
    document: Document,
    update: FacebookTimestampPayloadUpdate,
): readonly FacebookTimestampRecordChange[] {
    const store = getStore(document);
    const changed = new Map<string, FacebookTimestampRecordChange>();
    if (update.invalidateAll) {
        for (const trackingToken of store.associations.keys()) {
            changed.set(trackingToken, {
                trackingToken,
                state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED,
            });
        }
        store.associations.clear();
        return [...changed.values()];
    }
    for (const record of update.records) {
        const existing = store.associations.get(record.trackingToken);
        const isRejected = existing?.state === FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.CONFLICT;
        const isUnchanged = existing?.state === FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.RECORD
            && existing.record.rawDatetime === record.rawDatetime;
        if (!isRejected && !isUnchanged) {
            if (existing?.state === FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.RECORD) {
                store.associations.set(record.trackingToken, {
                    state: FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.CONFLICT,
                });
                changed.set(record.trackingToken, {
                    trackingToken: record.trackingToken,
                    state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED,
                });
            } else {
                store.associations.set(record.trackingToken, {
                    state: FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.RECORD,
                    record,
                });
                changed.set(record.trackingToken, {
                    trackingToken: record.trackingToken,
                    state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.AVAILABLE,
                });
                enforceAssociationLimit(store, changed);
            }
        }
    }
    for (const trackingToken of update.invalidatedTrackingTokens) {
        const existing = store.associations.get(trackingToken);
        if (existing?.state !== FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.CONFLICT) {
            store.associations.set(trackingToken, {
                state: FACEBOOK_TIMESTAMP_ASSOCIATION_STATE.CONFLICT,
            });
            changed.set(trackingToken, {
                trackingToken,
                state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED,
            });
            enforceAssociationLimit(store, changed);
        }
    }
    return [...changed.values()];
}

/**
 * Parses every newly observed initial-page Facebook JSON script once.
 *
 * @param document - Facebook document whose scripts are inspected.
 * @param scripts - Exact mutated scripts, or all matching scripts during startup.
 *
 * @returns - Availability changes produced by newly parsed scripts.
 */
export function ingestFacebookPayloadScripts(
    document: Document,
    scripts?: readonly HTMLScriptElement[],
): readonly FacebookTimestampRecordChange[] {
    const store = getStore(document);
    const changed = new Map<string, FacebookTimestampRecordChange>();
    const candidates = scripts
        ?? [...document.querySelectorAll(FACEBOOK_PAYLOAD_SCRIPT_SELECTOR)].filter(
            (element): element is HTMLScriptElement => element instanceof HTMLScriptElement,
        );
    for (const element of candidates) {
        if (element instanceof HTMLScriptElement && !store.parsedScripts.has(element)) {
            const payloadText = element.textContent;
            if (payloadText.trim() !== '') {
                store.parsedScripts.add(element);
                const update = extractFacebookTimestampUpdate(payloadText);
                for (const change of storeFacebookTimestampUpdate(document, update)) {
                    changed.set(change.trackingToken, change);
                }
            }
        }
    }
    return [...changed.values()];
}

/**
 * Returns the exact Story record associated with one page-owned timestamp link.
 *
 * @param element - Candidate Facebook timestamp link.
 *
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
 *
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
    return [...document.querySelectorAll(FACEBOOK_TRACKED_LINK_SELECTOR)].filter((element) => {
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
