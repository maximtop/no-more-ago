/**
 * @file Captures selected Facebook GraphQL responses in the page's main JavaScript world.
 */

import { isFacebookHostname, isFacebookUrl } from "../../shared/url/facebook";
import {
    createFacebookPayloadBridgeReadyMessage,
    createFacebookPayloadMessage,
    isFacebookPayloadBridgeControlMessage,
} from "./contracts";
import { extractFacebookTimestampRecords } from "./payload-parser";

const FACEBOOK_PAYLOAD_BRIDGE_SLOT = Symbol.for("no-more-ago.facebook-payload-bridge");
const FACEBOOK_GRAPHQL_PATHNAME = "/api/graphql/" as const;
const FACEBOOK_STORY_QUERY_NAME = /(?:feed|timeline|story|permalink|post)/iu;

/**
 * Main-world singleton marker stored on the Facebook window.
 */
interface FacebookPayloadBridgeSlot {
    /**
     * Whether selected response inspection is currently allowed.
     */
    enabled: boolean;

    /**
     * Original fetch implementation retained for identity and diagnostics.
     */
    readonly originalFetch: Window["fetch"];

    /**
     * Original XMLHttpRequest open implementation retained before wrapping.
     */
    readonly originalXhrOpen: unknown;

    /**
     * Original XMLHttpRequest send implementation retained before wrapping.
     */
    readonly originalXhrSend: unknown;
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
}

/**
 * Converts a supported fetch body into text without consuming streams or blobs.
 *
 * @param body - Page-provided fetch request body.
 * @returns - Serialized form data, or null when synchronous inspection is unsafe.
 */
