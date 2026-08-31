/**
 * @file Receives Facebook payload records and schedules exact-source reconciliation.
 */

import {
    FACEBOOK_PAYLOAD_LIMIT,
    FACEBOOK_TRACKED_LINK_SELECTOR,
    isFacebookPayloadMessage,
    verifyFacebookPayloadMessage,
} from "./contracts";
import {
    FACEBOOK_BRIDGE_LEASE_RENEWAL_MS,
    FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
    type FacebookBridgeLease,
    type FacebookBridgeLeaseRequest,
    type FacebookBridgeLeaseResponse,
} from "../../shared/messaging/facebook-bridge";
import { isFacebookTimestampElement } from "../adapters/facebook";
import {
    FACEBOOK_TIMESTAMP_RECORD_CHANGE,
    clearFacebookTimestampRecords,
    findFacebookTimestampSources,
    getFacebookTrackingToken,
    ingestFacebookPayloadScripts,
    storeFacebookTimestampUpdate,
    type FacebookTimestampRecordChange,
} from "./timestamp-store";

const FACEBOOK_PAYLOAD_RUNTIME_SLOT = Symbol.for("no-more-ago.facebook-payload-runtime");
const FACEBOOK_PAYLOAD_SCRIPT_SELECTOR = "script[type='application/json'][data-sjs]" as const;

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
     * Current browser-mediated bridge lease requester.
     */
    requestBridgeLease: ((
        request: FacebookBridgeLeaseRequest,
    ) => Promise<FacebookBridgeLeaseResponse>) | undefined;

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
 * Checks whether one mutation could introduce or populate a Facebook JSON payload script.
 *
 * @param record - Child-list mutation to inspect.
 * @returns - Whether newly available script text should be parsed.
 */
function hasPayloadScript(record: MutationRecord): boolean {
    const target = record.target instanceof HTMLScriptElement
        ? record.target
        : record.target.parentElement;
    if (target?.matches(FACEBOOK_PAYLOAD_SCRIPT_SELECTOR) === true) {
        return true;
    }
    return [...record.addedNodes].some((node) =>
        node instanceof HTMLScriptElement
            ? node.matches(FACEBOOK_PAYLOAD_SCRIPT_SELECTOR)
            : node instanceof Element
                && node.querySelector(FACEBOOK_PAYLOAD_SCRIPT_SELECTOR) !== null);
}

/**
 * Checks whether a mutation adds or completes a Facebook tracking link.
 *
 * @param record - Child-list mutation to inspect.
 * @returns - Whether pending timestamp records should be retried.
 */
