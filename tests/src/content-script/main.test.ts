/**
 * @file Verifies content-script bootstrap and document-state requests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { DOCUMENT_RUNTIME_SLOT } from "../../../src/content-script/runtime";
import { GET_DOCUMENT_STATE_MESSAGE } from "../../../src/shared/messaging/contracts";
import { SETTINGS_STATE_FAILURE } from "../../../src/shared/messaging/view-state-values";

/**
 * Installs a minimal extension runtime mock.
 *
 * @param sendMessage - Optional document-state request handler.
 * @returns - Runtime message mock.
 */
function installChromeMock(sendMessage?: (message: unknown) => Promise<unknown>) {
    const messages = {
        onMessage: { addListener: vi.fn() },
        ...(sendMessage === undefined ? {} : { sendMessage }),
    };
    vi.stubGlobal("chrome", { runtime: messages });
    return messages;
}

/**
 * Creates a ready document-state response.
 *
 * @param enabled - Effective top-level policy.
 * @returns - Ready document state.
 */
function state(enabled = true) {
    return {
        availability: "ready" as const,
        revision: 2,
        enabled,
        display: { formatMode: "system" as const, timeZone: { mode: "utc" as const } },
        debugEnabled: false,
    };
}

describe("content entrypoint", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
        const current = (document as unknown as Record<symbol, {
            handle?: { teardown(): void };
        } | undefined>)[DOCUMENT_RUNTIME_SLOT];
        current?.handle?.teardown();
        Reflect.deleteProperty(document, DOCUMENT_RUNTIME_SLOT);
        document.body.innerHTML = '<time datetime="2026-08-23T10:15:00Z">relative</time>';
    });

    it("starts immediately while the document is loading", async () => {
        const sendMessage = vi.fn(async () => state());
        const chrome = installChromeMock(sendMessage);
        vi.stubGlobal("window", { location: { href: "https://example.test/page" } });

        await import("../../../src/content-script/main");
        await Promise.resolve();
        await Promise.resolve();

        expect(sendMessage).toHaveBeenCalledWith({ type: GET_DOCUMENT_STATE_MESSAGE });
        expect(chrome.onMessage.addListener).toHaveBeenCalledTimes(1);
        expect(document.querySelector("[data-no-more-ago-output]")).not.toBeNull();
    });

    it("does not process a disabled document", async () => {
        const sendMessage = vi.fn(async () => state(false));
        installChromeMock(sendMessage);
        vi.stubGlobal("window", { location: { href: "https://example.test/page" } });

        await import("../../../src/content-script/main");
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
    });

    it("keeps page content unchanged when document state is unavailable", async () => {
        const sendMessage = vi.fn(async () => ({
            availability: "unavailable" as const,
            revision: null,
            enabled: false,
            display: null,
            debugEnabled: false,
            failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
        }));
        installChromeMock(sendMessage);
        vi.stubGlobal("window", { location: { href: "https://example.test/page" } });

        await import("../../../src/content-script/main");
        await Promise.resolve();
        await Promise.resolve();

        expect(document.querySelector("time")?.textContent).toBe("relative");
    });
});
