/**
 * @file Verifies leased lifecycle, bounded transport work, and request transparency.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    FACEBOOK_PAYLOAD_LIMIT,
    isFacebookPayloadMessage,
    verifyFacebookPayloadMessage,
} from "../../../../src/content-script/facebook/contracts";
import {
    FACEBOOK_TRANSPORT_LIMIT,
    installFacebookPayloadBridge,
    shouldInspectFacebookGraphqlRequest,
} from "../../../../src/content-script/facebook/main-world";
import type { FacebookBridgeLeaseCommand } from
    "../../../../src/shared/messaging/facebook-bridge";

const TRACKING_TOKEN = "AZ-facebook-main-world-token-1234567890";
const FACEBOOK_ORIGIN = "https://www.facebook.com";
const LEASE_ID = "12345678-1234-1234-1234-123456789abc";
const SECOND_LEASE_ID = "abcdef12-1234-1234-1234-123456789abc";
const SECRET = "ab".repeat(32);
const SECOND_SECRET = "cd".repeat(32);
const BRIDGE_SLOT = Symbol.for("no-more-ago.facebook-payload-bridge");
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
 * Applies one active lease through the versioned public bridge boundary.
 *
 * @param target - Controlled main-world window.
 * @param leaseId - Opaque lease identity.
 * @param secret - HMAC secret paired with the isolated runtime.
 * @param expiresAt - Absolute lease expiration.
 * @returns - Whether the installed bridge accepted the command.
 */
function activate(
    target: Window,
    leaseId = LEASE_ID,
    secret = SECRET,
    expiresAt = Date.now() + 60_000,
): boolean {
    return command(target, { active: true, leaseId, secret, expiresAt });
}

/**
 * Applies one lease command through the bridge's browser-injected surface.
 *
 * @param target - Controlled main-world window.
 * @param value - Active or release command.
 * @returns - Whether the command was accepted.
 */
