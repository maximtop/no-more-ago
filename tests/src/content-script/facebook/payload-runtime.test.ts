/**
 * @file Verifies authenticated Facebook payload lifecycle and targeted reconciliation.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFacebookPayloadMessage } from
    "../../../../src/content-script/facebook/contracts";
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
import {
    FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
    type FacebookBridgeLeaseRequest,
} from "../../../../src/shared/messaging/facebook-bridge";

const TRACKING_TOKEN = "AZ-facebook-payload-runtime-token-1234567890";
const SECOND_TRACKING_TOKEN = "AZ-facebook-second-runtime-token-0987654321";
const FACEBOOK_URL = new URL("https://www.facebook.com/home");
const LEASE_ID = "12345678-1234-1234-1234-123456789abc";
const SECRET = "ab".repeat(32);
const RECORD = {
    trackingToken: TRACKING_TOKEN,
    rawDatetime: "1787933301",
} as const;
let sequence = 0;

/**
 * Creates one recognized or initially text-ineligible Facebook timestamp link.
 *
 * @param trackingToken - Opaque association stored in the URL.
 * @param label - Page-owned timestamp label.
 * @returns - Connected timestamp source.
 */
function timestampSource(
    trackingToken = TRACKING_TOKEN,
    label = "1͏d͏",
): HTMLAnchorElement {
    const source = document.createElement("a");
    source.href = `https://www.facebook.com/story?__cft__[0]=${trackingToken}`;
    source.innerHTML = `<span>${label}</span>`;
    document.body.append(source);
    return source;
}

/**
 * Creates a deterministic successful background lease boundary.
 *
 * @returns - Lease requester and its observable mock.
 */
function leaseBoundary() {
    const request = vi.fn((message: FacebookBridgeLeaseRequest) => Promise.resolve(
        message.active ? {
            ok: true as const,
            active: true as const,
            leaseId: LEASE_ID,
            secret: SECRET,
            expiresAt: Date.now() + 60_000,
        }
            : { ok: true as const, active: false as const },
    ));
    return { request };
}

/**
 * Dispatches one same-window Facebook bridge message.
 *
 * @param data - Structurally valid or forged bridge message payload.
 */
function dispatchBridgeMessage(data: unknown): void {
    window.dispatchEvent(new MessageEvent("message", {
        data,
        origin: window.location.origin,
        source: window,
    }));
}

/**
 * Signs and dispatches records under the active test lease.
 *
 * @param records - Minimal Story records to deliver.
 * @param secret - Signing secret used to test valid and forged evidence.
 */
async function dispatchRecords(
    records: readonly { readonly trackingToken: string; readonly rawDatetime: string }[],
    secret = SECRET,
): Promise<void> {
    const message = await createFacebookPayloadMessage(
        records,
        LEASE_ID,
        sequence,
        secret,
    );
    sequence += 1;
    dispatchBridgeMessage(message);
    await flushMutations();
}

/**
 * Allows native mutations, Web Crypto, and queued reconciliation to complete.
 *
 * @returns - Promise resolved after pending tasks and microtasks.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
    });
    await Promise.resolve();
}

/**
 * Installs a payload runtime with an authenticated lease requester.
 *
 * @param onSourcesChanged - Targeted reconciliation callback.
 * @param requestBridgeLease - Browser-mediated lease boundary.
 * @returns - Installed lifecycle handle.
 */
function install(
    onSourcesChanged: (sources: readonly Element[]) => void = vi.fn(),
    requestBridgeLease: (request: FacebookBridgeLeaseRequest) => Promise<unknown>
        = leaseBoundary().request,
): FacebookPayloadRuntimeHandle {
    return installFacebookPayloadRuntime({
        window,
        document,
        onSourcesChanged,
        requestBridgeLease,
    });
}

afterEach(() => {
    sequence = 0;
    vi.restoreAllMocks();
    restoreTimestampPresentations(document);
    clearFacebookTimestampRecords(document);
    document.body.replaceChildren();
});

