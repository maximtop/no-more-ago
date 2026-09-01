/**
 * @file Verifies TikTok URL scope and fail-closed DOM timestamp extraction.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { GENERIC_TIME_RULE_ID } from
    "../../../../src/content-script/adapters/generic-time";
import { defaultRegistry } from
    "../../../../src/content-script/adapters/registry";
import {
    matchesTikTokUrl,
    TIKTOK_DIRECT_FEED_ADAPTER_ID,
    TIKTOK_LEGACY_DIRECT_ADAPTER_ID,
    tiktokAdapters,
    tiktokDirectFeedAdapter,
    tiktokLegacyDirectAdapter,
} from "../../../../src/content-script/adapters/tiktok";
import {
    TIMESTAMP_PRESENTATION_KIND,
    type TimestampExtractionContext,
} from "../../../../src/content-script/adapters/types";

const VIDEO_ID = "7639779880711749733";
const VIDEO_URL = new URL(`https://www.tiktok.com/@fictional/video/${VIDEO_ID}`);
const PROFILE_URL = new URL("https://www.tiktok.com/@fictional?lang=en");

/**
 * Creates one complete extraction context for a TikTok route.
 *
 * @param url - Current TikTok document URL.
 * @returns - Adapter context with a page-owned text reader.
 */
function context(url: URL): TimestampExtractionContext {
    return {
        url,
        readPageText: (target) => target.data,
    };
}

/**
 * Installs one matching hydration record.
 */
function installHydration(): void {
    const script = document.createElement("script");
    script.id = "__UNIVERSAL_DATA_FOR_REHYDRATION__";
    script.type = "application/json";
    script.textContent = JSON.stringify({
        itemInfo: { itemStruct: { id: VIDEO_ID, createTime: "1778774880" } },
    });
    document.head.append(script);
}

