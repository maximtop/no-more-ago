/**
 * @file Captures selected Facebook GraphQL responses in the page's main JavaScript world.
 */

import { isFacebookHostname, isFacebookUrl } from "../../shared/url/facebook";
import {
    FACEBOOK_BRIDGE_LEASE_ID,
    FACEBOOK_BRIDGE_SECRET,
    type FacebookBridgeLeaseCommand,
} from "../../shared/messaging/facebook-bridge";
import {
    FACEBOOK_PAYLOAD_LIMIT,
    createFacebookPayloadMessage,
} from "./contracts";
import { extractFacebookTimestampRecords } from "./payload-parser";

const FACEBOOK_PAYLOAD_BRIDGE_SLOT = Symbol.for("no-more-ago.facebook-payload-bridge");
const FACEBOOK_PAYLOAD_BRIDGE_VERSION = 2 as const;
const FACEBOOK_GRAPHQL_PATHNAME = "/api/graphql/" as const;
const FACEBOOK_QUERY_NAME = /^[\dA-Za-z_]+Query$/u;
const FACEBOOK_STORY_QUERY_CUES = [
    "NewsFeed",
    "HomeFeed",
    "TimelineFeed",
    "GroupsCometFeed",
    "PagesCometFeed",
    "Story",
    "Stories",
    "Permalink",
    "SinglePost",
] as const;

/**
 * Transport work limits applied before Story payload parsing.
 */
export const FACEBOOK_TRANSPORT_LIMIT = {
    MAX_REQUEST_BODY_CHARACTERS: 100_000,
    MAX_CONCURRENT_INSPECTIONS: 2,
} as const;

/**
 * One active browser-mediated lease retained only in the bridge closure.
 */
interface ActiveFacebookBridgeLease {
    /**
     * Opaque lease identity included in signed record messages.
     */
    readonly leaseId: string;

    /**
     * HMAC secret shared only with the isolated world through the background.
     */
    readonly secret: string;

    /**
     * Absolute expiration enforced independently from isolated-world teardown.
     */
    readonly expiresAt: number;

    /**
     * Monotonic lifecycle generation captured by each selected request.
     */
    readonly generation: number;

    /**
     * Next replay-resistant record-message sequence.
     */
    sequence: number;
}

/**
 * Versioned main-world lifecycle surface invoked through browser scripting.
 */
interface FacebookPayloadBridgeSlot {
    /**
     * Bridge contract version used to reject stale document singletons.
     */
    readonly version: typeof FACEBOOK_PAYLOAD_BRIDGE_VERSION;

    /**
     * Applies one active or release lease command.
     *
     * @param command - Browser-injected lease command.
     * @returns - Whether the command was accepted.
     */
    readonly reconcileLease: (command: FacebookBridgeLeaseCommand) => boolean;

    /**
     * Expires the lease and restores only transport wrappers still owned by this bridge.
     */
    readonly dispose: () => void;
}

/**
 * Request details retained between XMLHttpRequest open and send calls.
 */
interface FacebookXhrRequest {
    /**
     * Request method supplied to open.
     */
    readonly method: string;

    /**
     * Request URL supplied to open.
     */
    readonly url: string;

    /**
     * Exact activation generation that observed the open call.
     */
    readonly lease: ActiveFacebookBridgeLease;
}

/**
 * Installed wrappers and descriptors needed for ownership-safe restoration.
 */
interface InstalledFacebookTransportWrappers {
    /**
     * Original page fetch function.
     */
    readonly originalFetch: Window["fetch"];

    /**
     * Fetch wrapper owned by this bridge.
     */
    readonly wrappedFetch: Window["fetch"];

    /**
     * XMLHttpRequest prototype wrapped by this bridge.
     */
    readonly xhrPrototype: object;

    /**
     * Original open descriptor.
     */
    readonly originalXhrOpen: PropertyDescriptor | undefined;

    /**
     * Original send descriptor.
     */
    readonly originalXhrSend: PropertyDescriptor | undefined;

    /**
     * Installed open implementation, when wrapping succeeded.
     */
    readonly wrappedXhrOpen: ((...args: unknown[]) => unknown) | undefined;

    /**
     * Installed send implementation, when wrapping succeeded.
     */
    readonly wrappedXhrSend: ((...args: unknown[]) => unknown) | undefined;
}

/**
 * Reads an unknown property without retaining Reflect.get's any return type.
 *
 * @param value - Object containing the property.
 * @param property - Property name to read.
 * @returns - Unknown property value.
 */
