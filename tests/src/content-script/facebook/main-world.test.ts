/**
 * @file Verifies bounded Facebook transport work and page-request transparency.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    FACEBOOK_PAYLOAD_BRIDGE_LEGACY_SLOT_KEY,
    FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY,
    FACEBOOK_PAYLOAD_LIMIT,
    createFacebookPayloadBridgeControlMessage,
    isFacebookPayloadMessage,
} from "../../../../src/content-script/facebook/contracts";
import {
    FACEBOOK_TRANSPORT_LIMIT,
    installFacebookPayloadBridge,
    shouldInspectFacebookGraphqlRequest,
} from "../../../../src/content-script/facebook/main-world";

const TRACKING_TOKEN = "AZ-facebook-main-world-token-1234567890";
const FACEBOOK_ORIGIN = "https://www.facebook.com";
const BRIDGE_SLOT = Symbol.for(FACEBOOK_PAYLOAD_BRIDGE_SLOT_KEY);
const LEGACY_BRIDGE_SLOT = Symbol.for(FACEBOOK_PAYLOAD_BRIDGE_LEGACY_SLOT_KEY);
const installedTargets: Window[] = [];

/**
 * Minimal controllable XMLHttpRequest used at the public bridge boundary.
 */
class TestXmlHttpRequest extends EventTarget {
    /**
     * Response type selected by page code.
     */
    public responseType: XMLHttpRequestResponseType = "";

    /**
     * Text response exposed after the load event.
     */
    public responseText = "";

    /**
     * Most recent open arguments observed by the original implementation.
     */
    public openArguments: readonly unknown[] = [];

    /**
     * Most recent send arguments observed by the original implementation.
     */
    public sendArguments: readonly unknown[] = [];

    /**
     * Records one page-owned open call.
     *
     * @param args - XMLHttpRequest open arguments.
     * @returns - Stable value proving wrapper return transparency.
     */
    public open(...args: unknown[]): string {
        this.openArguments = args;
        return "open-result";
    }

    /**
     * Records one page-owned send call.
     *
     * @param args - XMLHttpRequest send arguments.
     * @returns - Stable value proving wrapper return transparency.
     */
    public send(...args: unknown[]): string {
        this.sendArguments = args;
        return "send-result";
    }
}

/**
 * Creates a selected Facebook GraphQL request body.
 *
 * @param friendlyName - Story-bearing operation name.
 * @returns - Form-encoded operation metadata.
 */
function selectedBody(friendlyName = "CometNewsFeedQuery"): URLSearchParams {
    return new URLSearchParams({ fb_api_req_friendly_name: friendlyName });
}

/**
 * Creates a minimal Story-bearing response payload.
 *
 * @returns - Serialized Facebook response fixture.
 */
function responsePayload(): string {
    return JSON.stringify({
        data: {
            node: {
                __typename: "Story",
                creation_time: 1_787_933_301,
                encrypted_click_tracking: TRACKING_TOKEN,
            },
        },
    });
}

/**
 * Creates one controlled page window and transport response.
 *
 * @param response - Promise returned by the page's original fetch implementation.
 * @returns - Window and observable page transport spies.
 */
function harness(response: Promise<Response> = Promise.resolve(new Response("{}"))) {
    const events = new EventTarget();
    const postMessage = vi.fn();
    const fetch = vi.fn(() => response);
    const target = Object.assign(events, {
        location: {
            href: `${FACEBOOK_ORIGIN}/home`,
            origin: FACEBOOK_ORIGIN,
        },
        postMessage,
        fetch,
        XMLHttpRequest: TestXmlHttpRequest,
    }) as unknown as Window;
    installedTargets.push(target);
    return { target, postMessage, fetch };
}

/**
 * Changes the bridge's coordination state through its same-window message boundary.
 *
 * @param target - Controlled main-world window.
 * @param enabled - Whether bounded response inspection may run.
 */
function setEnabled(target: Window, enabled: boolean): void {
    target.dispatchEvent(new MessageEvent("message", {
        data: createFacebookPayloadBridgeControlMessage(enabled),
        origin: target.location.origin,
        source: target,
    }));
}