function requestBodyText(body: unknown): string | null {
    if (typeof body === "string") {
        return body;
    }
    if (body instanceof URLSearchParams) {
        return body.toString();
    }
    return null;
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
    if (body === null) {
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
    return queryName !== null && FACEBOOK_STORY_QUERY_NAME.test(queryName);
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
 * Parses a selected response clone and transfers only minimal timestamp records.
 *
 * @param target - Facebook page window receiving its own bridge message.
 * @param response - Successful fetch response selected by its request operation.
 * @param isEnabled - Reads current bridge activity before cloning and emission.
 * @returns - Promise settled after the response clone is inspected.
 */
async function emitResponseRecords(
    target: Window,
    response: Response,
    isEnabled: () => boolean,
): Promise<void> {
    try {
        if (!isEnabled()) {
            return;
        }
        const payloadText = await response.clone().text();
        if (isEnabled()) {
            emitPayloadRecords(target, payloadText);
        }
    } catch {
        /* response interception must never alter the page request outcome */
    }
}

/**
 * Transfers minimal records extracted from one selected serialized response.
 *
 * @param target - Facebook page window receiving its own bridge message.
 * @param payloadText - Selected GraphQL response text.
 */
function emitPayloadRecords(target: Window, payloadText: string): void {
    const records = extractFacebookTimestampRecords(payloadText);
    if (records.length > 0) {
        target.postMessage(createFacebookPayloadMessage(records), target.location.origin);
    }
}

/**
 * Installs an XMLHttpRequest wrapper for Facebook's current feed pagination transport.
 *
 * @param target - Facebook page window whose XMLHttpRequest prototype is wrapped.
 * @param isEnabled - Reads current bridge activity before inspection and emission.
 * @returns - Original open and send implementations retained by the singleton slot.
 */
function installFacebookXhrBridge(
    target: Window,
    isEnabled: () => boolean,
): {
    readonly originalXhrOpen: unknown;
    readonly originalXhrSend: unknown;
} {
    const xhrTarget = target as Window & {
        readonly XMLHttpRequest: typeof XMLHttpRequest;
    };
    const prototype = xhrTarget.XMLHttpRequest.prototype;
    const openDescriptor = Object.getOwnPropertyDescriptor(prototype, "open");
    const sendDescriptor = Object.getOwnPropertyDescriptor(prototype, "send");
    const originalXhrOpen: unknown = openDescriptor?.value;
    const originalXhrSend: unknown = sendDescriptor?.value;
    if (
        !openDescriptor
        || !sendDescriptor
        || typeof originalXhrOpen !== "function"
        || typeof originalXhrSend !== "function"
    ) {
        return { originalXhrOpen, originalXhrSend };
    }
    const requests = new WeakMap<XMLHttpRequest, FacebookXhrRequest>();
    Object.defineProperty(prototype, "open", {
        ...openDescriptor,
        value(this: XMLHttpRequest, ...args: unknown[]): unknown {
            const method = args[0];
            const url = args[1];
            if (typeof method === "string" && (typeof url === "string" || url instanceof URL)) {
                requests.set(this, { method, url: String(url) });
            } else {
                requests.delete(this);
            }
            return Reflect.apply(originalXhrOpen, this, args);
        },
    });
    Object.defineProperty(prototype, "send", {
        ...sendDescriptor,
        value(this: XMLHttpRequest, ...args: unknown[]): unknown {
            const request = requests.get(this);
            const body = requestBodyText(args[0]);
            const inspect = isEnabled()
                && request?.method.toUpperCase() === "POST"
                && shouldInspectFacebookGraphqlRequest(
                    request.url,
                    body,
                    target.location.href,
                );
            if (inspect) {
                this.addEventListener("load", () => {
                    if (!isEnabled() || requests.get(this) !== request) {
                        return;
                    }
                    if (this.responseType === "" || this.responseType === "text") {
                        try {
                            emitPayloadRecords(target, this.responseText);
                        } catch {
                            /* response access can fail without affecting the page request */
                        }
                    }
                }, { once: true });
            }
            return Reflect.apply(originalXhrSend, this, args);
        },
    });
    return { originalXhrOpen, originalXhrSend };
}

/**
 * Installs the idempotent Facebook fetch bridge in the page's main world.
 *
 * @param target - Facebook page window whose selected fetch responses are observed.
 */
export function installFacebookPayloadBridge(target: Window): void {
    const mutableTarget = target as Window & Record<
        symbol,
        FacebookPayloadBridgeSlot | undefined
    >;
    const existing = mutableTarget[FACEBOOK_PAYLOAD_BRIDGE_SLOT];
    if (existing) {
        target.postMessage(
            createFacebookPayloadBridgeReadyMessage(),
            target.location.origin,
        );
        return;
    }
    const originalFetch = target.fetch.bind(target);
    const slot = {
        enabled: false,
        originalFetch,
        originalXhrOpen: undefined,
        originalXhrSend: undefined,
    } as FacebookPayloadBridgeSlot;
    target.addEventListener("message", (event) => {
        if (
            event.source !== target
            || event.origin !== target.location.origin
            || !isFacebookPayloadBridgeControlMessage(event.data)
        ) {
            return;
        }
        slot.enabled = event.data.enabled;
    });
    const { originalXhrOpen, originalXhrSend } = installFacebookXhrBridge(
        target,
        () => slot.enabled,
    );
    const wrappedFetch: Window["fetch"] = (input, init) => {
        const response = Reflect.apply(originalFetch, target, [input, init]);
        if (!slot.enabled) {
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
                (value) => emitResponseRecords(target, value, () => slot.enabled),
                () => undefined,
            );
        }
        return response;
    };
    target.fetch = wrappedFetch;
    Object.assign(slot, { originalXhrOpen, originalXhrSend });
    mutableTarget[FACEBOOK_PAYLOAD_BRIDGE_SLOT] = slot;
    target.postMessage(
        createFacebookPayloadBridgeReadyMessage(),
        target.location.origin,
    );
}

if (isFacebookUrl(new URL(window.location.href))) {
    installFacebookPayloadBridge(window);
}