describe("Facebook isolated payload runtime", () => {
    it("owns an idempotent acquire, release, re-enable, and teardown lifecycle", async () => {
        const boundary = leaseBoundary();
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
        const handle = install(callback, boundary.request);

        expect(getFacebookTimestampRecord(source)).toBeNull();
        handle.setEnabled(true);
        await flushMutations();
        expect(getFacebookTimestampRecord(source)).toEqual(RECORD);
        expect(boundary.request).toHaveBeenCalledTimes(1);
        expect(boundary.request).toHaveBeenLastCalledWith({
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: true,
        });

        handle.setEnabled(true);
        expect(boundary.request).toHaveBeenCalledTimes(1);
        handle.setEnabled(false);
        expect(getFacebookTimestampRecord(source)).toBeNull();
        expect(boundary.request).toHaveBeenLastCalledWith({
            type: FACEBOOK_BRIDGE_LEASE_REQUEST_MESSAGE,
            active: false,
            leaseId: LEASE_ID,
        });

        handle.setEnabled(false);
        handle.setEnabled(true);
        await flushMutations();
        expect(getFacebookTimestampRecord(source)).toEqual(RECORD);
        handle.setEnabled(false);
        handle.teardown();
        const replacement = install();
        expect(replacement).not.toBe(handle);
        replacement.teardown();
    });

    it("reconciles when authenticated evidence arrives before the source", async () => {
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        await flushMutations();
        await dispatchRecords([RECORD]);
        expect(callback).not.toHaveBeenCalled();

        const source = timestampSource();
        await flushMutations();

        expect(callback).toHaveBeenCalledWith([source]);
        handle.teardown();
    });

    it("ingests an initial payload script populated through character data", async () => {
        const source = timestampSource();
        const payload = document.createElement("script");
        payload.type = "application/json";
        payload.dataset.sjs = "1";
        const text = document.createTextNode("");
        payload.append(text);
        document.body.prepend(payload);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        await flushMutations();

        text.data = JSON.stringify({
            __typename: "Story",
            creation_time: 1_787_933_301,
            encrypted_click_tracking: TRACKING_TOKEN,
        });
        await flushMutations();

        expect(getFacebookTimestampRecord(source)).toEqual(RECORD);
        expect(callback).toHaveBeenCalledWith([source]);
        handle.teardown();
    });

    it("reconciles one batch when several associations become available together", async () => {
        const first = timestampSource();
        const second = timestampSource(SECOND_TRACKING_TOKEN);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        await flushMutations();

        await dispatchRecords([
            RECORD,
            { trackingToken: SECOND_TRACKING_TOKEN, rawDatetime: "1787933302" },
        ]);

        expect(callback).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith([first, second]);
        handle.teardown();
    });

    it("ignores a structurally valid record message without the active HMAC", async () => {
        const source = timestampSource();
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        await flushMutations();

        await dispatchRecords([RECORD], "cd".repeat(32));

        expect(getFacebookTimestampRecord(source)).toBeNull();
        expect(callback).not.toHaveBeenCalled();
        handle.teardown();
    });

    it("retries a pending association after the link href becomes eligible", async () => {
        const source = document.createElement("a");
        source.innerHTML = "<span>1͏d͏</span>";
        document.body.append(source);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        await flushMutations();
        await dispatchRecords([RECORD]);
        expect(callback).not.toHaveBeenCalled();

        source.href = `https://www.facebook.com/story?__cft__[0]=${TRACKING_TOKEN}`;
        await flushMutations();

        expect(callback).toHaveBeenCalledWith([source]);
        handle.teardown();
    });

    it("routes in-place timestamp text changes through the shared controller", async () => {
        const source = timestampSource(TRACKING_TOKEN, "1d");
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
        const handle = install((sources) => {
            controller.reconcileSources(sources);
        });
        handle.setEnabled(true);
        await flushMutations();
        await dispatchRecords([RECORD]);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

        const text = source.querySelector("span")?.firstChild;
        if (!(text instanceof Text)) {
            throw new Error("Expected timestamp text node");
        }
        text.data = "1͏d͏";
        await flushMutations();

        expect(source.hidden).toBe(true);
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();
        handle.teardown();
        controller.teardown();
    });

    it("drops dynamic evidence across disable and requires a fresh signed update", async () => {
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        await flushMutations();
        await dispatchRecords([RECORD]);
        handle.setEnabled(false);
        handle.setEnabled(true);
        await flushMutations();

        const source = timestampSource();
        await flushMutations();
        expect(callback).not.toHaveBeenCalled();

        await dispatchRecords([RECORD]);
        expect(callback).toHaveBeenCalledWith([source]);
        handle.teardown();
    });

    it("restores rendered output when later authenticated evidence conflicts", async () => {
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
        const handle = install((sources) => {
            controller.reconcileSources(sources);
        });
        handle.setEnabled(true);
        await flushMutations();

        await dispatchRecords([{ ...RECORD, rawDatetime: "1787933302" }]);

        expect(source.hidden).toBe(false);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        handle.teardown();
        controller.teardown();
    });
});
