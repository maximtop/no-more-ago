/**
 * @file Verifies isolated Facebook payload lifecycle and targeted reconciliation.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createFacebookPayloadBridgeReadyMessage,
    createFacebookPayloadMessage,
} from "../../../../src/content-script/facebook/contracts";
import {
    installFacebookPayloadRuntime,
    type FacebookPayloadRuntimeHandle,
} from "../../../../src/content-script/facebook/payload-runtime";
import {
    clearFacebookTimestampRecords,
    getFacebookTimestampRecord,
    storeFacebookTimestampRecords,
} from "../../../../src/content-script/facebook/timestamp-store";
import {
    DocumentTransformationController,
} from "../../../../src/content-script/transformation/document-transformation-controller";
import {
    restoreTimestampPresentations,
} from "../../../../src/content-script/transformation/render-timestamp-presentation";

const TRACKING_TOKEN = "AZ-facebook-payload-runtime-token-1234567890";
const FACEBOOK_URL = new URL("https://www.facebook.com/home");
const RECORD = {
    trackingToken: TRACKING_TOKEN,
    rawDatetime: "1787933301",
} as const;

/**
 * Creates one recognized Facebook timestamp link.
 *
 * @param trackingToken - Opaque association stored in the URL.
 * @returns - Connected timestamp source.
 */
function timestampSource(trackingToken = TRACKING_TOKEN): HTMLAnchorElement {
    const source = document.createElement("a");
    source.href = `https://www.facebook.com/story?__cft__[0]=${trackingToken}`;
    source.innerHTML = "<span>1͏d͏</span>";
    document.body.append(source);
    return source;
}

/**
 * Dispatches one same-window Facebook bridge message.
 *
 * @param data - Validated bridge message payload.
 */
function dispatchBridgeMessage(data: unknown): void {
    window.dispatchEvent(new MessageEvent("message", {
        data,
        origin: window.location.origin,
        source: window,
    }));
}

/**
 * Allows native mutation delivery and queued reconciliation to complete.
 *
 * @returns - Promise resolved after pending mutation microtasks.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Installs a payload runtime and retains it for explicit test cleanup.
 *
 * @param onSourcesChanged - Targeted reconciliation callback.
 * @returns - Installed lifecycle handle.
 */
function install(
    onSourcesChanged: (sources: readonly Element[]) => void = vi.fn(),
): FacebookPayloadRuntimeHandle {
    return installFacebookPayloadRuntime({
        window,
        document,
        onSourcesChanged,
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    restoreTimestampPresentations(document);
    clearFacebookTimestampRecords(document);
    document.body.replaceChildren();
});

describe("Facebook isolated payload runtime", () => {
    it("owns an idempotent enable, disable, ready, and teardown lifecycle", () => {
        const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
        const source = timestampSource();
        const payload = document.createElement("script");
        payload.type = "application/json";
        payload.dataset.sjs = "1";
        payload.textContent = JSON.stringify({
            __typename: "Story",
            creation_time: 1_787_933_301,
            encrypted_click_tracking: TRACKING_TOKEN,
        });
        document.body.prepend(payload);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);

        expect(getFacebookTimestampRecord(source)).toBeNull();
        handle.setEnabled(true);
        expect(getFacebookTimestampRecord(source)).toEqual(RECORD);
        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenLastCalledWith({
            source: "no-more-ago:facebook-payload",
            type: "payload-bridge-control",
            enabled: true,
        }, window.location.origin);

        handle.setEnabled(true);
        expect(postMessage).toHaveBeenCalledTimes(1);
        dispatchBridgeMessage(createFacebookPayloadBridgeReadyMessage());
        expect(postMessage).toHaveBeenCalledTimes(2);

        handle.setEnabled(false);
        expect(getFacebookTimestampRecord(source)).toBeNull();
        expect(postMessage).toHaveBeenLastCalledWith({
            source: "no-more-ago:facebook-payload",
            type: "payload-bridge-control",
            enabled: false,
        }, window.location.origin);
        dispatchBridgeMessage(createFacebookPayloadMessage([RECORD]));
        expect(getFacebookTimestampRecord(source)).toBeNull();

        const callsAfterDisable = postMessage.mock.calls.length;
        handle.setEnabled(false);
        expect(postMessage).toHaveBeenCalledTimes(callsAfterDisable);
        handle.setEnabled(true);
        expect(getFacebookTimestampRecord(source)).toEqual(RECORD);
        handle.setEnabled(false);
        handle.teardown();
        const replacement = install();
        expect(replacement).not.toBe(handle);
        replacement.teardown();
    });

    it("reconciles when evidence arrives before the source", async () => {
        vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        dispatchBridgeMessage(createFacebookPayloadMessage([RECORD]));
        expect(callback).not.toHaveBeenCalled();

        const source = timestampSource();
        await flushMutations();

        expect(callback).toHaveBeenCalledWith([source]);
        handle.teardown();
    });

    it("reconciles when the source arrives before evidence", () => {
        vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
        const source = timestampSource();
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);

        dispatchBridgeMessage(createFacebookPayloadMessage([RECORD]));

        expect(callback).toHaveBeenCalledWith([source]);
        handle.teardown();
    });

    it("retries a pending association after the link href becomes eligible", async () => {
        vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
        const source = document.createElement("a");
        source.innerHTML = "<span>1͏d͏</span>";
        document.body.append(source);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        dispatchBridgeMessage(createFacebookPayloadMessage([RECORD]));
        expect(callback).not.toHaveBeenCalled();

        source.href = `https://www.facebook.com/story?__cft__[0]=${TRACKING_TOKEN}`;
        await flushMutations();

        expect(callback).toHaveBeenCalledWith([source]);
        handle.teardown();
    });

    it("drops pending dynamic evidence across disable and requires a fresh update", async () => {
        vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        dispatchBridgeMessage(createFacebookPayloadMessage([RECORD]));
        handle.setEnabled(false);
        handle.setEnabled(true);

        const source = timestampSource();
        await flushMutations();
        expect(callback).not.toHaveBeenCalled();

        dispatchBridgeMessage(createFacebookPayloadMessage([RECORD]));
        expect(callback).toHaveBeenCalledWith([source]);
        handle.teardown();
    });

    it("restores rendered output when later evidence conflicts", () => {
        vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
        const source = timestampSource();
        storeFacebookTimestampRecords(document, [RECORD]);
        const controller = new DocumentTransformationController({
            url: FACEBOOK_URL,
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm:ss",
                timeZone: { mode: "utc" },
            },
        });
        controller.start();
        expect(source.hidden).toBe(true);
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();
        const handle = install((sources) => {
            controller.reconcileSources(sources);
        });
        handle.setEnabled(true);

        dispatchBridgeMessage(createFacebookPayloadMessage([{
            ...RECORD,
            rawDatetime: "1787933302",
        }]));

        expect(source.hidden).toBe(false);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        handle.teardown();
        controller.teardown();
    });

    it("updates the callback without duplicating the document singleton", () => {
        vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
        const firstCallback = vi.fn<(sources: readonly Element[]) => void>();
        const secondCallback = vi.fn<(sources: readonly Element[]) => void>();
        const first = install(firstCallback);
        first.setEnabled(true);
        const second = install(secondCallback);
        const source = timestampSource();

        dispatchBridgeMessage(createFacebookPayloadMessage([RECORD]));

        expect(second).toBe(first);
        expect(firstCallback).not.toHaveBeenCalled();
        expect(secondCallback).toHaveBeenCalledWith([source]);
        first.teardown();
    });
});