describe("TikTok adapter", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    it.each([
        ["https://www.tiktok.com/@fictional", false],
        ["https://www.tiktok.com/@fictional/", false],
        [`https://www.tiktok.com/@fictional/video/${VIDEO_ID}`, true],
        ["https://www.tiktok.com/@fictional/photo/7590176113704304842", true],
        ["http://www.tiktok.com/@fictional", false],
        ["https://m.tiktok.com/@fictional", false],
        ["https://vm.tiktok.com/synthetic", false],
        ["https://seller.tiktok.com/@fictional", false],
        ["https://www.tiktok.com/", false],
        ["https://www.tiktok.com/foryou", false],
        ["https://www.tiktok.com/following", false],
        ["https://www.tiktok.com/search?q=date", false],
        ["https://www.tiktok.com/tiktokstudio", false],
        ["https://www.tiktok.com/@fictional/live", false],
        ["https://www.tiktok.com/embed/v2/123", false],
        ["https://www.tiktok.com/t/synthetic", false],
        [`https://www.tiktok.com/@fictional/video/${VIDEO_ID}/extra`, false],
    ])("matches TikTok URL %s as %s", (value, expected) => {
        expect(matchesTikTokUrl(new URL(value))).toBe(expected);
    });

    it("extracts only the simple direct publication date target", () => {
        installHydration();
        document.body.innerHTML = '<div id="metadata" data-e2e="browser-nickname" '
            + 'data-kept="yes"><span>Fictional</span><span> · </span>'
            + '<span id="date">5-14</span></div>';
        const source = document.getElementById("metadata");
        const target = document.getElementById("date")?.firstChild;
        if (!source || !(target instanceof Text)) {
            throw new Error("Expected direct publication metadata");
        }

        expect(tiktokLegacyDirectAdapter.extract(source, context(VIDEO_URL))).toMatchObject({
            source,
            rawDatetime: "2026-05-14T16:08:00.000Z",
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
            },
        });

        document.getElementById("date")?.append(document.createElement("i"));
        expect(tiktokLegacyDirectAdapter.extract(source, context(VIDEO_URL))).toBeNull();
    });

    it("extracts only the current direct feed article date", () => {
        installHydration();
        document.body.innerHTML = '<article id="current" '
            + 'data-e2e="recommend-list-item-container">'
            + `<div id="xgwrapper-0-${VIDEO_ID}"></div>`
            + '<div><a href="/@fictional"><p>Fictional</p></a>'
            + '<span id="current-date"> · localized</span></div></article>'
            + '<article id="recommendation" data-e2e="recommend-list-item-container">'
            + '<div id="xgwrapper-1-7590176113704304842"></div>'
            + '<div><a href="/@fictional"><p>Fictional</p></a>'
            + '<span id="recommended-date"> · localized</span></div></article>';
        const current = document.getElementById("current");
        const recommendation = document.getElementById("recommendation");
        const target = document.getElementById("current-date")?.firstChild;
        if (!current || !recommendation || !(target instanceof Text)) {
            throw new Error("Expected direct feed publication fixtures");
        }

        expect(tiktokDirectFeedAdapter.discover(document, context(VIDEO_URL))).toEqual([
            current,
            recommendation,
        ]);
        expect(tiktokDirectFeedAdapter.extract(current, context(VIDEO_URL))).toMatchObject({
            source: current,
            rawDatetime: "2026-05-14T16:08:00.000Z",
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
                textPrefix: " · ",
            },
        });
        expect(tiktokDirectFeedAdapter.extract(recommendation, context(VIDEO_URL))).toBeNull();
    });

    it("rejects ambiguous cards and never parses visible date text", () => {
        document.body.innerHTML = '<div data-e2e="user-post-item">'
            + `<a id="first" href="/@fictional/video/${VIDEO_ID}">one</a>`
            + '<a id="second" href="/@fictional/photo/7590176113704304842">two</a>'
            + '</div><div id="metadata" data-e2e="browser-nickname">'
            + '<span>Fictional</span><span> · </span><span>2026-05-14</span></div>';

        expect(tiktokAdapters.flatMap((adapter) =>
            adapter.discover(document, context(VIDEO_URL)))).toEqual([
            document.getElementById("metadata"),
        ]);
        const metadata = document.getElementById("metadata");
        if (!metadata) {
            throw new Error("Expected direct metadata source");
        }
        expect(tiktokLegacyDirectAdapter.extract(
            metadata,
            context(new URL("https://www.tiktok.com/@fictional/video/not-an-id")),
        )).toBeNull();
    });

    it("registers TikTok before generic only on supported paths", () => {
        expect(defaultRegistry.matching(VIDEO_URL).map(({ id }) => id))
            .toEqual([
                TIKTOK_LEGACY_DIRECT_ADAPTER_ID,
                TIKTOK_DIRECT_FEED_ADAPTER_ID,
                GENERIC_TIME_RULE_ID,
            ]);
        expect(defaultRegistry.matching(PROFILE_URL).map(({ id }) => id))
            .toEqual([GENERIC_TIME_RULE_ID]);
        expect(defaultRegistry.matching(
            new URL("https://www.tiktok.com/foryou"),
        ).map(({ id }) => id)).toEqual([GENERIC_TIME_RULE_ID]);
    });

    it("bounds the sources reconsidered after a hydration replacement", () => {
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < 2_100; index += 1) {
            const source = document.createElement("div");
            source.setAttribute("data-e2e", "browser-nickname");
            fragment.append(source);
        }
        document.body.append(fragment);
        const script = document.createElement("script");
        script.id = "__UNIVERSAL_DATA_FOR_REHYDRATION__";
        script.type = "application/json";
        const selection = tiktokLegacyDirectAdapter.getChildMutationSources?.(
            document.head,
            [script],
            [],
        ) ?? [];
        const sources = "sources" in selection ? selection.sources : selection;

        expect(sources).toHaveLength(2_000);
        expect(sources.every((source) => source instanceof HTMLDivElement)).toBe(true);
    });
});