function unknownProperty(value: object, property: string): unknown {
    return Reflect.get(value, property) as unknown;
}

/**
 * Converts a supported request body into bounded text without consuming streams or blobs.
 *
 * @param body - Page-provided fetch or XMLHttpRequest body.
 * @returns - Bounded serialized form data, or null when synchronous inspection is unsafe.
 */
function requestBodyText(body: unknown): string | null {
    const value = typeof body === "string"
        ? body
        : body instanceof URLSearchParams
            ? body.toString()
            : null;
    return value !== null && value.length <= FACEBOOK_TRANSPORT_LIMIT.MAX_REQUEST_BODY_CHARACTERS
        ? value
        : null;
}

/**
 * Checks whether one request is a Facebook Story-bearing GraphQL operation.
 *
 * @param requestUrl - Fetch input URL resolved by the page.
 * @param body - Synchronously inspectable request body.
 * @param baseHref - Current Facebook document URL used for relative requests.
 * @returns - Whether the response is worth bounded Story parsing.
 */
export function shouldInspectFacebookGraphqlRequest(
    requestUrl: string,
    body: string | null,
    baseHref: string,
): boolean {
    if (body === null || body.length > FACEBOOK_TRANSPORT_LIMIT.MAX_REQUEST_BODY_CHARACTERS) {
        return false;
    }
    let url: URL;
    try {
        url = new URL(requestUrl, baseHref);
    } catch {
        return false;
    }
    if (!isFacebookHostname(url.hostname) || url.pathname !== FACEBOOK_GRAPHQL_PATHNAME) {
        return false;
    }
    const queryName = new URLSearchParams(body).get("fb_api_req_friendly_name");
    return queryName !== null
        && FACEBOOK_QUERY_NAME.test(queryName)
        && FACEBOOK_STORY_QUERY_CUES.some((cue) => queryName.includes(cue));
}

/**
 * Resolves the URL and safely inspectable body for one fetch call.
 *
 * @param input - Fetch request URL or Request object.
 * @param init - Optional fetch initialization override.
 * @returns - Request details used for Story-query selection.
 */
function fetchRequestDetails(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
): { readonly url: string; readonly body: string | null } {
    const url = typeof input === "string"
        ? input
        : input instanceof URL
            ? input.href
            : input.url;
    return {
        url,
        body: requestBodyText(init?.body),
    };
}

/**
 * Cancels a cloned response reader without allowing cancellation failures to escape.
 *
 * @param reader - Cloned response stream reader.
 * @returns - Promise settled after best-effort cancellation.
 */
async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
        await reader.cancel();
    } catch {
        /* cancellation must never affect the page's original response */
    }
}

/**
 * Reads at most the configured payload limit from a response clone.
 *
 * @param response - Successful selected fetch response.
 * @param isCurrent - Checks the captured activation generation between chunks.
 * @param registerReader - Retains the reader for immediate lifecycle cancellation.
 * @returns - Complete bounded response text, or null after limit/lifecycle rejection.
 */
async function readBoundedResponseText(
    response: Response,
    isCurrent: () => boolean,
    registerReader: (
        reader: ReadableStreamDefaultReader<Uint8Array>,
    ) => () => void,
): Promise<string | null> {
    const clone = response.clone();
    const reader = clone.body?.getReader();
    if (!reader) {
        return null;
    }
    const unregisterReader = registerReader(reader);
    const declaredLength = clone.headers.get("content-length");
    const decoder = new TextDecoder();
    let payloadText = "";
    try {
        if (
            declaredLength !== null
            && /^\d+$/u.test(declaredLength)
            && Number(declaredLength) > FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS
        ) {
            await cancelReader(reader);
            return null;
        }
        for (;;) {
            if (!isCurrent()) {
                await cancelReader(reader);
                return null;
            }
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }
            const decoded = decoder.decode(chunk.value, { stream: true });
            if (payloadText.length + decoded.length > FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS) {
                await cancelReader(reader);
                return null;
            }
            payloadText += decoded;
        }
        const tail = decoder.decode();
        if (payloadText.length + tail.length > FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS) {
            return null;
        }
        return isCurrent() ? payloadText + tail : null;
    } finally {
        unregisterReader();
        try {
            reader.releaseLock();
        } catch {
            /* an already released or failed clone remains isolated from the page request */
        }
    }
}

/**
 * Extracts, signs, and transfers minimal records for one current lease generation.
 *
 * @param target - Facebook page window receiving the authenticated record envelope.
 * @param payloadText - Complete bounded selected response text.
 * @param lease - Exact activation generation captured by the request.
 * @param isCurrent - Confirms the lease before and after asynchronous signing.
 * @returns - Promise settled after optional record emission.
 */
