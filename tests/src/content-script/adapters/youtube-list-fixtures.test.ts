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
import {
    YOUTUBE_LIST_FIXTURE_ID,
    YOUTUBE_LIST_FIXTURES,
    type YouTubeListFixtureId,
} from "./youtube-test-data";

const CARD_SELECTORS = {
    [YOUTUBE_LIST_FIXTURE_ID.HOME]: "ytd-rich-item-renderer",
    [YOUTUBE_LIST_FIXTURE_ID.SEARCH]: "ytd-video-renderer",
    [YOUTUBE_LIST_FIXTURE_ID.CHANNEL_VIDEOS]: "yt-lockup-view-model",
} satisfies Readonly<Record<YouTubeListFixtureId, string>>;

afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.innerHTML = "<head></head><body></body>";
});

describe("YouTube list fixtures", () => {
    it.each(YOUTUBE_LIST_FIXTURES)(
        "keeps the captured $name page unchanged without network access",
        async ({ id, fixturePath, url }) => {
            document.documentElement.innerHTML = await readFile(fixturePath, "utf8");
            const originalMarkup = document.documentElement.innerHTML;
            const cardSelector = CARD_SELECTORS[id];
            const forbiddenFetch = vi.fn<typeof fetch>(() => {
                throw new Error("Network access is forbidden in YouTube list fixtures");
            });
            vi.stubGlobal("fetch", forbiddenFetch);

            expect(document.querySelectorAll(cardSelector).length).toBeGreaterThan(0);
            expect(processDocument({
                url: new URL(url),
                root: document,
                locales: ["en-US"],
            })).toEqual([]);
            expect(document.documentElement.innerHTML).toBe(originalMarkup);
            expect(document.querySelector(`[${OWNED_SOURCE_ATTRIBUTE}]`)).toBeNull();
            expect(document.querySelector(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toBeNull();
            expect(forbiddenFetch).not.toHaveBeenCalled();
        },
    );
});
