/**
 * @file Verifies canonical YouTube watch-page discovery and extraction behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    youtubeAdapter,
    youtubePlayerResponseRule,
} from "../../../../src/content-script/adapters/youtube";
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampExtractionContext,
} from "../../../../src/content-script/adapters/types";
import {
    YOUTUBE_ADAPTER_ID,
    YOUTUBE_PLAYER_RESPONSE_RULE_ID,
    getYouTubeWatchVideoId,
} from "../../../../src/shared/adapters/youtube-contract";
import { youtubePlayerResponseAssignment } from "./youtube-test-data";

const WATCH_URL = new URL("https://www.youtube.com/watch?v=testVID0001");

/**
 * Creates an extraction context for one YouTube route.
 *
 * @param url - Route whose video identity should be used.
 * @returns - Adapter extraction context.
 */
function context(url: URL = WATCH_URL): TimestampExtractionContext {
    return {
        url,
        readPageText: (target) => target.data,
    };
}

/**
 * Loads one approved YouTube watch publication label.
 *
 * @param markup - Visible page-owned label content.
 * @returns - Created publication source element.
 */
function loadApprovedLabel(markup = "3 months ago"): Element {
    document.body.innerHTML = `<ytd-watch-metadata><div id="info-strings">
        <yt-formatted-string>${markup}</yt-formatted-string>
    </div></ytd-watch-metadata>`;
    const source = document.querySelector("yt-formatted-string");
    if (!source) {
        throw new Error("Expected watch publication label");
    }
    return source;
}

/**
 * Appends one inert exact player-response assignment to the unit document.
 *
 * @param publication - Publication value placed in the approved property.
 * @param videoId - Primary embedded video identity.
 * @param externalVideoId - Microformat embedded video identity.
 */
function appendPlayerAssignment(
    publication: unknown,
    videoId: unknown = "testVID0001",
    externalVideoId: unknown = "testVID0001",
): void {
    const script = document.createElement("script");
    document.head.append(script);
    script.textContent = youtubePlayerResponseAssignment(
        publication,
        videoId,
        externalVideoId,
    );
}