async function emitPayloadRecords(
    target: Window,
    payloadText: string,
    lease: ActiveFacebookBridgeLease,
    isCurrent: () => boolean,
): Promise<void> {
    if (!isCurrent() || payloadText.length > FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS) {
        return;
    }
    const records = extractFacebookTimestampRecords(payloadText);
    if (records.length === 0 || !isCurrent()) {
        return;
    }
    const sequence = lease.sequence;
    lease.sequence += 1;
    const message = await createFacebookPayloadMessage(
        records,
        lease.leaseId,
        sequence,
        lease.secret,
    );
    if (isCurrent()) {
        target.postMessage(message, target.location.origin);
    }
}

/**
 * Installs inert-until-leased fetch and XMLHttpRequest wrappers.
 *
 * @param target - Facebook page window whose transports are wrapped.
 * @param getLease - Returns the current unexpired activation lease.
 * @param inspectFetchResponse - Bounded asynchronous fetch response inspector.
 * @param inspectTextResponse - Bounded asynchronous text response inspector.
 * @returns - Wrapper ownership state used for safe restoration.
 */
function installTransportWrappers(
    target: Window,
    getLease: () => ActiveFacebookBridgeLease | null,
    inspectFetchResponse: (response: Response, lease: ActiveFacebookBridgeLease) => void,
    inspectTextResponse: (payloadText: string, lease: ActiveFacebookBridgeLease) => void,
): InstalledFacebookTransportWrappers {
    const originalFetch = unknownProperty(target, "fetch") as Window["fetch"];
    const wrappedFetch: Window["fetch"] = (input, init) => {
        const response = Reflect.apply(originalFetch, target, [input, init]);
        const lease = getLease();
        if (!lease) {
            return response;
        }
        let inspect = false;
        try {
            const request = fetchRequestDetails(input, init);
            inspect = shouldInspectFacebookGraphqlRequest(
                request.url,
                request.body,
                target.location.href,
            );
        } catch {
            /* request selection must never alter the page request outcome */
        }
        if (inspect) {
            void response.then(
                (value) => {
                    inspectFetchResponse(value, lease);
                },
                () => undefined,
            );
        }
        return response;
    };
    target.fetch = wrappedFetch;

    const xhrTarget = target as Window & {
        readonly XMLHttpRequest: typeof XMLHttpRequest;
    };
    const xhrPrototype = xhrTarget.XMLHttpRequest.prototype;
    const originalXhrOpen = Object.getOwnPropertyDescriptor(xhrPrototype, "open");
    const originalXhrSend = Object.getOwnPropertyDescriptor(xhrPrototype, "send");
    const originalOpen = originalXhrOpen?.value as unknown;
    const originalSend = originalXhrSend?.value as unknown;
    if (
        !originalXhrOpen
        || !originalXhrSend
        || typeof originalOpen !== "function"
        || typeof originalSend !== "function"
    ) {
        return {
            originalFetch,
            wrappedFetch,
            xhrPrototype,
            originalXhrOpen,
            originalXhrSend,
            wrappedXhrOpen: undefined,
            wrappedXhrSend: undefined,
        };
    }
    const requests = new WeakMap<XMLHttpRequest, FacebookXhrRequest>();
    const wrappedXhrOpen = function(this: XMLHttpRequest, ...args: unknown[]): unknown {
        const lease = getLease();
        const method = args[0];
        const url = args[1];
        if (
            lease
            && typeof method === "string"
            && (typeof url === "string" || url instanceof URL)
        ) {
            requests.set(this, { method, url: String(url), lease });
        } else {
            requests.delete(this);
        }
        return Reflect.apply(originalOpen, this, args);
    };
    const wrappedXhrSend = function(this: XMLHttpRequest, ...args: unknown[]): unknown {
        const lease = getLease();
        const request = requests.get(this);
        if (lease && request?.lease === lease) {
            const body = requestBodyText(args[0]);
            const inspect = request.method.toUpperCase() === "POST"
                && shouldInspectFacebookGraphqlRequest(
                    request.url,
                    body,
                    target.location.href,
                );
            if (inspect) {
                this.addEventListener("load", () => {
                    if (getLease() !== lease || requests.get(this) !== request) {
                        return;
                    }
                    if (this.responseType === "" || this.responseType === "text") {
                        try {
                            const payloadText = this.responseText;
                            if (payloadText.length <= FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS) {
                                inspectTextResponse(payloadText, lease);
                            }
                        } catch {
                            /* response access can fail without affecting the page request */
                        }
                    }
                }, { once: true });
            }
        }
        return Reflect.apply(originalSend, this, args);
    };
    Object.defineProperty(xhrPrototype, "open", {
        ...originalXhrOpen,
        value: wrappedXhrOpen,
    });
    Object.defineProperty(xhrPrototype, "send", {
        ...originalXhrSend,
        value: wrappedXhrSend,
    });
    return {
        originalFetch,
        wrappedFetch,
        xhrPrototype,
        originalXhrOpen,
        originalXhrSend,
        wrappedXhrOpen,
        wrappedXhrSend,
    };
}

