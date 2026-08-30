/**
 * @file Verifies synchronous presentation updates in the document runtime.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import { DOCUMENT_RUNTIME_SLOT, installContentRuntime } from "../../../src/content-script/runtime";
import { classifyYouTubeWatchRouteHandoff } from
    "../../../src/content-script/adapters/youtube-watch-route-handoff";
import {
    PRESENTATION_UPDATED_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
} from "../../../src/shared/messaging/document-messages";
import { STATE_AVAILABILITY } from "../../../src/shared/messaging/view-state-values";
import type { DisplaySettings } from "../../../src/shared/settings/snapshot";

const WATCH_URL = "https://www.youtube.com/watch?v=testVID0001";
const forbiddenFetch = vi.fn<typeof fetch>(() => {
    throw new Error("Network access is forbidden in presentation tests");
});

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

/**
 * Installs one canonical Watch source with identity-bound loaded publication data.
 *
 * @param publication - Explicit loaded publication value.
 * @returns - Page-owned Watch label.
 */
function setWatchMarkup(publication: string): Element {
    document.head.innerHTML = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
        videoDetails: { videoId: "testVID0001" },
        microformat: {
            playerMicroformatRenderer: {
                externalVideoId: "testVID0001",
                publishDate: publication,
            },
        },
    })};</script>`;
    document.body.innerHTML = `
        <ytd-watch-metadata>
            <div id="info-strings">
                <yt-formatted-string>unparseable publication label</yt-formatted-string>
            </div>
        </ytd-watch-metadata>`;
    const source = document.querySelector("yt-formatted-string");
    if (!source) {
        throw new Error("Expected Watch publication label");
    }
    return source;
}

/**
 * Creates one validated ready state with caller-selected display settings.
 *
 * @param display - Presentation snapshot to hydrate.
 * @param revision - Monotonic settings revision.
 * @returns - Ready enabled document state.
 */
function watchState(display: DisplaySettings, revision = 1) {
    return {
        availability: STATE_AVAILABILITY.READY,
        revision,
        enabled: true,
        display,
        debugEnabled: false,
    };
}

/**
 * Flushes hydration and one mutation delivery.
 */
async function flushRuntime(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Requires the generated Watch publication output.
 *
 * @returns - Current extension-owned time element.
 */
function requireWatchOutput(): HTMLTimeElement {
    const output = document.querySelector("time[data-no-more-ago-output]");
    if (!(output instanceof HTMLTimeElement)) {
        throw new Error("Expected Watch publication output");
    }
    return output;
}

describe("document presentation updates", () => {
    beforeEach(() => {
        const current = (document as unknown as Record<symbol, {
            handle?: { teardown(): void };
        } | undefined>)[DOCUMENT_RUNTIME_SLOT];
        current?.handle?.teardown();
        Reflect.deleteProperty(document, DOCUMENT_RUNTIME_SLOT);
        document.head.innerHTML = "";
        document.body.innerHTML = '<time datetime="2026-08-23T10:15:00Z">relative</time>';
        forbiddenFetch.mockClear();
        vi.stubGlobal("fetch", forbiddenFetch);
    });

    afterEach(() => {
        const current = (document as unknown as Record<symbol, {
            handle?: { teardown(): void };
        } | undefined>)[DOCUMENT_RUNTIME_SLOT];
        current?.handle?.teardown();
        Reflect.deleteProperty(document, DOCUMENT_RUNTIME_SLOT);
        const fetchCallCount = forbiddenFetch.mock.calls.length;
        vi.unstubAllGlobals();
        expect(fetchCallCount).toBe(0);
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

    it("applies hydrated and revised calendar presentation to the same output", async () => {
        const pageSource = setWatchMarkup("2024-02-29");
        const source = createMessages();
        installContentRuntime({
            document,
            url: new URL(WATCH_URL),
            urlProvider: () => new URL(WATCH_URL),
            routeHandoffClassifier: classifyYouTubeWatchRouteHandoff,
            locales: ["en-GB"],
            loadDocumentState: async () => watchState({
                formatMode: "custom",
                pattern: "yyyy/MM/dd HH:mm XXX",
                timeZone: { mode: "utc" },
            }),
            messages: source,
        });
        await flushRuntime();

        const output = requireWatchOutput();
        expect(output.dateTime).toBe("2024-02-29");
        expect(output.textContent).toBe("2024/02/29");
        pageSource.textContent = "changed page-owned relative copy";
        await flushRuntime();

        expect(source.dispatch({
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: 2,
            display: {
                formatMode: "custom",
                pattern: "dd/MM/yyyy 'at' HH:mm",
                timeZone: { mode: "iana", identifier: "Pacific/Kiritimati" },
            },
        })).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 2 });
        expect(requireWatchOutput()).toBe(output);
        expect(output.dateTime).toBe("2024-02-29");
        expect(output.textContent).toBe("29/02/2024");
        expect(pageSource.textContent).toBe("changed page-owned relative copy");

        expect(source.dispatch({
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: 3,
            display: {
                formatMode: "custom",
                pattern: "HH:mm XXX",
                timeZone: { mode: "iana", identifier: "Pacific/Honolulu" },
            },
        })).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 3 });
        const expectedFallback = new Intl.DateTimeFormat(["en-GB"], {
            dateStyle: "medium",
            timeZone: "UTC",
        }).format(new Date("2024-02-29T12:00:00.000Z"));
        expect(requireWatchOutput()).toBe(output);
        expect(output.dateTime).toBe("2024-02-29");
        expect(output.textContent).toBe(expectedFallback);
        expect(output.textContent.trim()).not.toBe("");
        expect(output.textContent).not.toContain(":");

        const stale = source.dispatch({
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: 2,
            display: {
                formatMode: "custom",
                pattern: "yyyy",
                timeZone: { mode: "utc" },
            },
        });
        expect(stale).toBeUndefined();
        expect(requireWatchOutput()).toBe(output);
        expect(output.textContent).toBe(expectedFallback);
    });

    it("keeps instant time-zone presentation live while reusing output", async () => {
        setWatchMarkup("2026-08-29T10:15:00+03:00");
        const source = createMessages();
        installContentRuntime({
            document,
            url: new URL(WATCH_URL),
            urlProvider: () => new URL(WATCH_URL),
            routeHandoffClassifier: classifyYouTubeWatchRouteHandoff,
            locales: ["en-GB"],
            loadDocumentState: async () => watchState({
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "utc" },
            }),
            messages: source,
        });
        await flushRuntime();

        const output = requireWatchOutput();
        expect(output.dateTime).toBe("2026-08-29T10:15:00+03:00");
        expect(output.textContent).toBe("2026-08-29 07:15");

        expect(source.dispatch({
            type: UPDATE_PRESENTATION_MESSAGE,
            revision: 2,
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "iana", identifier: "Pacific/Honolulu" },
            },
        })).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 2 });
        expect(requireWatchOutput()).toBe(output);
        expect(output.dateTime).toBe("2026-08-29T10:15:00+03:00");
        expect(output.textContent).toBe("2026-08-28 21:15");
    });
});
