/**
 * @file Receives Facebook payload records and schedules exact-source reconciliation.
 */

import { isFacebookTimestampElement } from '../adapters/facebook';

import {
    FACEBOOK_PAYLOAD_LIMIT,
    FACEBOOK_PAYLOAD_SCRIPT_SELECTOR,
    FACEBOOK_TRACKED_LINK_SELECTOR,
    createFacebookPayloadBridgeControlMessage,
    isFacebookPayloadBridgeReadyMessage,
    readFacebookPayloadMessage,
} from './contracts';
import {
    FACEBOOK_TIMESTAMP_RECORD_CHANGE,
    clearFacebookTimestampRecords,
    findFacebookTimestampSources,
    getFacebookTrackingToken,
    ingestFacebookPayloadScripts,
    storeFacebookTimestampUpdate,
    type FacebookTimestampRecordChange,
} from './timestamp-store';

const FACEBOOK_PAYLOAD_RUNTIME_SLOT = Symbol.for('no-more-ago.facebook-payload-runtime');

/**
 * Lifecycle handle for the isolated Facebook payload consumer.
 */
export interface FacebookPayloadRuntimeHandle {
    /**
     * Enables or disables payload consumption and temporary document state.
     *
     * @param enabled - Whether Facebook payload processing may run.
     */
    setEnabled(enabled: boolean): void;

    /**
     * Disables processing and releases the document singleton.
     */
    teardown(): void;
}

/**
 * Mutable per-document payload listener retained across duplicate content injection.
 */
interface FacebookPayloadRuntimeSlot {
    /**
     * Latest exact-source callback supplied by the content runtime.
     */
    onSourcesChanged: (sources: readonly Element[]) => void;

    /**
     * Stable public lifecycle handle returned by duplicate installations.
     */
    handle: FacebookPayloadRuntimeHandle;

    /**
     * Whether this runtime currently consumes payloads and mutations.
     */
    enabled: boolean;

    /**
     * Whether teardown permanently released this slot.
     */
    disposed: boolean;
}

/**
 * Collects the exact Facebook payload scripts introduced or populated by one mutation.
 *
 * @param record - Mutation whose local script candidates are requested.
 *
 * @returns - Matching script elements without a document-wide rescan.
 */
function payloadScriptCandidates(record: MutationRecord): readonly HTMLScriptElement[] {
    const candidates = new Set<HTMLScriptElement>();

    /**
     * Collects a payload script reached by a mutation node.
     *
     * @param node - Added or changed node.
     */
    const addCandidate = (node: Node): void => {
        const element = node instanceof Element ? node : node.parentElement;
        if (
            element instanceof HTMLScriptElement
            && element.matches(FACEBOOK_PAYLOAD_SCRIPT_SELECTOR)
        ) {
            candidates.add(element);
        }
    };
    addCandidate(record.target);
    for (const node of record.addedNodes) {
        addCandidate(node);
        if (node instanceof Element) {
            for (const element of node.querySelectorAll(FACEBOOK_PAYLOAD_SCRIPT_SELECTOR)) {
                if (element instanceof HTMLScriptElement) {
                    candidates.add(element);
                }
            }
        }
    }
    return [...candidates];
}

/**
 * Collects Facebook tracking links affected by one DOM mutation.
 *
 * @param record - Mutation to inspect.
 *
 * @returns - Local candidate anchors for retrying pending associations.
 */
function trackedLinkCandidates(record: MutationRecord): readonly Element[] {
    const candidates = new Set<Element>();

    /**
     * Collects the tracked link closest to a mutation node.
     *
     * @param node - Added or changed node.
     */
    const addClosest = (node: Node): void => {
        const element = node instanceof Element ? node : node.parentElement;
        const closest = element?.closest(FACEBOOK_TRACKED_LINK_SELECTOR);
        if (closest) {
            candidates.add(closest);
        }
    };
    addClosest(record.target);
    for (const node of record.addedNodes) {
        addClosest(node);
        if (node instanceof Element) {
            if (node.matches(FACEBOOK_TRACKED_LINK_SELECTOR)) {
                candidates.add(node);
            }
            for (const element of node.querySelectorAll(FACEBOOK_TRACKED_LINK_SELECTOR)) {
                candidates.add(element);
            }
        }
    }
    return [...candidates];
}

/**
 * Installs an idempotent Facebook payload consumer for one isolated document world.
 *
 * @param input - Window, document, and targeted reconciliation callback.
 * @param input.window - Window receiving main-world bridge messages.
 * @param input.document - Facebook document whose records and scripts are consumed.
 * @param input.onSourcesChanged - Reconciles only sources affected by record changes.
 *
 * @returns - Idempotent lifecycle handle for the document.
 */
