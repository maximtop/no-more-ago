/**
 * @file Verifies content-script bootstrap and document-state requests.
 */

import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import {
    OWNED_OUTPUT_ATTRIBUTE,
    OWNED_SOURCE_ATTRIBUTE,
} from "../../../src/content-script/ownership-markers";
import { DOCUMENT_RUNTIME_SLOT } from "../../../src/content-script/runtime";
import { GET_DOCUMENT_STATE_MESSAGE } from "../../../src/shared/messaging/contracts";
import {
    DOCUMENT_POLICY_REFRESHED_MESSAGE,
    REFRESH_DOCUMENT_POLICY_MESSAGE,
    SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
} from "../../../src/shared/messaging/document-messages";
import { SETTINGS_STATE_FAILURE } from "../../../src/shared/messaging/view-state-values";

const YOUTUBE_LIST_ENTRYPOINT_CASES = [
    {
        name: "Home",
        fixturePath:
            "tests/src/content-script/fixtures/youtube/home-modern-relative-only.html",
        url: "https://www.youtube.com/",
        labelSelector: ".ytContentMetadataViewModelMetadataTextLastPart",
    },
    {
        name: "Search",
        fixturePath:
            "tests/src/content-script/fixtures/youtube/search-legacy-relative-only.html",
        url: "https://www.youtube.com/results?search_query=fixture",
        labelSelector: ".inline-metadata-item.ytd-video-meta-block",
    },
    {
        name: "Channel",
        fixturePath:
            "tests/src/content-script/fixtures/youtube/channel-videos-modern-relative-only.html",
        url: "https://www.youtube.com/@fixture-channel/videos",
        labelSelector: ".ytContentMetadataViewModelMetadataTextLastPart",
    },
] as const;

/**
 * Installs a minimal extension runtime mock.
 *
 * @param sendMessage - Optional document-state request handler.
 * @returns - Runtime message mock.
 */
function installChromeMock(sendMessage?: (message: unknown) => Promise<unknown>) {
    let listener: (
        (message: unknown, sender?: unknown, response?: (value: unknown) => void) => unknown
    ) | undefined;
    const messages = {
        onMessage: {
            addListener: vi.fn((next: typeof listener) => {
                listener = next;
            }),
        },
        dispatch(message: unknown): unknown {
            let result: unknown;
            listener?.(message, undefined, (value) => {
                result = value;
            });
            return result;
        },
        ...(sendMessage === undefined ? {} : { sendMessage }),
    };
    vi.stubGlobal("chrome", { runtime: messages });
    return messages;
}

/**
 * Flushes runtime hydration and one scheduled document reconciliation.
 */
async function flushRuntime(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Verifies that one captured list page remains wholly page-owned.
 *
 * @param markup - Markup captured before runtime activation.
 * @param labelSelector - Selector for visible publication labels.
 * @param labelText - Label text captured before runtime activation.
 */
function expectLocalOnlyDocument(
    markup: string,
    labelSelector: string,
    labelText: readonly (string | null)[],
): void {
    expect(document.documentElement.outerHTML).toBe(markup);
    expect(Array.from(
        document.querySelectorAll(labelSelector),
        (label) => label.textContent,
    )).toEqual(labelText);
    expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector(`time[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
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

    it(
        "keeps output across a route-irrelevant popstate without network resolution",
        async () => {
            const sendMessage = vi.fn(async () => state());
            const chrome = installChromeMock(sendMessage);
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error(
                    "Production entrypoint must not resolve timestamps over the network",
                );
            });
            vi.stubGlobal("fetch", forbiddenFetch);
            let currentHref = "https://example.test/initial";
            let popstate: (() => void) | undefined;
            const addEventListener = vi.fn((type: string, listener: () => void) => {
                if (type === "popstate") {
                    popstate = listener;
                }
            });
            vi.stubGlobal("window", {
                location: {
                    get href() {
                        return currentHref;
                    },
                },
                addEventListener,
            });

            await import("../../../src/content-script/main");
            await Promise.resolve();
            await Promise.resolve();
            const initialOutput = document.querySelector("[data-no-more-ago-output]");
            expect(initialOutput).not.toBeNull();
            expect(addEventListener).toHaveBeenCalledOnce();
            expect(addEventListener).toHaveBeenCalledWith("popstate", expect.any(Function));

            currentHref = "https://example.test/later?private=ignored";
            popstate?.();

            expect(document.querySelector("[data-no-more-ago-output]")).toBe(initialOutput);
            expect(forbiddenFetch).not.toHaveBeenCalled();
            expect(chrome.onMessage.addListener).toHaveBeenCalledTimes(1);
        },
    );

    it.each(YOUTUBE_LIST_ENTRYPOINT_CASES)(
        "keeps the $name fixture local-only through disable and re-enable",
        async ({ fixturePath, url, labelSelector }) => {
            document.documentElement.innerHTML = await readFile(fixturePath, "utf8");
            const originalMarkup = document.documentElement.outerHTML;
            const originalLabelText = Array.from(
                document.querySelectorAll(labelSelector),
                (label) => label.textContent,
            );
            expect(originalLabelText.length).toBeGreaterThan(0);

            let enabled = true;
            const sendMessage = vi.fn(async (message: unknown) => {
                expect(message).toEqual({ type: GET_DOCUMENT_STATE_MESSAGE });
                return state(enabled);
            });
            const chrome = installChromeMock(sendMessage);
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error("YouTube list pages must not make a player request");
            });
            vi.stubGlobal("fetch", forbiddenFetch);
            vi.stubGlobal("window", {
                location: { href: url },
                addEventListener: vi.fn(),
            });

            await import("../../../src/content-script/main");
            await flushRuntime();

            expectLocalOnlyDocument(originalMarkup, labelSelector, originalLabelText);
            expect(forbiddenFetch).not.toHaveBeenCalled();

            enabled = false;
            expect(chrome.dispatch({
                type: SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE,
            })).toEqual({ type: DOCUMENT_POLICY_REFRESHED_MESSAGE });
            await flushRuntime();

            expectLocalOnlyDocument(originalMarkup, labelSelector, originalLabelText);
            expect(forbiddenFetch).not.toHaveBeenCalled();

            enabled = true;
            expect(chrome.dispatch({ type: REFRESH_DOCUMENT_POLICY_MESSAGE })).toEqual({
                type: DOCUMENT_POLICY_REFRESHED_MESSAGE,
            });
            await flushRuntime();

            expectLocalOnlyDocument(originalMarkup, labelSelector, originalLabelText);
            expect(forbiddenFetch).not.toHaveBeenCalled();
            expect(sendMessage).toHaveBeenCalledTimes(3);
            expect(chrome.onMessage.addListener).toHaveBeenCalledOnce();
        },
    );
});