function command(target: Window, value: FacebookBridgeLeaseCommand): boolean {
    const slot = (target as unknown as Record<symbol, unknown>)[BRIDGE_SLOT];
    if (slot === null || typeof slot !== "object") {
        return false;
    }
    const reconcileLease = (slot as {
        readonly reconcileLease?: (command: FacebookBridgeLeaseCommand) => unknown;
    }).reconcileLease;
    return typeof reconcileLease === "function"
        && reconcileLease(value) === true;
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
 * Allows response streams, signing, and record emission to settle.
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
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("Facebook main-world bridge", () => {
    it("stays inert and idempotent until a browser-mediated lease is acquired", () => {
        const { target, fetch } = harness();

        installFacebookPayloadBridge(target);
        installFacebookPayloadBridge(target);

        expect(Reflect.get(target, "fetch")).toBe(fetch);
        expect(activate(target)).toBe(true);
        const wrappedFetch: unknown = Reflect.get(target, "fetch");
        installFacebookPayloadBridge(target);
        expect(Reflect.get(target, "fetch")).toBe(wrappedFetch);
        expect(Reflect.get(target, "fetch")).not.toBe(fetch);
    });

    it("emits only authenticated minimal records for a selected fetch", async () => {
        const response = new Response(responsePayload());
        const clone = vi.spyOn(response, "clone");
        const { target, postMessage } = harness(Promise.resolve(response));
        installFacebookPayloadBridge(target);
        activate(target);

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
            throw new Error("Expected authenticated payload message");
        }
        expect(message.records).toEqual([{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: "1787933301",
        }]);
        await expect(verifyFacebookPayloadMessage(message, SECRET)).resolves.toBe(true);
    });

    it("rejects a response from an older activation generation after renewal", async () => {
        let resolveResponse: ((response: Response) => void) | undefined;
        const pagePromise = new Promise<Response>((resolve) => {
            resolveResponse = resolve;
        });
        const response = new Response(responsePayload());
        const clone = vi.spyOn(response, "clone");
        const { target, postMessage } = harness(pagePromise);
        installFacebookPayloadBridge(target);
        activate(target);

        const returned = target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        activate(target, SECOND_LEASE_ID, SECOND_SECRET);
        resolveResponse?.(response);
        await returned;
        await flushAsync();

        expect(clone).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
    });

    it("caps a streamed response before parsing and cancels the clone", async () => {
        const cancel = vi.fn(() => Promise.resolve());
        const releaseLock = vi.fn();
        let readCount = 0;
        const read = vi.fn(() => {
            readCount += 1;
            return Promise.resolve(readCount === 1
                ? {
                    done: false as const,
                    value: new Uint8Array(FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS + 1),
                }
                : { done: true as const, value: undefined });
        });
        const clone = vi.fn(() => ({
            headers: new Headers(),
            body: { getReader: () => ({ read, cancel, releaseLock }) },
        }) as unknown as Response);
        const response = { clone } as unknown as Response;
        const { target, postMessage } = harness(Promise.resolve(response));
        installFacebookPayloadBridge(target);
        activate(target);

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
            if (!current) {
                return Promise.reject(new Error("Missing controlled response"));
            }
            return Promise.resolve(current.response);
        });
        installFacebookPayloadBridge(target);
        activate(target);

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

    it("cancels an active response reader when the lease is released", async () => {
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
        activate(target);

        await target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        await vi.waitFor(() => {
            expect(read).toHaveBeenCalledOnce();
        });

        expect(command(target, { active: false, leaseId: LEASE_ID })).toBe(true);
        expect(cancel).toHaveBeenCalledOnce();
    });

    it("expires without renewal and restores only wrappers it still owns", async () => {
        vi.useFakeTimers();
        const { target } = harness();
        const originalOpen: unknown = Reflect.get(TestXmlHttpRequest.prototype, "open");
        const originalSend: unknown = Reflect.get(TestXmlHttpRequest.prototype, "send");
        installFacebookPayloadBridge(target);
        activate(target, LEASE_ID, SECRET, Date.now() + 1_000);
        const pageFetch = vi.fn<Window["fetch"]>(() => Promise.resolve(new Response("{}")));
        target.fetch = pageFetch;

        await vi.advanceTimersByTimeAsync(1_000);

        expect(Reflect.get(target, "fetch")).toBe(pageFetch);
        expect(Reflect.get(TestXmlHttpRequest.prototype, "open")).toBe(originalOpen);
        expect(Reflect.get(TestXmlHttpRequest.prototype, "send")).toBe(originalSend);
        expect((target as unknown as Record<symbol, unknown>)[BRIDGE_SLOT]).toBeUndefined();
    });

    it("preserves XHR returns and accepts only current POST text responses", async () => {
        const { target, postMessage } = harness();
        installFacebookPayloadBridge(target);
        const inactive = xhr(target);
        inactive.responseText = responsePayload();
        expect(inactive.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`)).toBe("open-result");
        expect(inactive.send(selectedBody())).toBe("send-result");
        inactive.dispatchEvent(new Event("load"));
        expect(postMessage).not.toHaveBeenCalled();

        activate(target);
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

    it("does not emit an XHR opened under an older lease", async () => {
        const { target, postMessage } = harness();
        installFacebookPayloadBridge(target);
        activate(target);
        const request = xhr(target);
        request.responseText = responsePayload();
        request.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`);
        request.send(selectedBody());

        activate(target, SECOND_LEASE_ID, SECOND_SECRET);
        request.dispatchEvent(new Event("load"));
        await flushAsync();

        expect(postMessage).not.toHaveBeenCalled();
    });

    it("returns the original rejected fetch promise without emitting", async () => {
        const error = new Error("page network failure");
        const pagePromise = Promise.reject(error);
        const { target, postMessage } = harness(pagePromise);
        installFacebookPayloadBridge(target);
        activate(target);

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
            selectedBody(friendlyName).toString(),
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
});