function trackedLinkCandidates(record: MutationRecord): readonly Element[] {
    const candidates = new Set<Element>();
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
        if (!(node instanceof Element)) {
            continue;
        }
        if (node.matches(FACEBOOK_TRACKED_LINK_SELECTOR)) {
            candidates.add(node);
        }
        for (const element of node.querySelectorAll(FACEBOOK_TRACKED_LINK_SELECTOR)) {
            candidates.add(element);
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
 * @param input.requestBridgeLease - Optional authenticated background lease boundary.
 * @returns - Idempotent lifecycle handle for the document.
 */
export function installFacebookPayloadRuntime(input: {
    readonly window: Window;
    readonly document: Document;
    readonly onSourcesChanged: (sources: readonly Element[]) => void;
    readonly requestBridgeLease?: (
        request: FacebookBridgeLeaseRequest,
    ) => Promise<FacebookBridgeLeaseResponse>;
}): FacebookPayloadRuntimeHandle {
    const runtimeDocument = input.document as Document & Record<
        symbol,
        FacebookPayloadRuntimeSlot | undefined
    >;
    const existing = runtimeDocument[FACEBOOK_PAYLOAD_RUNTIME_SLOT];
    if (existing) {
        existing.onSourcesChanged = input.onSourcesChanged;
        existing.requestBridgeLease = input.requestBridgeLease;
        return existing.handle;
    }
    const pendingChanges = new Map<string, FacebookTimestampRecordChange>();
    const slot = {} as FacebookPayloadRuntimeSlot;
    slot.onSourcesChanged = input.onSourcesChanged;
    slot.requestBridgeLease = input.requestBridgeLease;
    slot.enabled = false;
    slot.disposed = false;
    let lifecycleGeneration = 0;
    let lease: FacebookBridgeLease | null = null;
    let renewalTimer: number | undefined;
    const acceptedSequences = new Set<number>();
    const pendingSequences = new Set<number>();

    const retryPending = (candidates?: readonly Element[]): void => {
        if (!slot.enabled) {
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

    const clearRenewal = (): void => {
        if (renewalTimer !== undefined) {
            input.window.clearTimeout(renewalTimer);
            renewalTimer = undefined;
        }
    };

    const releaseLease = (released: FacebookBridgeLease): void => {
        try {
            void slot.requestBridgeLease?.({
                type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
                active: false,
                leaseId: released.leaseId,
            }).catch(() => undefined);
        } catch {
            /* release is best-effort because the main-world lease expires independently */
        }
    };

    const abandonLease = (abandoned: FacebookBridgeLease): void => {
        if (lease !== abandoned) {
            return;
        }
        lease = null;
        acceptedSequences.clear();
        pendingSequences.clear();
        releaseLease(abandoned);
    };

    const requestLease = (generation: number): void => {
        const requester = slot.requestBridgeLease;
        if (!slot.enabled || slot.disposed || !requester) {
            return;
        }
        let pending: Promise<FacebookBridgeLeaseResponse>;
        try {
            pending = Promise.resolve(requester({
                type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
                active: true,
            }));
        } catch {
            pending = Promise.reject(new Error("Facebook bridge lease unavailable"));
        }
        void pending.then((response) => {
            if (
                !slot.enabled
                || slot.disposed
                || lifecycleGeneration !== generation
            ) {
                if (response.ok && response.active) {
                    releaseLease(response);
                }
                return;
            }
            clearRenewal();
            if (response.ok && response.active && response.expiresAt > Date.now()) {
                lease = response;
                acceptedSequences.clear();
                pendingSequences.clear();
            } else {
                if (response.ok && response.active) {
                    releaseLease(response);
                }
                if (lease) {
                    abandonLease(lease);
                }
            }
            renewalTimer = input.window.setTimeout(() => {
                renewalTimer = undefined;
                requestLease(generation);
            }, FACEBOOK_BRIDGE_LEASE_RENEWAL_MS);
        }, () => {
            if (slot.enabled && !slot.disposed && lifecycleGeneration === generation) {
                if (lease) {
                    abandonLease(lease);
                }
                clearRenewal();
                renewalTimer = input.window.setTimeout(() => {
                    renewalTimer = undefined;
                    requestLease(generation);
                }, FACEBOOK_BRIDGE_LEASE_RENEWAL_MS);
            }
        });
    };

    const messageListener = (event: MessageEvent): void => {
        if (
            event.source !== input.window
            || event.origin !== input.window.location.origin
        ) {
            return;
        }
        if (!isFacebookPayloadMessage(event.data)) {
            return;
        }
        const currentLease = lease;
        const message = event.data;
        if (
            !currentLease
            || currentLease.expiresAt <= Date.now()
            || message.leaseId !== currentLease.leaseId
            || acceptedSequences.has(message.sequence)
            || pendingSequences.has(message.sequence)
            || pendingSequences.size >= 4
        ) {
            if (currentLease && currentLease.expiresAt <= Date.now()) {
                abandonLease(currentLease);
            }
            return;
        }
        pendingSequences.add(message.sequence);
        void verifyFacebookPayloadMessage(message, currentLease.secret).then((verified) => {
            pendingSequences.delete(message.sequence);
            if (
                !verified
                || !slot.enabled
                || lease !== currentLease
                || currentLease.expiresAt <= Date.now()
                || acceptedSequences.has(message.sequence)
            ) {
                if (lease === currentLease && currentLease.expiresAt <= Date.now()) {
                    abandonLease(currentLease);
                }
                return;
            }
            acceptedSequences.add(message.sequence);
            acceptChanges(storeFacebookTimestampUpdate(input.document, message));
        }, () => {
            pendingSequences.delete(message.sequence);
            if (lease === currentLease && currentLease.expiresAt <= Date.now()) {
                abandonLease(currentLease);
            }
        });
    };

    const observer = new MutationObserver((records) => {
        if (!slot.enabled) {
            return;
        }
        if (records.some(hasPayloadScript)) {
            acceptChanges(ingestFacebookPayloadScripts(input.document));
        }
        const candidates = [...new Set(records.flatMap(trackedLinkCandidates))];
        if (candidates.length > 0) {
            retryPending(candidates);
        }
    });

    const setEnabled = (enabled: boolean): void => {
        if (slot.disposed || slot.enabled === enabled) {
            return;
        }
        slot.enabled = enabled;
        lifecycleGeneration += 1;
        const generation = lifecycleGeneration;
        if (enabled) {
            input.window.addEventListener("message", messageListener);
            observer.observe(input.document, {
                attributes: true,
                attributeFilter: ["href"],
                characterData: true,
                childList: true,
                subtree: true,
            });
            acceptChanges(ingestFacebookPayloadScripts(input.document));
            requestLease(generation);
            return;
        }
        clearRenewal();
        if (lease) {
            releaseLease(lease);
        }
        lease = null;
        acceptedSequences.clear();
        pendingSequences.clear();
        input.window.removeEventListener("message", messageListener);
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