describe("youtubeAdapter", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ["https://www.youtube.com/watch?v=testVID0001", true],
        ["http://www.youtube.com/watch?v=testVID0001", true],
        ["https://youtube.com/watch?v=testVID0001", false],
        ["https://m.youtube.com/watch?v=testVID0001", false],
        ["https://music.youtube.com/watch?v=testVID0001", false],
        ["https://www.youtube.com/shorts/testVID0001", false],
        ["https://www.youtube.com/watch", false],
        ["https://www.youtube.com/watch?v=short", false],
        ["https://www.youtube.com/watch?v=testVID0001&v=testVID0002", false],
    ])("matches %s as %s", (url, expected) => {
        expect(youtubeAdapter.matches(new URL(url))).toBe(expected);
    });

    it.each([
        ["https://www.youtube.com/watch?v=testVID0001", "testVID0001"],
        ["http://www.youtube.com/watch?v=testVID0002", "testVID0002"],
        ["https://youtube.com/watch?v=testVID0001", null],
        ["https://m.youtube.com/watch?v=testVID0001", null],
        ["https://www.youtube.com/shorts/testVID0001", null],
        ["https://www.youtube.com/watch", null],
        ["https://www.youtube.com/watch?v=short", null],
        ["https://www.youtube.com/watch?v=testVID0001&v=testVID0002", null],
    ])("extracts canonical watch identity from %s", (url, expected) => {
        expect(getYouTubeWatchVideoId(new URL(url))).toBe(expected);
    });

    it("extracts a loaded publication without reading metadata", () => {
        document.head.innerHTML =
            '<meta itemprop="datePublished" content="2024-02-29">';
        const source = loadApprovedLabel();
        appendPlayerAssignment("2026-08-29T10:15:00+03:00");
        const metadataQuery = vi.spyOn(document.head, "querySelectorAll");

        expect(youtubePlayerResponseRule.extract(source, context())).toEqual({
            ruleId: YOUTUBE_PLAYER_RESPONSE_RULE_ID,
            source,
            sourceKind: TIMESTAMP_SOURCE_KIND.YT_FORMATTED_STRING,
            rawDatetime: "2026-08-29T10:15:00+03:00",
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule:
                TIMESTAMP_VALIDATION_RULE.CALENDAR_OR_EXPLICIT_ISO_ZONE,
            visibilityPolicy:
                TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        });
        expect(metadataQuery).not.toHaveBeenCalled();
    });

    it.each([
        "2024-02-29",
        "2026-08-29T10:15:00+03:00",
    ])("extracts approved head metadata value %s", (rawDatetime) => {
        document.head.innerHTML =
            `<meta itemprop="datePublished" content="${rawDatetime}">`;
        document.body.innerHTML = '<ytd-watch-metadata><div id="info-strings">'
            + '<yt-formatted-string>3 months ago</yt-formatted-string>'
            + "</div></ytd-watch-metadata>";
        const source = document.querySelector("yt-formatted-string");
        if (!source) {
            throw new Error("Expected watch publication label");
        }

        expect(youtubeAdapter.discover(document, context())).toEqual([source]);
        expect(youtubeAdapter.extract(source, context())).toEqual({
            ruleId: YOUTUBE_ADAPTER_ID,
            source,
            sourceKind: TIMESTAMP_SOURCE_KIND.YT_FORMATTED_STRING,
            rawDatetime,
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule:
                TIMESTAMP_VALIDATION_RULE.CALENDAR_OR_EXPLICIT_ISO_ZONE,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        });
    });

    it("requires a canonical watch URL for both source tiers", () => {
        document.head.innerHTML =
            '<meta itemprop="datePublished" content="2024-02-29">';
        const source = loadApprovedLabel();
        appendPlayerAssignment("2026-08-29T10:15:00+03:00");
        const unsupportedUrl = new URL("https://youtube.com/watch?v=testVID0001");

        expect(youtubePlayerResponseRule.extract(source, context(unsupportedUrl))).toBeNull();
        expect(youtubeAdapter.extract(source, context(unsupportedUrl))).toBeNull();
    });

    it.each([
        ["missing player data", null, "testVID0001", "testVID0001"],
        ["invalid publication", 123, "testVID0001", "testVID0001"],
        ["primary identity mismatch", "2024-02-29", "testVID0002", "testVID0001"],
        ["external identity mismatch", "2024-02-29", "testVID0001", "testVID0002"],
    ])("does not extract loaded data with %s", (
        _name,
        publication,
        videoId,
        externalVideoId,
    ) => {
        const source = loadApprovedLabel();
        if (publication !== null) {
            appendPlayerAssignment(publication, videoId, externalVideoId);
        }

        expect(youtubePlayerResponseRule.extract(source, context())).toBeNull();
    });

    it("keeps discovery bounded to the supplied root", () => {
        document.head.innerHTML =
            '<meta itemprop="datePublished" content="2024-02-29">';
        const source = loadApprovedLabel();
        const unrelatedRoot = document.createElement("aside");

        expect(youtubeAdapter.discover(unrelatedRoot, context())).toEqual([]);
        expect(youtubeAdapter.discover(source, context())).toEqual([source]);
    });

    it.each([
        ["missing metadata", ""],
        ["empty metadata", '<meta itemprop="datePublished" content="">'],
        [
            "duplicate metadata",
            '<meta itemprop="datePublished" content="2024-02-29">'
                + '<meta itemprop="datePublished" content="2024-03-01">',
        ],
        ["uploadDate metadata", '<meta itemprop="uploadDate" content="2024-02-29">'],
    ])("does not extract with %s", (_description, metadata) => {
        document.head.innerHTML = metadata;
        const source = loadApprovedLabel();

        expect(youtubeAdapter.extract(source, context())).toBeNull();
    });

    it("does not discover or extract a label outside the approved container", () => {
        document.head.innerHTML =
            '<meta itemprop="datePublished" content="2024-02-29">';
        document.body.innerHTML =
            '<yt-formatted-string id="outside">2024-02-29</yt-formatted-string>';
        const source = document.getElementById("outside");
        if (!source) {
            throw new Error("Expected unapproved label");
        }

        expect(youtubeAdapter.discover(document, context())).toEqual([]);
        expect(youtubeAdapter.extract(source, context())).toBeNull();
        expect(youtubePlayerResponseRule.discover(document, context())).toEqual([]);
        expect(youtubePlayerResponseRule.extract(source, context())).toBeNull();
    });

    it("does not infer a date from visible text or unapproved attributes", () => {
        document.head.innerHTML = "";
        document.body.innerHTML = '<ytd-watch-metadata><div id="info-strings">'
            + '<yt-formatted-string datetime="2024-02-29" aria-label="2024-02-29" '
            + 'data-date="2024-02-29">2024-02-29</yt-formatted-string>'
            + "</div></ytd-watch-metadata>";
        const source = document.querySelector("yt-formatted-string");
        if (!source) {
            throw new Error("Expected watch publication label");
        }

        expect(youtubeAdapter.discover(document, context())).toEqual([source]);
        expect(youtubeAdapter.extract(source, context())).toBeNull();
    });
});
