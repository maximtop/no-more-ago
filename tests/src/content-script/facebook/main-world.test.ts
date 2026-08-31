/**
 * @file Verifies lifecycle control and request transparency of the Facebook bridge.
 */

import { describe, expect, it, vi } from "vitest";

import {
    createFacebookPayloadBridgeControlMessage,
} from "../../../../src/content-script/facebook/contracts";
import {
    installFacebookPayloadBridge,
} from "../../../../src/content-script/facebook/main-world";

const TRACKING_TOKEN = "AZ-facebook-main-world-token-1234567890";
const FACEBOOK_ORIGIN = "https://www.facebook.com";

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
 * @returns - Form-encoded Story-bearing operation metadata.
 */
function selectedBody(): URLSearchParams {
    return new URLSearchParams({ fb_api_req_friendly_name: "CometNewsFeedQuery" });
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
 * @returns - Window, transport spies, and response clone spies.
 */
function harness(response: Promise<Response> = Promise.resolve({} as Response)) {
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
    return { target, postMessage, fetch };
}

/**
 * Dispatches one same-window, same-origin bridge lifecycle command.
 *
 * @param target - Controlled page window.
 * @param enabled - Requested bridge state.
 */
function control(target: Window, enabled: boolean): void {
    target.dispatchEvent(new MessageEvent("message", {
        data: createFacebookPayloadBridgeControlMessage(enabled),
        origin: FACEBOOK_ORIGIN,
        source: target,
    }));
}

/**
 * Creates one request from the controlled window's transport constructor.
 *
 * @param target - Controlled page window.
 * @returns - Test request whose prototype was wrapped by the bridge.
 */
function xhr(target: Window): TestXmlHttpRequest {
    const xhrTarget = target as unknown as {
        readonly XMLHttpRequest: typeof TestXmlHttpRequest;
    };
    return new xhrTarget.XMLHttpRequest();
}

describe("Facebook main-world bridge", () => {
    it("announces readiness and stays idempotent across duplicate installation", () => {
        const { target, postMessage, fetch } = harness();

        installFacebookPayloadBridge(target);
        const wrappedFetch: unknown = Reflect.get(target, "fetch");
        installFacebookPayloadBridge(target);

        expect(Reflect.get(target, "fetch")).toBe(wrappedFetch);
        expect(Reflect.get(target, "fetch")).not.toBe(fetch);
        expect(postMessage).toHaveBeenCalledTimes(2);
        expect(postMessage).toHaveBeenNthCalledWith(1, {
            source: "no-more-ago:facebook-payload",
            type: "payload-bridge-ready",
        }, FACEBOOK_ORIGIN);
    });

    it("does not inspect a selected fetch until explicitly enabled", async () => {
        const text = vi.fn(() => Promise.resolve(responsePayload()));
        const clone = vi.fn(() => ({ text }) as unknown as Response);
        const response = { clone } as unknown as Response;
        const pagePromise = Promise.resolve(response);
        const { target } = harness(pagePromise);
        installFacebookPayloadBridge(target);

        const returned = target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        await returned;
        await Promise.resolve();

        expect(returned).toBe(pagePromise);
        expect(clone).not.toHaveBeenCalled();
        expect(text).not.toHaveBeenCalled();
    });

    it("emits only minimal records for an enabled selected fetch", async () => {
        const text = vi.fn(() => Promise.resolve(responsePayload()));
        const clone = vi.fn(() => ({ text }) as unknown as Response);
        const response = { clone } as unknown as Response;
        const { target, postMessage } = harness(Promise.resolve(response));
        installFacebookPayloadBridge(target);
        control(target, true);

        await target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(clone).toHaveBeenCalledOnce();
        expect(text).toHaveBeenCalledOnce();
        expect(postMessage).toHaveBeenLastCalledWith({
            source: "no-more-ago:facebook-payload",
            type: "story-timestamp-records",
            records: [{
                trackingToken: TRACKING_TOKEN,
                rawDatetime: "1787933301",
            }],
        }, FACEBOOK_ORIGIN);
    });

    it("suppresses a selected response disabled before it settles", async () => {
        let resolveResponse: ((response: Response) => void) | undefined;
        const pagePromise = new Promise<Response>((resolve) => {
            resolveResponse = resolve;
        });
        const clone = vi.fn(() => ({
            text: vi.fn(() => Promise.resolve(responsePayload())),
        }) as unknown as Response);
        const { target } = harness(pagePromise);
        installFacebookPayloadBridge(target);
        control(target, true);

        const returned = target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        control(target, false);
        resolveResponse?.({ clone } as unknown as Response);
        await returned;
        await Promise.resolve();

        expect(clone).not.toHaveBeenCalled();
    });

    it("returns the original rejected fetch promise without emitting a record", async () => {
        const error = new Error("page network failure");
        const pagePromise = Promise.reject(error);
        const { target, postMessage } = harness(pagePromise);
        installFacebookPayloadBridge(target);
        control(target, true);

        const returned = target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });

        expect(returned).toBe(pagePromise);
        await expect(returned).rejects.toBe(error);
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["https://example.test/api/graphql/", selectedBody()],
        [`${FACEBOOK_ORIGIN}/other`, selectedBody()],
        [
            `${FACEBOOK_ORIGIN}/api/graphql/`,
            new URLSearchParams({ fb_api_req_friendly_name: "CometSettingsQuery" }),
        ],
        [`${FACEBOOK_ORIGIN}/api/graphql/`, new FormData()],
    ])("does not clone an unselected fetch response for %s", async (url, body) => {
        const clone = vi.fn(() => ({
            text: vi.fn(() => Promise.resolve(responsePayload())),
        }) as unknown as Response);
        const { target } = harness(Promise.resolve({ clone } as unknown as Response));
        installFacebookPayloadBridge(target);
        control(target, true);

        await target.fetch(url, { method: "POST", body });
        await Promise.resolve();

        expect(clone).not.toHaveBeenCalled();
    });

    it("preserves XHR return values and inspects only while enabled", async () => {
        const { target, postMessage } = harness();
        installFacebookPayloadBridge(target);
        const request = xhr(target);
        request.responseText = responsePayload();

        expect(request.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`))
            .toBe("open-result");
        expect(request.send(selectedBody())).toBe("send-result");
        request.dispatchEvent(new Event("load"));
        await Promise.resolve();
        expect(postMessage).toHaveBeenCalledTimes(1);

        control(target, true);
        expect(request.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`))
            .toBe("open-result");
        expect(request.send(selectedBody())).toBe("send-result");
        request.dispatchEvent(new Event("load"));
        await Promise.resolve();

        expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
            type: "story-timestamp-records",
        }), FACEBOOK_ORIGIN);
    });

    it("ignores a selected XHR after the request object is reused", async () => {
        const { target, postMessage } = harness();
        installFacebookPayloadBridge(target);
        control(target, true);
        const request = xhr(target);
        request.responseText = responsePayload();

        request.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`);
        request.send(selectedBody());
        request.open("GET", `${FACEBOOK_ORIGIN}/settings`);
        request.dispatchEvent(new Event("load"));
        await Promise.resolve();

        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it("ignores a selected XHR whose response is not text", async () => {
        const { target, postMessage } = harness();
        installFacebookPayloadBridge(target);
        control(target, true);
        const request = xhr(target);
        request.responseType = "json";
        request.responseText = responsePayload();

        request.open("POST", `${FACEBOOK_ORIGIN}/api/graphql/`);
        request.send(selectedBody());
        request.dispatchEvent(new Event("load"));
        await Promise.resolve();

        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it("ignores malformed and cross-origin lifecycle commands", async () => {
        const clone = vi.fn(() => ({
            text: vi.fn(() => Promise.resolve(responsePayload())),
        }) as unknown as Response);
        const { target } = harness(Promise.resolve({ clone } as unknown as Response));
        installFacebookPayloadBridge(target);
        target.dispatchEvent(new MessageEvent("message", {
            data: createFacebookPayloadBridgeControlMessage(true),
            origin: "https://example.test",
            source: target,
        }));
        target.dispatchEvent(new MessageEvent("message", {
            data: { type: "payload-bridge-control", enabled: true },
            origin: FACEBOOK_ORIGIN,
            source: target,
        }));

        await target.fetch(`${FACEBOOK_ORIGIN}/api/graphql/`, {
            method: "POST",
            body: selectedBody(),
        });
        await Promise.resolve();

        expect(clone).not.toHaveBeenCalled();
    });
});