/**
 * Restores only transport properties that still reference this bridge's wrappers.
 *
 * @param target - Facebook page window whose wrappers may still be owned.
 * @param wrappers - Exact installed wrapper identities and original descriptors.
 */
function restoreTransportWrappers(
    target: Window,
    wrappers: InstalledFacebookTransportWrappers,
): void {
    try {
        if (target.fetch === wrappers.wrappedFetch) {
            target.fetch = wrappers.originalFetch;
        }
    } catch {
        /* page-owned fetch replacement remains untouched */
    }
    try {
        const open = Object.getOwnPropertyDescriptor(
            wrappers.xhrPrototype,
            "open",
        )?.value as unknown;
        if (open === wrappers.wrappedXhrOpen && wrappers.originalXhrOpen) {
            Object.defineProperty(
                wrappers.xhrPrototype,
                "open",
                wrappers.originalXhrOpen,
            );
        }
    } catch {
        /* page-owned XHR replacement remains untouched */
    }
    try {
        const send = Object.getOwnPropertyDescriptor(
            wrappers.xhrPrototype,
            "send",
        )?.value as unknown;
        if (send === wrappers.wrappedXhrSend && wrappers.originalXhrSend) {
            Object.defineProperty(
                wrappers.xhrPrototype,
                "send",
                wrappers.originalXhrSend,
            );
        }
    } catch {
        /* page-owned XHR replacement remains untouched */
    }
}

/**
 * Validates a page-realm lease command before it reaches bridge state.
 *
 * @param value - Candidate browser-injected or page-forged command.
 * @returns - Whether every credential and expiration field is bounded.
 */
function isFacebookBridgeLeaseCommand(value: unknown): value is FacebookBridgeLeaseCommand {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (
        typeof candidate.leaseId !== "string"
        || !FACEBOOK_BRIDGE_LEASE_ID.test(candidate.leaseId)
        || typeof candidate.active !== "boolean"
    ) {
        return false;
    }
    return candidate.active
        ? typeof candidate.secret === "string"
            && FACEBOOK_BRIDGE_SECRET.test(candidate.secret)
            && typeof candidate.expiresAt === "number"
            && Number.isSafeInteger(candidate.expiresAt)
        : true;
}

/**
 * Installs one versioned, leased Facebook payload bridge in the page's main world.
 *
 * Installation itself does not wrap or inspect requests. Browser-mediated lease
 * acquisition installs wrappers, and release or expiry restores only wrappers
 * still owned by this bridge.
 *
 * @param target - Facebook page window whose selected responses may be observed.
 */
