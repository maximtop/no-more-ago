/**
 * @file Verifies content-script bootstrap and persisted display-state requests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const SLOT = Symbol.for("no-more-ago.document-runtime");

/**
 * Overrides the JSDOM document readiness state for bootstrap tests.
 *
 * @param value - Readiness state exposed by the test document.
 */
function setReadyState(value: DocumentReadyState): void {
    Object.defineProperty(document, "readyState", { configurable: true, value });
}

/**
 * Installs a minimal Chrome runtime mock and captures its content listener.
 *
 * @param sendMessage - Optional background request implementation.
 * @returns - Runtime message mock and listener dispatch helper.
 */
function installChromeMock(sendMessage?: (message: unknown) => Promise<unknown>) {
    let listener: ((message: unknown) => void) | undefined;
    const messages = {
        onMessage: {
            addListener: vi.fn((next: (message: unknown) => void) => {
                listener = next;
            })
        }
    };
    vi.stubGlobal("chrome", { runtime: { ...messages, ...(sendMessage === undefined ? {} : { sendMessage }) } });
    return { messages, dispatch: (message: unknown) => listener?.(message) };
}

/**
 * Creates a ready display-state response for content bootstrap tests.
 *
 * @param revision - Persisted display-settings revision.
 * @param mode - Effective time-zone selection mode.
 * @param identifier - IANA identifier used by named-zone mode.
 * @returns - Ready background display-state response.
 */
function displayState(revision: number, mode: "system" | "utc" | "iana", identifier = "America/New_York") {
    return {
        availability: "ready" as const,
        revision,
        display: { formatMode: "system" as const, timeZone: mode === "iana" ? { mode, identifier } : { mode } },
        debugEnabled: false
    };
}

describe("content entrypoint", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
        const previous = (document as unknown as Record<symbol, { readonly handle?: { teardown(): void } } | undefined>)[SLOT];
        previous?.handle?.teardown();
        Reflect.deleteProperty(document, SLOT);
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
    });

    it("installs the listener immediately while loading", async () => {
        setReadyState("loading");
        const chrome = installChromeMock();
        vi.stubGlobal("window", { location: { href: "https://github.com/example/repo" } });
        await import("../../src/content/main");
        expect(chrome.messages.onMessage.addListener).toHaveBeenCalledTimes(1);
        expect(document.querySelector("time")).toBeNull();
        document.dispatchEvent(new Event("DOMContentLoaded"));
        expect(document.querySelector("time")).not.toBeNull();
    });

    it("starts synchronously for a ready document", async () => {
        setReadyState("complete");
        const chrome = installChromeMock();
        vi.stubGlobal("window", { location: { href: "https://github.com/example/repo" } });
        await import("../../src/content/main");
        expect(chrome.messages.onMessage.addListener).toHaveBeenCalledTimes(1);
        expect(document.querySelector("time")).not.toBeNull();
    });

    it("requests authoritative display once before first ownership and uses the returned zone", async () => {
        setReadyState("complete");
        const sendMessage = vi.fn((message: unknown) => {
            expect(message).toEqual({ type: "no-more-ago:get-display-state" });
            return Promise.resolve(displayState(3, "utc"));
        });
        const chrome = installChromeMock(sendMessage);
        vi.stubGlobal("window", { location: { href: "https://github.com/example/repo" } });
        await import("../../src/content/main");
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(document.querySelector("time[data-no-more-ago-output]")?.textContent).toBe(
            new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date("2026-08-23T10:15:00Z"))
        );
        expect(chrome.messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    });

    it("re-evaluates the loading entrypoint after a failed readiness start", async () => {
        setReadyState("loading");
        const chrome = installChromeMock();
        vi.stubGlobal("window", { location: { href: "https://github.com/example/repo" } });
        const error = new Error("entrypoint observer setup failed");
        const observe = vi.spyOn(MutationObserver.prototype, "observe").mockImplementationOnce(() => {
            throw error;
        });
        const addEventListener = vi.spyOn(document, "addEventListener");
        await import("../../src/content/main");
        const callback = addEventListener.mock.calls
            .find(([type]) => type === "DOMContentLoaded")?.[1];
        if (typeof callback !== "function") {
            throw new Error("Expected readiness callback");
        }
        expect(() => {
            callback(new Event("DOMContentLoaded"));
        }).toThrow(error);
        observe.mockRestore();

        vi.resetModules();
        setReadyState("complete");
        await import("../../src/content/main");
        expect(chrome.messages.onMessage.addListener).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
        addEventListener.mockRestore();
    });

    it("re-evaluates the ready entrypoint after an initial-pass failure", async () => {
        setReadyState("complete");
        const chrome = installChromeMock();
        vi.stubGlobal("window", { location: { href: "https://github.com/example/repo" } });
        const error = new Error("entrypoint initial start failed");
        const observe = vi.spyOn(MutationObserver.prototype, "observe").mockImplementationOnce(() => {
            throw error;
        });

        await expect(import("../../src/content/main")).rejects.toThrow(error);
        observe.mockRestore();
        vi.resetModules();
        await import("../../src/content/main");
        expect(chrome.messages.onMessage.addListener).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
    });
});
