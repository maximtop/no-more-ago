/**
 * @file Captures selected Facebook GraphQL responses in the page's main JavaScript world.
 */

import { isFacebookHostname, isFacebookUrl } from '../../shared/url/facebook';

import {
    FACEBOOK_PAYLOAD_BRIDGE_LEGACY_SLOT_KEY,
    FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY,
    FACEBOOK_PAYLOAD_LIMIT,
    createFacebookPayloadBridgeReadyMessage,
    createFacebookPayloadMessage,
    readFacebookBridgeControlEnabled,
} from './contracts';
import { extractFacebookTimestampUpdate } from './payload-parser';

const FACEBOOK_PAYLOAD_BRIDGE_SLOT = Symbol.for(FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY);
const FACEBOOK_PAYLOAD_BRIDGE_LEGACY_SLOT = Symbol.for(
    FACEBOOK_PAYLOAD_BRIDGE_LEGACY_SLOT_KEY,
);
const FACEBOOK_PAYLOAD_BRIDGE_VERSION = 3 as const;
const FACEBOOK_GRAPHQL_PATHNAME = '/api/graphql/' as const;
const FACEBOOK_QUERY_NAME = /^[\dA-Za-z_]+Query$/u;
const FACEBOOK_STORY_QUERY_CUES = [
    'NewsFeed',
    'HomeFeed',
    'TimelineFeed',
    'GroupsCometFeed',
    'PagesCometFeed',
    'Story',
    'Stories',
    'Permalink',
    'SinglePost',
] as const;

/**
 * Transport work limits applied before Story payload parsing.
 */
export const FACEBOOK_TRANSPORT_LIMIT = {
    MAX_REQUEST_BODY_CHARACTERS: 100_000,
    MAX_REQUEST_PARAMETERS: 1_000,
    MAX_CONCURRENT_INSPECTIONS: 2,
} as const;

/**
 * Main-world singleton marker for one installed bridge version.
 */
interface FacebookPayloadBridgeSlot {
    /**
     * Bridge contract version used for duplicate-install detection.
     */
    readonly version: typeof FACEBOOK_PAYLOAD_BRIDGE_VERSION;

    /**
     * Stops inspection and restores transport properties still owned by this bridge.
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
     * Exact enabled lifecycle generation that observed the open call.
     */
    readonly generation: number;
}

/**
 * Installed wrappers and descriptors needed for ownership-safe restoration.
 */
interface InstalledFacebookTransportWrappers {
    /**
     * Original page fetch function.
     */
    readonly originalFetch: Window['fetch'];