export function installFacebookPayloadBridge(target: Window): void {
    const mutableTarget = target as Window & Record<symbol, unknown>;
    const existing = mutableTarget[FACEBOOK_PAYLOAD_BRIDGE_SLOT];
    if (
        existing !== null
        && typeof existing === "object"
        && !Array.isArray(existing)
        && unknownProperty(existing, "version") === FACEBOOK_PAYLOAD_BRIDGE_VERSION
        && typeof unknownProperty(existing, "reconcileLease") === "function"
    ) {
        return;
    }
    if (existing !== undefined) {
        const existingObject = existing !== null && typeof existing === "object"
            ? existing
            : null;
        const dispose = existingObject
            ? unknownProperty(existingObject, "dispose")
            : undefined;
        if (typeof dispose === "function" && existingObject !== null) {
            try {
                (dispose as (this: object) => unknown).call(existingObject);
            } catch {
                return;
            }
        }
        const descriptor = Object.getOwnPropertyDescriptor(
            mutableTarget,
            FACEBOOK_PAYLOAD_BRIDGE_SLOT,
        );
        if (descriptor && !descriptor.configurable) {
            return;
        }
    }

    let disposed = false;
    let generation = 0;
    let activeLease: ActiveFacebookBridgeLease | null = null;
    let expirationTimer: ReturnType<typeof setTimeout> | undefined;
    let wrappers: InstalledFacebookTransportWrappers | undefined;
    let activeInspections = 0;
    const activeReaders = new Set<ReadableStreamDefaultReader<Uint8Array>>();

    const getLease = (): ActiveFacebookBridgeLease | null => {
        if (disposed || activeLease === null || activeLease.expiresAt <= Date.now()) {
            return null;
        }
        return activeLease;
    };
    const isCurrent = (lease: ActiveFacebookBridgeLease): boolean =>
        getLease() === lease && lease.generation === generation;
    const cancelActiveReaders = (): void => {
        for (const reader of activeReaders) {
            void cancelReader(reader);
        }
        activeReaders.clear();
    };
    const inspectTextResponse = (
        payloadText: string,
        lease: ActiveFacebookBridgeLease,
    ): void => {
        if (
            !isCurrent(lease)
            || activeInspections >= FACEBOOK_TRANSPORT_LIMIT.MAX_CONCURRENT_INSPECTIONS
        ) {
            return;
        }
        activeInspections += 1;
        void emitPayloadRecords(
            target,
            payloadText,
            lease,
            () => isCurrent(lease),
        ).catch(() => undefined).finally(() => {
            activeInspections -= 1;
        });
    };
    const inspectFetchResponse = (
        response: Response,
        lease: ActiveFacebookBridgeLease,
    ): void => {
        if (
            !isCurrent(lease)
            || activeInspections >= FACEBOOK_TRANSPORT_LIMIT.MAX_CONCURRENT_INSPECTIONS
        ) {
            return;
        }
        activeInspections += 1;
        void readBoundedResponseText(
            response,
            () => isCurrent(lease),
            (reader) => {
                activeReaders.add(reader);
                return () => {
                    activeReaders.delete(reader);
                };
            },
        ).then(
            (payloadText) => payloadText === null
                ? undefined
                : emitPayloadRecords(
                    target,
                    payloadText,
                    lease,
                    () => isCurrent(lease),
                ),
        ).catch(() => undefined).finally(() => {
            activeInspections -= 1;
        });
    };
    const dispose = (): void => {
        if (disposed) {
            return;
        }
        disposed = true;
        generation += 1;
        activeLease = null;
        cancelActiveReaders();
        if (expirationTimer !== undefined) {
            clearTimeout(expirationTimer);
            expirationTimer = undefined;
        }
        if (wrappers) {
            restoreTransportWrappers(target, wrappers);
            wrappers = undefined;
        }
        if (mutableTarget[FACEBOOK_PAYLOAD_BRIDGE_SLOT] === slot) {
            Reflect.deleteProperty(mutableTarget, FACEBOOK_PAYLOAD_BRIDGE_SLOT);
        }
    };
    const reconcileLease = (command: FacebookBridgeLeaseCommand): boolean => {
        if (disposed || !isFacebookBridgeLeaseCommand(command)) {
            return false;
        }
        if (!command.active) {
            if (activeLease?.leaseId !== command.leaseId) {
                return false;
            }
            dispose();
            return true;
        }
        if (command.expiresAt <= Date.now()) {
            return false;
        }
        generation += 1;
        cancelActiveReaders();
        activeLease = {
            leaseId: command.leaseId,
            secret: command.secret,
            expiresAt: command.expiresAt,
            generation,
            sequence: 0,
        };
        if (!wrappers) {
            wrappers = installTransportWrappers(
                target,
                getLease,
                inspectFetchResponse,
                inspectTextResponse,
            );
        }
        if (expirationTimer !== undefined) {
            clearTimeout(expirationTimer);
        }
        const lease = activeLease;
        expirationTimer = setTimeout(() => {
            expirationTimer = undefined;
            if (activeLease === lease) {
                dispose();
            }
        }, Math.max(0, command.expiresAt - Date.now()));
        return true;
    };
    const slot: FacebookPayloadBridgeSlot = Object.freeze({
        version: FACEBOOK_PAYLOAD_BRIDGE_VERSION,
        reconcileLease,
        dispose,
    });
    try {
        Object.defineProperty(mutableTarget, FACEBOOK_PAYLOAD_BRIDGE_SLOT, {
            value: slot,
            configurable: true,
            enumerable: false,
            writable: false,
        });
    } catch {
        dispose();
    }
}

if (isFacebookUrl(new URL(window.location.href))) {
    installFacebookPayloadBridge(window);
}
