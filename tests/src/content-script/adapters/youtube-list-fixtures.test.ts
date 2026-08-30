/**
 * @file Verifies captured YouTube list pages remain offline public-boundary no-ops.
 */

import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    OWNED_OUTPUT_ATTRIBUTE,
    OWNED_SOURCE_ATTRIBUTE,
} from "../../../../src/content-script/ownership-markers";
import { processDocument } from
    "../../../../src/content-script/transformation/process-document";

const LIST_FIXTURES = [
    {
        name: "Home",
        path: "tests/src/content-script/fixtures/youtube/home-modern-relative-only.html",
        url: new URL("https://www.youtube.com/"),
        cardSelector: "ytd-rich-item-renderer",
    },
    {
        name: "Search",
        path: "tests/src/content-script/fixtures/youtube/search-legacy-relative-only.html",
        url: new URL("https://www.youtube.com/results?search_query=fixture"),
        cardSelector: "ytd-video-renderer",
    },
    {
        name: "Channel Videos",
        path: "tests/src/content-script/fixtures/youtube/"
            + "channel-videos-modern-relative-only.html",
        url: new URL("https://www.youtube.com/@fixture-channel/videos"),
        cardSelector: "yt-lockup-view-model",
    },
] as const;

afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.innerHTML = "<head></head><body></body>";
});

describe("YouTube list fixtures", () => {
    it.each(LIST_FIXTURES)(
        "keeps the captured $name page unchanged without network access",
        async ({ path, url, cardSelector }) => {
            document.documentElement.innerHTML = await readFile(path, "utf8");
            const originalMarkup = document.documentElement.innerHTML;
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error("Network access is forbidden in YouTube list fixtures");
            });
            vi.stubGlobal("fetch", forbiddenFetch);

            expect(document.querySelectorAll(cardSelector).length).toBeGreaterThan(0);
            expect(processDocument({ url, root: document, locales: ["en-US"] })).toEqual([]);
            expect(document.documentElement.innerHTML).toBe(originalMarkup);
            expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
            expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
            expect(forbiddenFetch).not.toHaveBeenCalled();
        },
    );
});