    /**
     * Fetch wrapper owned by this bridge.
     */
    readonly wrappedFetch: Window['fetch'];

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
 *
 * @returns - Unknown property value.
 */
function unknownProperty(value: object, property: string): unknown {
    return Reflect.get(value, property) as unknown;
}

/**
 * Reads the friendly operation name from a bounded form body without serializing it.
 *
 * @param body - Page-provided fetch or XMLHttpRequest body.
 *
 * @returns - Friendly operation name, or null when synchronous inspection is unsafe.
 */
function requestFriendlyName(body: unknown): string | null {
    let parameters: URLSearchParams;
    if (typeof body === 'string') {
        if (body.length > FACEBOOK_TRANSPORT_LIMIT.MAX_REQUEST_BODY_CHARACTERS) {
            return null;
        }
        parameters = new URLSearchParams(body);
    } else if (body instanceof URLSearchParams) {
        parameters = body;
    } else {
        return null;
    }
    let characters = 0;
    let count = 0;
    let friendlyName: string | null = null;
    for (const [name, value] of parameters) {
        count += 1;
        characters += name.length + value.length;
        if (
            count > FACEBOOK_TRANSPORT_LIMIT.MAX_REQUEST_PARAMETERS
            || characters > FACEBOOK_TRANSPORT_LIMIT.MAX_REQUEST_BODY_CHARACTERS
        ) {
            return null;
        }
        if (name === 'fb_api_req_friendly_name' && friendlyName === null) {
            friendlyName = value;
        }
    }
    return friendlyName;
}

/**
 * Checks whether one request is a Facebook Story-bearing GraphQL operation.
 *
 * @param requestUrl - Fetch input URL resolved by the page.
 * @param body - Synchronously inspectable raw request body.
 * @param baseHref - Current Facebook document URL used for relative requests.
 *
 * @returns - Whether the response is worth bounded Story parsing.
 */
export function shouldInspectFacebookGraphqlRequest(
    requestUrl: string,
    body: unknown,
    baseHref: string,
): boolean {
    let url: URL;
    try {
        url = new URL(requestUrl, baseHref);
    } catch {
        return false;
    }
    if (!isFacebookHostname(url.hostname) || url.pathname !== FACEBOOK_GRAPHQL_PATHNAME) {
        return false;
    }
    const queryName = requestFriendlyName(body);
    return queryName !== null
        && FACEBOOK_QUERY_NAME.test(queryName)
        && FACEBOOK_STORY_QUERY_CUES.some((cue) => queryName.includes(cue));
}

/**
 * Resolves the URL and safely inspectable body for one fetch call.
 *
 * @param input - Fetch request URL or Request object.
 * @param init - Optional fetch initialization override.
 *
 * @returns - Request details used for Story-query selection.
 */
function fetchRequestDetails(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
): { readonly url: string; readonly body: unknown } {
    const url = typeof input === 'string'
        ? input
        : input instanceof URL
            ? input.href
            : input.url;
    return {
        url,
        body: init?.body,
    };
}

/**
 * Cancels a cloned response reader without allowing cancellation failures to escape.
 *
 * @param reader - Cloned response stream reader.
 *
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
 * @param isCurrent - Checks the captured lifecycle generation between chunks.
 * @param registerReader - Retains the reader for immediate lifecycle cancellation.
 *
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
    const declaredLength = clone.headers.get('content-length');
    const decoder = new TextDecoder();
    let payloadText = '';
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
 * Extracts and transfers minimal records for one current lifecycle generation.
 *
 * @param target - Facebook page window receiving the bounded record envelope.
 * @param payloadText - Complete bounded selected response text.
 * @param isCurrent - Confirms the lifecycle generation before emission.
 */
function emitPayloadRecords(
    target: Window,
    payloadText: string,
    isCurrent: () => boolean,
): void {
    if (!isCurrent() || payloadText.length > FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS) {
        return;
    }
    const update = extractFacebookTimestampUpdate(payloadText);
    if (
        !update.invalidateAll
        && update.records.length === 0
        && update.invalidatedTrackingTokens.length === 0
    ) {
        return;
    }
    if (isCurrent()) {
        target.postMessage(createFacebookPayloadMessage(update), target.location.origin);
    }
}

/**
 * Installs inert fetch and XMLHttpRequest wrappers.
 *
 * @param target - Facebook page window whose transports are wrapped.
 * @param getGeneration - Returns the current enabled generation, or null while inactive.
 * @param inspectFetchResponse - Bounded asynchronous fetch response inspector.
 * @param inspectTextResponse - Bounded text response inspector.
 *
 * @returns - Wrapper ownership state used for safe restoration.
 */
function installTransportWrappers(
    target: Window,
    getGeneration: () => number | null,
    inspectFetchResponse: (response: Response, generation: number) => void,
    inspectTextResponse: (payloadText: string, generation: number) => void,
): InstalledFacebookTransportWrappers {
    const originalFetch = unknownProperty(target, 'fetch') as Window['fetch'];

    /**
     * Forwards to the page's fetch and inspects the response while the bridge is enabled.
     *
     * @param input - Fetch resource.
     * @param init - Fetch options.
     *
     * @returns - The page's fetch result.
     */
    const wrappedFetch: Window['fetch'] = (input, init) => {
        const response = Reflect.apply(originalFetch, target, [input, init]);
        const generation = getGeneration();
        if (generation === null) {
            return response;
        }
        try {
            const request = fetchRequestDetails(input, init);
            if (shouldInspectFacebookGraphqlRequest(
                request.url,
                request.body,
                target.location.href,
            )) {
                void response.then(
                    (value) => {
                        inspectFetchResponse(value, generation);
                    },
                    () => undefined,
                );
            }
        } catch {
            /* request selection must never alter the page request outcome */
        }
        return response;
    };
    target.fetch = wrappedFetch;

    const xhrTarget = target as Window & {
        readonly XMLHttpRequest: typeof XMLHttpRequest;
    };
    const xhrPrototype = xhrTarget.XMLHttpRequest.prototype;
    const originalXhrOpen = Object.getOwnPropertyDescriptor(xhrPrototype, 'open');
    const originalXhrSend = Object.getOwnPropertyDescriptor(xhrPrototype, 'send');
    const originalOpen = originalXhrOpen?.value as unknown;
    const originalSend = originalXhrSend?.value as unknown;
    if (
        !originalXhrOpen
        || !originalXhrSend
        || typeof originalOpen !== 'function'
        || typeof originalSend !== 'function'
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
    const wrappedXhrOpen = function (this: XMLHttpRequest, ...args: unknown[]): unknown {
        try {
            const generation = getGeneration();
            const method = args[0];
            const url = args[1];
            if (
                generation !== null
                && typeof method === 'string'
                && (typeof url === 'string' || url instanceof URL)
            ) {
                requests.set(this, { method, url: String(url), generation });
            } else {
                requests.delete(this);
            }
        } catch {
            /* request bookkeeping must never alter the page request outcome */
        }
        return Reflect.apply(originalOpen, this, args);
    };
    const wrappedXhrSend = function (this: XMLHttpRequest, ...args: unknown[]): unknown {
        try {
            const generation = getGeneration();
            const request = requests.get(this);
            if (
                generation !== null
                && request?.generation === generation
                && request.method.toUpperCase() === 'POST'
                && shouldInspectFacebookGraphqlRequest(
                    request.url,
                    args[0],
                    target.location.href,
                )
            ) {
                this.addEventListener('load', () => {
                    if (
                        getGeneration() !== generation
                        || requests.get(this) !== request
                    ) {
                        return;
                    }
                    if (this.responseType === '' || this.responseType === 'text') {
                        try {
                            const payloadText = this.responseText;
                            if (payloadText.length <= FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS) {
                                inspectTextResponse(payloadText, generation);
                            }
                        } catch {
                            /* response access can fail without affecting the page request */
                        }
                    }
                }, { once: true });
            }
        } catch {
            /* selection and listener installation must never block native send */
        }
        return Reflect.apply(originalSend, this, args);
    };
    Object.defineProperty(xhrPrototype, 'open', {
        ...originalXhrOpen,
        value: wrappedXhrOpen,
    });
    Object.defineProperty(xhrPrototype, 'send', {
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
            'open',
        )?.value as unknown;
        if (open === wrappers.wrappedXhrOpen && wrappers.originalXhrOpen) {
            Object.defineProperty(
                wrappers.xhrPrototype,
                'open',
                wrappers.originalXhrOpen,
            );
        }
    } catch {
        /* page-owned XHR replacement remains untouched */
    }
    try {
        const send = Object.getOwnPropertyDescriptor(
            wrappers.xhrPrototype,
            'send',
        )?.value as unknown;
        if (send === wrappers.wrappedXhrSend && wrappers.originalXhrSend) {
            Object.defineProperty(
                wrappers.xhrPrototype,
                'send',
                wrappers.originalXhrSend,
            );
        }
    } catch {
        /* page-owned XHR replacement remains untouched */
    }
}

/**
 * Installs one versioned Facebook payload bridge in the page's main world.
 *
 * The page world is not an authentication boundary. The bridge therefore holds
 * no secret or privileged capability: lifecycle messages only make its bounded
 * wrappers active or inert, while the isolated consumer independently follows
 * extension policy.
 *
 * @param target - Facebook page window whose selected responses may be observed.
 */
export function installFacebookPayloadBridge(target: Window): void {
    const mutableTarget = target as Window & Record<symbol, unknown>;
    const legacy = Object.getOwnPropertyDescriptor(
        mutableTarget,
        FACEBOOK_PAYLOAD_BRIDGE_LEGACY_SLOT,
    )?.value as unknown;
    const legacyObject = legacy !== null && typeof legacy === 'object'
        ? legacy
        : undefined;
    const legacyDispose = legacyObject
        ? unknownProperty(legacyObject, 'dispose')
        : undefined;
    if (typeof legacyDispose === 'function' && legacyObject) {
        try {
            (legacyDispose as (this: object) => unknown).call(legacyObject);
        } catch {
            /* an obsolete bridge cannot prevent installation under the current key */
        }
    }
    const existingDescriptor = Object.getOwnPropertyDescriptor(
        mutableTarget,
        FACEBOOK_PAYLOAD_BRIDGE_SLOT,
    );
    const existing = existingDescriptor?.value as unknown;
    if (
        existing !== null
        && typeof existing === 'object'
        && !Array.isArray(existing)
        && unknownProperty(existing, 'version') === FACEBOOK_PAYLOAD_BRIDGE_VERSION
        && typeof unknownProperty(existing, 'dispose') === 'function'
    ) {
        target.postMessage(createFacebookPayloadBridgeReadyMessage(), target.location.origin);
        return;
    }
    if (existing !== undefined) {
        const existingObject = existing !== null && typeof existing === 'object'
            ? existing
            : undefined;
        const dispose = existingObject
            ? unknownProperty(existingObject, 'dispose')
            : undefined;
        if (typeof dispose === 'function' && existingObject) {
            try {
                (dispose as (this: object) => unknown).call(existingObject);
            } catch {
                /* stale bridge cleanup is best-effort */
            }
        }
        if (existingDescriptor && !existingDescriptor.configurable) {
            return;
        }
    }

    let enabled = false;
    let generation = 0;
    let disposed = false;
    let activeInspections = 0;
    const activeReaders = new Set<ReadableStreamDefaultReader<Uint8Array>>();

    /**
     * Reports the active bridge generation, or null while disabled or disposed.
     *
     * @returns - Active generation, or null.
     */
    const getGeneration = (): number | null => (enabled && !disposed ? generation : null);

    /**
     * Reports whether a captured generation is still the active one.
     *
     * @param capturedGeneration - Generation captured when a response arrived.
     *
     * @returns - Whether the generation is still active.
     */
    const isCurrent = (capturedGeneration: number): boolean => getGeneration() === capturedGeneration;

    /**
     * Cancels every response reader still inspecting a body.
     */
    const cancelActiveReaders = (): void => {
        for (const reader of activeReaders) {
            void cancelReader(reader);
        }
        activeReaders.clear();
    };

    /**
     * Extracts timestamp records from a response body captured under a generation.
     *
     * @param payloadText - Response body text.
     * @param capturedGeneration - Generation captured when the response arrived.
     */
    const inspectTextResponse = (
        payloadText: string,
        capturedGeneration: number,
    ): void => {
        if (
            !isCurrent(capturedGeneration)
            || activeInspections >= FACEBOOK_TRANSPORT_LIMIT.MAX_CONCURRENT_INSPECTIONS
        ) {
            return;
        }
        activeInspections += 1;
        try {
            emitPayloadRecords(
                target,
                payloadText,
                () => isCurrent(capturedGeneration),
            );
        } finally {
            activeInspections -= 1;
        }
    };

    /**
     * Reads a cloned fetch response body for timestamp records.
     *
     * @param response - Fetch response to inspect.
     * @param capturedGeneration - Generation captured when the response arrived.
     */
    const inspectFetchResponse = (
        response: Response,
        capturedGeneration: number,
    ): void => {
        if (
            !isCurrent(capturedGeneration)
            || activeInspections >= FACEBOOK_TRANSPORT_LIMIT.MAX_CONCURRENT_INSPECTIONS
        ) {
            return;
        }
        activeInspections += 1;
        void readBoundedResponseText(
            response,
            () => isCurrent(capturedGeneration),
            (reader) => {
                activeReaders.add(reader);
                return () => {
                    activeReaders.delete(reader);
                };
            },
        ).then((payloadText) => {
            if (payloadText !== null) {
                emitPayloadRecords(
                    target,
                    payloadText,
                    () => isCurrent(capturedGeneration),
                );
            }
        }).catch(() => undefined).finally(() => {
            activeInspections -= 1;
        });
    };
    const wrappers = installTransportWrappers(
        target,
        getGeneration,
        inspectFetchResponse,
        inspectTextResponse,
    );

    /**
     * Applies bridge control messages posted by the isolated runtime.
     *
     * @param event - Window message event.
     */
    const messageListener = (event: MessageEvent): void => {
        const requested = event.source === target
            && event.origin === target.location.origin
            ? readFacebookBridgeControlEnabled(event.data)
            : null;
        if (requested === null || requested === enabled) {
            return;
        }
        generation += 1;
        enabled = requested;
        if (!enabled) {
            cancelActiveReaders();
        }
    };
    target.addEventListener('message', messageListener);

    /**
     * Disables the bridge, restores the page transports, and releases readers.
     */
    const dispose = (): void => {
        if (disposed) {
            return;
        }
        disposed = true;
        enabled = false;
        generation += 1;
        cancelActiveReaders();
        target.removeEventListener('message', messageListener);
        restoreTransportWrappers(target, wrappers);
        const descriptor = Object.getOwnPropertyDescriptor(
            mutableTarget,
            FACEBOOK_PAYLOAD_BRIDGE_SLOT,
        );
        const installed = descriptor?.value as unknown;
        if (
            installed !== null
            && typeof installed === 'object'
            && unknownProperty(installed, 'dispose') === dispose
            && descriptor?.configurable === true
        ) {
            Reflect.deleteProperty(mutableTarget, FACEBOOK_PAYLOAD_BRIDGE_SLOT);
        }
    };
    const slot: FacebookPayloadBridgeSlot = Object.freeze({
        version: FACEBOOK_PAYLOAD_BRIDGE_VERSION,
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
        return;
    }
    target.postMessage(createFacebookPayloadBridgeReadyMessage(), target.location.origin);
}

if (isFacebookUrl(new URL(window.location.href))) {
    installFacebookPayloadBridge(window);
}