export function installFacebookPayloadRuntime(input: {
    readonly window: Window;
    readonly document: Document;
    readonly onSourcesChanged: (sources: readonly Element[]) => void;
}): FacebookPayloadRuntimeHandle {
    const runtimeDocument = input.document as Document & Record<
        symbol,
        FacebookPayloadRuntimeSlot | undefined
    >;
    const existing = runtimeDocument[FACEBOOK_PAYLOAD_RUNTIME_SLOT];
    if (existing) {
        existing.onSourcesChanged = input.onSourcesChanged;
        return existing.handle;
    }
    const pendingChanges = new Map<string, FacebookTimestampRecordChange>();
    const slot = {} as FacebookPayloadRuntimeSlot;
    slot.onSourcesChanged = input.onSourcesChanged;
    slot.enabled = false;
    slot.disposed = false;

    /**
     * Reapplies pending record changes to their tracked links.
     *
     * @param candidates - Links to retry, or every tracked link when omitted.
     */
    const retryPending = (candidates?: readonly Element[]): void => {
        if (!slot.enabled || pendingChanges.size === 0) {
            return;
        }
        const changes = [...pendingChanges.values()];
        const changeByToken = new Map(changes.map((change) => [change.trackingToken, change]));
        const sources = candidates ?? findFacebookTimestampSources(
            input.document,
            [...changeByToken.keys()],
        );
        const matchedTokens = new Set<string>();
        const affected = sources.filter((source) => {
            const trackingToken = getFacebookTrackingToken(source);
            if (trackingToken === null) {
                return false;
            }
            const change = changeByToken.get(trackingToken);
            if (!change) {
                return false;
            }
            if (
                change.state === FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED
                || isFacebookTimestampElement(source)
            ) {
                matchedTokens.add(trackingToken);
                return true;
            }
            return false;
        });
        if (affected.length > 0) {
            try {
                slot.onSourcesChanged(affected);
            } catch {
                return;
            }
        }
        for (const change of changes) {
            if (
                change.state === FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED
                || matchedTokens.has(change.trackingToken)
            ) {
                pendingChanges.delete(change.trackingToken);
            }
        }
    };

    /**
     * Applies record changes posted by the bridge, retaining unmatched ones.
     *
     * @param changes - Timestamp record changes posted by the bridge.
     */
    const acceptChanges = (changes: readonly FacebookTimestampRecordChange[]): void => {
        if (!slot.enabled) {
            return;
        }
        for (const change of changes) {
            pendingChanges.delete(change.trackingToken);
            pendingChanges.set(change.trackingToken, change);
            while (
                pendingChanges.size
                > FACEBOOK_PAYLOAD_LIMIT.MAX_ASSOCIATIONS_PER_DOCUMENT
            ) {
                const oldest = pendingChanges.keys().next().value;
                if (oldest === undefined) {
                    break;
                }
                pendingChanges.delete(oldest);
            }
        }
        retryPending();
    };

    /**
     * Posts a bridge control message to the page.
     *
     * @param enabled - Requested bridge state.
     */
    const postControl = (enabled: boolean): void => {
        try {
            input.window.postMessage(
                createFacebookPayloadBridgeControlMessage(enabled),
                input.window.location.origin,
            );
        } catch {
            /* lifecycle convergence is retried by a later bridge-ready message */
        }
    };

    /**
     * Accepts record changes posted by the main-world bridge.
     *
     * @param event - Window message event.
     */
    const messageListener = (event: MessageEvent): void => {
        if (
            event.source !== input.window
            || event.origin !== input.window.location.origin
        ) {
            return;
        }
        if (isFacebookPayloadBridgeReadyMessage(event.data)) {
            if (slot.enabled) {
                postControl(true);
            }
            return;
        }
        const update = slot.enabled ? readFacebookPayloadMessage(event.data) : null;
        if (!update) {
            return;
        }
        acceptChanges(storeFacebookTimestampUpdate(input.document, update));
    };

    const observer = new MutationObserver((records) => {
        if (!slot.enabled) {
            return;
        }
        const scripts = [...new Set(records.flatMap(payloadScriptCandidates))];
        if (scripts.length > 0) {
            acceptChanges(ingestFacebookPayloadScripts(input.document, scripts));
        }
        if (pendingChanges.size === 0) {
            return;
        }
        const candidates = [...new Set(records.flatMap(trackedLinkCandidates))];
        if (candidates.length > 0) {
            retryPending(candidates);
        }
    });

    /**
     * Enables or disables the payload runtime and its bridge.
     *
     * @param enabled - Requested runtime state.
     */
    const setEnabled = (enabled: boolean): void => {
        if (slot.disposed || slot.enabled === enabled) {
            return;
        }
        slot.enabled = enabled;
        if (enabled) {
            input.window.addEventListener('message', messageListener);
            observer.observe(input.document, {
                attributes: true,
                attributeFilter: ['href'],
                characterData: true,
                childList: true,
                subtree: true,
            });
            acceptChanges(ingestFacebookPayloadScripts(input.document));
            postControl(true);
            return;
        }
        postControl(false);
        input.window.removeEventListener('message', messageListener);
        observer.disconnect();
        pendingChanges.clear();
        clearFacebookTimestampRecords(input.document);
    };

    slot.handle = {
        setEnabled,
        teardown: () => {
            if (slot.disposed) {
                return;
            }
            setEnabled(false);
            slot.disposed = true;
            if (runtimeDocument[FACEBOOK_PAYLOAD_RUNTIME_SLOT] === slot) {
                Reflect.deleteProperty(runtimeDocument, FACEBOOK_PAYLOAD_RUNTIME_SLOT);
            }
        },
    };
    runtimeDocument[FACEBOOK_PAYLOAD_RUNTIME_SLOT] = slot;
    return slot.handle;
}
