/**
 * @file Verifies synchronous presentation updates in the document runtime.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { DOCUMENT_RUNTIME_SLOT, installContentRuntime } from "../../../src/content-script/runtime";
import {
    PRESENTATION_UPDATED_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
} from "../../../src/shared/messaging/document-messages";

/**
 * Creates a controllable extension message source.
 *
 * @returns - Message source and synchronous dispatch helper.
 */
function createMessages() {
    let listener: ((
        message: unknown,
        sender?: unknown,
        response?: (value: unknown) => void,
    ) => unknown) | undefined;
    return {
        onMessage: {
            addListener: vi.fn((next: typeof listener) => {
                listener = next;
            }),
        },
        dispatch(message: unknown): unknown {
            let result: unknown;
            if (listener) {
                listener(message, undefined, (value) => {
                    result = value;
                });
            }
            return result;
        },
    };
}

const documentState = {
    availability: "ready" as const,
    revision: 1,
    enabled: true,
    display: { formatMode: "system" as const, timeZone: { mode: "utc" as const } },
    debugEnabled: false,
};

describe("document presentation updates", () => {
    beforeEach(() => {
        const current = (document as unknown as Record<symbol, {
            handle?: { teardown(): void };
        } | undefined>)[DOCUMENT_RUNTIME_SLOT];
        current?.handle?.teardown();
        Reflect.deleteProperty(document, DOCUMENT_RUNTIME_SLOT);
        document.body.innerHTML = '<time datetime="2026-08-23T10:15:00Z">relative</time>';
    });

    it("applies a newer display revision and acknowledges synchronously", async () => {
        const source = createMessages();
        installContentRuntime({
            document,
            url: new URL("https://example.test/page"),
            locales: ["en-US"],
            loadDocumentState: async () => documentState,
            messages: source,
        });
        await Promise.resolve();
        await Promise.resolve();
        const response = source.dispatch({
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: 2,
            display: {
                formatMode: "custom",
                pattern: "yyyy",
                timeZone: { mode: "utc" },
            },
        });

        expect(response).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 2 });
    });

    it("ignores stale presentation revisions", async () => {
        const source = createMessages();
        installContentRuntime({
            document,
            url: new URL("https://example.test/page"),
            locales: ["en-US"],
            loadDocumentState: async () => documentState,
            messages: source,
        });
        await Promise.resolve();
        await Promise.resolve();
        const response = source.dispatch({
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: 0,
            display: {
                formatMode: "custom",
                pattern: "yyyy",
                timeZone: { mode: "utc" },
            },
        });

        expect(response).toBeUndefined();
        expect(document.querySelector("[data-no-more-ago-output]")?.textContent).not.toBe("2026");
    });

    it("reformats a Hacker News label in place and keeps its link", async () => {
        document.body.innerHTML = `<span class="age" title="2026-08-28T10:09:07.000000Z">`
            + `<a id="hn-link" href="item?id=1">1 hour ago</a></span>`;
        const source = createMessages();
        const link = document.getElementById("hn-link");
        if (!(link instanceof HTMLAnchorElement)) {
            throw new Error("Expected Hacker News link");
        }
        installContentRuntime({
            document,
            url: new URL("https://news.ycombinator.com/item?id=1"),
            locales: ["en-US"],
            loadDocumentState: async () => documentState,
            messages: source,
        });
        await Promise.resolve();
        await Promise.resolve();
        const response = source.dispatch({
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: 2,
            display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
        });
        expect(response).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 2 });
        expect(link.textContent).toBe("2026");
        expect(document.getElementById("hn-link")).toBe(link);
    });
});