/**
 * Creates one request from the controlled window's transport constructor.
 *
 * @param target - Controlled page window.
 * @returns - Test request whose prototype may be wrapped by the bridge.
 */
function xhr(target: Window): TestXmlHttpRequest {
    const xhrTarget = target as unknown as {
        readonly XMLHttpRequest: typeof TestXmlHttpRequest;
    };
    return new xhrTarget.XMLHttpRequest();
}

/**
 * Allows response streams and record emission to settle.
 *
 * @returns - Promise resolved after queued tasks and microtasks.
 */
async function flushAsync(): Promise<void> {
    for (let index = 0; index < 6; index += 1) {
        await Promise.resolve();
    }
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

afterEach(() => {
    for (const target of installedTargets.splice(0)) {
        const slot = (target as unknown as Record<symbol, unknown>)[BRIDGE_SLOT];
        const dispose = slot !== null && typeof slot === "object"
            ? (slot as { readonly dispose?: () => unknown }).dispose
            : undefined;
        if (typeof dispose === "function") {
            dispose();
        }
    }
    vi.restoreAllMocks();
});

describe("Facebook main-world bridge", () => {
    it("installs one inert wrapper and remains idempotent", async () => {
        const response = new Response(responsePayload());
        const clone = vi.spyOn(response, "clone");
        const { target, postMessage, fetch } = harness(Promise.resolve(response));

        installFacebookPayloadBridge(target);
        const wrappedFetch: unknown = Reflect.get(target, "fetch");
        installFacebookPayloadBridge(target);
        postMessage.mockClear();
        await target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        await flushAsync();

        expect(wrappedFetch).not.toBe(fetch);
        expect(Reflect.get(target, "fetch")).toBe(wrappedFetch);
        expect(fetch).toHaveBeenCalledOnce();
        expect(clone).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
    });

    it("emits only minimal bounded records for a selected fetch", async () => {
        const response = new Response(responsePayload());
        const clone = vi.spyOn(response, "clone");
        const { target, postMessage } = harness(Promise.resolve(response));
        installFacebookPayloadBridge(target);
        setEnabled(target, true);
        postMessage.mockClear();

        await target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        await vi.waitFor(() => {
            expect(postMessage).toHaveBeenCalledOnce();
        });

        expect(clone).toHaveBeenCalledOnce();
        const message = postMessage.mock.calls[0]?.[0] as unknown;
        expect(isFacebookPayloadMessage(message)).toBe(true);
        if (!isFacebookPayloadMessage(message)) {
            throw new Error("Expected bounded payload message");
        }
        expect(message).toMatchObject({
            records: [{
                trackingToken: TRACKING_TOKEN,
                rawDatetime: "1787933301",
            }],
            invalidatedTrackingTokens: [],
            invalidateAll: false,
        });
    });

    it("rejects a response from an older enabled generation", async () => {
        let resolveResponse: ((response: Response) => void) | undefined;
        const pagePromise = new Promise<Response>((resolve) => {
            resolveResponse = resolve;
        });
        const response = new Response(responsePayload());
        const clone = vi.spyOn(response, "clone");
        const { target, postMessage } = harness(pagePromise);
        installFacebookPayloadBridge(target);
        setEnabled(target, true);
        postMessage.mockClear();

        const returned = target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        setEnabled(target, false);
        setEnabled(target, true);
        resolveResponse?.(response);
        await returned;
        await flushAsync();

        expect(clone).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
    });

    it("caps a streamed response before parsing and cancels the clone", async () => {
        const cancel = vi.fn(() => Promise.resolve());
        const releaseLock = vi.fn();
        const read = vi.fn(() => Promise.resolve({
            done: false as const,
            value: new Uint8Array(FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS + 1),
        }));
        const clone = vi.fn(() => ({
            headers: new Headers(),
            body: { getReader: () => ({ read, cancel, releaseLock }) },
        }) as unknown as Response);
        const { target, postMessage } = harness(Promise.resolve({ clone } as unknown as Response));
        installFacebookPayloadBridge(target);
        setEnabled(target, true);
        postMessage.mockClear();

        await target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        await vi.waitFor(() => {
            expect(cancel).toHaveBeenCalledOnce();
        });

        expect(read).toHaveBeenCalledOnce();
        expect(postMessage).not.toHaveBeenCalled();
    });

    it("bounds simultaneous fetch inspections", async () => {
        const pendingReads: (() => void)[] = [];
        const responses = Array.from({
            length: FACEBOOK_TRANSPORT_LIMIT.MAX_CONCURRENT_INSPECTIONS + 1,
        }, () => {
            const read = vi.fn(() => new Promise<{
                readonly done: true;
                readonly value: undefined;
            }>((resolve) => {
                pendingReads.push(() => {
                    resolve({ done: true, value: undefined });
                });
            }));
            return {
                response: {
                    clone: vi.fn(() => ({
                        headers: new Headers(),
                        body: {
                            getReader: () => ({
                                read,
                                cancel: vi.fn(),
                                releaseLock: vi.fn(),
                            }),
                        },
                    }) as unknown as Response),
                } as unknown as Response,
                read,
            };
        });
        let responseIndex = 0;
        const { target } = harness();
        target.fetch = vi.fn(() => {
            const current = responses[responseIndex];
            responseIndex += 1;
            return current
                ? Promise.resolve(current.response)
                : Promise.reject(new Error("Missing controlled response"));
        });
        installFacebookPayloadBridge(target);
        setEnabled(target, true);

        for (let index = 0; index < responses.length; index += 1) {
            await target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
                method: "POST",
                body: selectedBody(),
            });
        }
        await Promise.resolve();

        expect(responses.at(-1)?.read).not.toHaveBeenCalled();
        for (const complete of pendingReads) {
            complete();
        }
        await flushAsync();
    });

    it("cancels an active response reader when inspection is disabled", async () => {
        const read = vi.fn(() => new Promise<never>(() => undefined));
        const cancel = vi.fn(() => Promise.resolve());
        const response = {
            clone: vi.fn(() => ({
                headers: new Headers(),
                body: {
                    getReader: () => ({
                        read,
                        cancel,
                        releaseLock: vi.fn(),
                    }),
                },
            }) as unknown as Response),
        } as unknown as Response;
        const { target } = harness(Promise.resolve(response));
        installFacebookPayloadBridge(target);
        setEnabled(target, true);

        await target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        await vi.waitFor(() => {
            expect(read).toHaveBeenCalledOnce();
        });
        setEnabled(target, false);

        expect(cancel).toHaveBeenCalledOnce();
    });

    it("replaces an immutable legacy bridge during an extension update", () => {
        const { target } = harness();
        const staleDispose = vi.fn();
        Object.defineProperty(target, LEGACY_BRIDGE_SLOT, {
            value: { version: 2, dispose: staleDispose },
            configurable: false,
        });

        installFacebookPayloadBridge(target);

        expect(staleDispose).toHaveBeenCalledOnce();
        expect(Reflect.get(
            (target as unknown as Record<symbol, unknown>)[BRIDGE_SLOT] as object,
            "version",
        )).toBe(3);
        expect(Object.getOwnPropertyDescriptor(target, BRIDGE_SLOT)?.configurable)
            .toBe(true);
    });

    it("preserves XHR returns and accepts only current POST text responses", async () => {
        const { target, postMessage } = harness();
        installFacebookPayloadBridge(target);
        const inactive = xhr(target);
        inactive.responseText = responsePayload();
        expect(inactive.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`)).toBe("open-result");
        expect(inactive.send(selectedBody())).toBe("send-result");
        inactive.dispatchEvent(new Event("load"));
        postMessage.mockClear();

        setEnabled(target, true);
        const active = xhr(target);
        active.responseText = responsePayload();
        expect(active.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`)).toBe("open-result");
        expect(active.send(selectedBody())).toBe("send-result");
        active.dispatchEvent(new Event("load"));
        await vi.waitFor(() => {
            expect(postMessage).toHaveBeenCalledOnce();
        });
        expect(isFacebookPayloadMessage(postMessage.mock.calls[0]?.[0])).toBe(true);
    });

    it("always calls native XHR send when request-body iteration throws", () => {
        const { target } = harness();
        installFacebookPayloadBridge(target);
        setEnabled(target, true);
        const request = xhr(target);
        request.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`);
        const body = selectedBody();
        Object.defineProperty(body, Symbol.iterator, {
            value: () => {
                throw new Error("page iterator failure");
            },
        });

        expect(request.send(body)).toBe("send-result");
        expect(request.sendArguments).toHaveLength(1);
        expect(request.sendArguments[0]).toBe(body);
    });

    it("always calls native XHR send when listener installation throws", () => {
        const { target } = harness();
        installFacebookPayloadBridge(target);
        setEnabled(target, true);
        const request = xhr(target);
        request.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`);
        request.addEventListener = vi.fn(() => {
            throw new Error("page listener failure");
        });
        const body = selectedBody();

        expect(request.send(body)).toBe("send-result");
        expect(request.sendArguments).toEqual([body]);
    });

    it("does not emit an XHR opened under an older enabled generation", async () => {
        const { target, postMessage } = harness();
        installFacebookPayloadBridge(target);
        setEnabled(target, true);
        const request = xhr(target);
        request.responseText = responsePayload();
        request.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`);
        request.send(selectedBody());
        postMessage.mockClear();

        setEnabled(target, false);
        setEnabled(target, true);
        request.dispatchEvent(new Event("load"));
        await flushAsync();

        expect(postMessage).not.toHaveBeenCalled();
    });

    it("returns the original rejected fetch promise without emitting", async () => {
        const error = new Error("page network failure");
        const pagePromise = Promise.reject(error);
        const { target, postMessage } = harness(pagePromise);
        installFacebookPayloadBridge(target);
        setEnabled(target, true);
        postMessage.mockClear();

        const returned = target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });

        expect(returned).toBe(pagePromise);
        await expect(returned).rejects.toBe(error);
        expect(postMessage).not.toHaveBeenCalled();
    });

    it.each([
        "CometFeedbackQuery",
        "CometPostComposerQuery",
        "CometNewsFeedQueryExtra",
        "prefixCometPermalinkMutation",
    ])("rejects the similar non-Story operation %s", (friendlyName) => {
        expect(shouldInspectFacebookGraphqlRequest(
            `${FACEBOOK_ORIGIN}/api/graphql/`,
            selectedBody(friendlyName),
            `${FACEBOOK_ORIGIN}/home`,
        )).toBe(false);
    });

    it("rejects an oversized synchronously inspectable request body", () => {
        const body = `fb_api_req_friendly_name=CometNewsFeedQuery&padding=${"x".repeat(
            FACEBOOK_TRANSPORT_LIMIT.MAX_REQUEST_BODY_CHARACTERS,
        )}`;

        expect(shouldInspectFacebookGraphqlRequest(
            `${FACEBOOK_ORIGIN}/api/graphql/`,
            body,
            `${FACEBOOK_ORIGIN}/home`,
        )).toBe(false);
    });

    it("inspects URLSearchParams without serializing an unbounded body", () => {
        const body = selectedBody();
        const toString = vi.spyOn(body, "toString").mockImplementation(() => {
            throw new Error("must not serialize");
        });

        expect(shouldInspectFacebookGraphqlRequest(
            `${FACEBOOK_ORIGIN}/api/graphql/`,
            body,
            `${FACEBOOK_ORIGIN}/home`,
        )).toBe(true);
        expect(toString).not.toHaveBeenCalled();

        for (let index = 0; index < FACEBOOK_TRANSPORT_LIMIT.MAX_REQUEST_PARAMETERS; index += 1) {
            body.append("", "");
        }
        expect(shouldInspectFacebookGraphqlRequest(
            `${FACEBOOK_ORIGIN}/api/graphql/`,
            body,
            `${FACEBOOK_ORIGIN}/home`,
        )).toBe(false);
    });
});
