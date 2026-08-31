/**
 * @file Receives Facebook payload records and schedules exact-source reconciliation.
 */

import {
    FACEBOOK_PAYLOAD_LIMIT,
    createFacebookPayloadBridgeControlMessage,
    isFacebookPayloadBridgeReadyMessage,
    isFacebookPayloadMessage,
} from "./contracts";
import { isFacebookTimestampElement } from "../adapters/facebook";
import {
    FACEBOOK_TIMESTAMP_RECORD_CHANGE,
    clearFacebookTimestampRecords,
    findFacebookTimestampSources,
    ingestFacebookPayloadScripts,
    storeFacebookTimestampRecords,
    type FacebookTimestampRecordChange,
} from "./timestamp-store";

const FACEBOOK_PAYLOAD_RUNTIME_SLOT = Symbol.for("no-more-ago.facebook-payload-runtime");
const FACEBOOK_PAYLOAD_SCRIPT_SELECTOR = "script[type='application/json'][data-sjs]" as const;
const FACEBOOK_TRACKED_LINK_SELECTOR = "a[href*='__cft__']" as const;

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
 * Checks whether one mutation could introduce or populate a Facebook JSON payload script.
 *
 * @param record - Child-list mutation to inspect.
 * @returns - Whether newly available script text should be parsed.
 */
function hasPayloadScript(record: MutationRecord): boolean {
    if (
        record.target instanceof HTMLScriptElement
        && record.target.matches(FACEBOOK_PAYLOAD_SCRIPT_SELECTOR)
    ) {
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
function affectsTrackedLink(record: MutationRecord): boolean {
    const affects = (node: Node): boolean => {
        const element = node.nodeType === Node.ELEMENT_NODE
            ? node as Element
            : node.parentElement;
        return element !== null
            && (
                element.matches(FACEBOOK_TRACKED_LINK_SELECTOR)
                || element.closest(FACEBOOK_TRACKED_LINK_SELECTOR) !== null
                || element.querySelector(FACEBOOK_TRACKED_LINK_SELECTOR) !== null
            );
    };
    return affects(record.target) || [...record.addedNodes].some(affects);
}

/**
 * Installs an idempotent Facebook payload consumer for one isolated document world.
 *
 * @param input - Window, document, and targeted reconciliation callback.
 * @param input.window - Window receiving main-world bridge messages.
 * @param input.document - Facebook document whose records and scripts are consumed.
 * @param input.onSourcesChanged - Reconciles only sources affected by record changes.
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

    const retryPending = (): void => {
        if (!slot.enabled) {
            return;
        }
        for (const change of [...pendingChanges.values()]) {
            const sources = findFacebookTimestampSources(
                input.document,
                [change.trackingToken],
            );
            const affected = change.state === FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED
                ? sources
                : sources.filter(isFacebookTimestampElement);
            if (affected.length > 0) {
                try {
                    slot.onSourcesChanged(affected);
                } catch {
                    continue;
                }
            }
            if (
                change.state === FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED
                || affected.length > 0
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

    const postControl = (enabled: boolean): void => {
        input.window.postMessage(
            createFacebookPayloadBridgeControlMessage(enabled),
            input.window.location.origin,
        );
    };

    const messageListener = (event: MessageEvent): void => {
        if (
            event.source !== input.window
            || event.origin !== input.window.location.origin
        ) {
            return;
        }
        if (isFacebookPayloadBridgeReadyMessage(event.data)) {
            postControl(true);
            return;
        }
        if (isFacebookPayloadMessage(event.data)) {
            acceptChanges(storeFacebookTimestampRecords(
                input.document,
                event.data.records,
            ));
        }
    };

    const observer = new MutationObserver((records) => {
        if (!slot.enabled) {
            return;
        }
        if (records.some(hasPayloadScript)) {
            acceptChanges(ingestFacebookPayloadScripts(input.document));
        }
        if (records.some(affectsTrackedLink)) {
            retryPending();
        }
    });

    const setEnabled = (enabled: boolean): void => {
        if (slot.disposed || slot.enabled === enabled) {
            return;
        }
        slot.enabled = enabled;
        if (enabled) {
            input.window.addEventListener("message", messageListener);
            observer.observe(input.document, {
                attributes: true,
                attributeFilter: ["href"],
                childList: true,
                subtree: true,
            });
            postControl(true);
            acceptChanges(ingestFacebookPayloadScripts(input.document));
            return;
        }
        postControl(false);
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
