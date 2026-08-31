/**
 * @file Verifies Facebook Story timestamp mapping and observable rendering.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
    FACEBOOK_ADAPTER_ID,
    facebookAdapter,
} from "../../../../src/content-script/adapters/facebook";
import { GENERIC_TIME_RULE_ID } from
    "../../../../src/content-script/adapters/generic-time";
import { defaultRegistry } from "../../../../src/content-script/adapters/registry";
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampExtractionContext,
} from "../../../../src/content-script/adapters/types";
import {
    clearFacebookTimestampRecords,
    storeFacebookTimestampRecords,
} from "../../../../src/content-script/facebook/timestamp-store";
import { OWNED_OUTPUT_ATTRIBUTE } from
    "../../../../src/content-script/ownership-markers";
import { processDocument } from
    "../../../../src/content-script/transformation/process-document";
import { restoreTimestampPresentations } from
    "../../../../src/content-script/transformation/render-timestamp-presentation";

const TRACKING_TOKEN = "AZ-facebook-story-tracking-token-1234567890";
const FACEBOOK_URL = new URL("https://www.facebook.com/Meta");
const extractionContext: TimestampExtractionContext = {
    url: FACEBOOK_URL,
    readPageText: (target) => target.data,
};

/**
 * Produces a Facebook URL carrying the fixture tracking token.
 *
 * @param suffix - Optional comment-specific URL suffix.
 * @returns - Encoded fixture URL.
 */
function trackedUrl(suffix = ""): string {
    return `https://www.facebook.com/Meta${suffix}?__cft__[0]=${TRACKING_TOKEN}`;
}

afterEach(() => {
    restoreTimestampPresentations(document);
    clearFacebookTimestampRecords(document);
    document.body.replaceChildren();
});

describe("Facebook Story adapter", () => {
    it("registers before the generic fallback only on Facebook", () => {
        expect(defaultRegistry.matching(FACEBOOK_URL).map(({ id }) => id))
            .toEqual([FACEBOOK_ADAPTER_ID, GENERIC_TIME_RULE_ID]);
        expect(defaultRegistry.matching(new URL("https://example.test/")).map(({ id }) => id))
            .toEqual([GENERIC_TIME_RULE_ID]);
    });

    it("maps a payload record only to the obfuscated Story timestamp link", () => {
        document.body.innerHTML = `
            <article>
                <a id="actor" href="${trackedUrl()}">Meta</a>
                <a id="timestamp" href="${trackedUrl()}"><span>1͏d͏</span></a>
                <a id="comment" aria-label="August 29, 2026 at 1:53 AM"
                    href="${trackedUrl("/reel/123/comment")}">1d</a>
            </article>`;
        storeFacebookTimestampRecords(document, [{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: "1787933301",
        }]);
        const timestamp = document.getElementById("timestamp");
        if (!timestamp) {
            throw new Error("Expected Facebook timestamp fixture");
        }

        expect(facebookAdapter.discover(document, extractionContext)).toEqual([timestamp]);
        expect(facebookAdapter.extract(timestamp, extractionContext)).toEqual({
            ruleId: FACEBOOK_ADAPTER_ID,
            source: timestamp,
            sourceKind: TIMESTAMP_SOURCE_KIND.FACEBOOK_STORY_TIMESTAMP,
            rawDatetime: "1787933301",
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule: TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        });
    });

    it("renders the exact date and leaves actor and comment links unchanged", () => {
        document.body.innerHTML = `
            <article>
                <a id="actor" href="${trackedUrl()}">Meta</a>
                <a id="timestamp" href="${trackedUrl()}"><span>1͏d͏</span></a>
                <a id="comment" aria-label="August 29, 2026 at 1:53 AM"
                    href="${trackedUrl("/reel/123/comment")}">1d</a>
            </article>`;
        storeFacebookTimestampRecords(document, [{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: "1787933301",
        }]);

        const outputs = processDocument({
            url: FACEBOOK_URL,
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm:ss",
                timeZone: { mode: "utc" },
            },
        });

        expect(outputs).toHaveLength(1);
        expect(outputs[0]?.dateTime).toBe("1787933301");
        expect(outputs[0]?.textContent).toBe("2026-08-28 16:08:21");
        expect(outputs[0]?.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(true);
        expect(document.getElementById("timestamp")?.hasAttribute("hidden")).toBe(true);
        expect(document.getElementById("actor")?.textContent).toBe("Meta");
        expect(document.getElementById("comment")?.textContent).toBe("1d");
    });

    it("accepts the SVG-sprite timestamp shape used by dynamic feed posts", () => {
        document.body.innerHTML = `
            <a id="timestamp" href="${trackedUrl()}" role="link" tabindex="0"
                target="_blank">
                <span><span aria-labelledby="timestamp-label"><svg><use href="#date" /></svg>
                </span></span>
            </a>
            <span id="timestamp-label">2d</span>`;
        storeFacebookTimestampRecords(document, [{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: "1787343300",
        }]);
        const timestamp = document.getElementById("timestamp");

        expect(facebookAdapter.discover(document, extractionContext)).toEqual([timestamp]);
        expect(timestamp && facebookAdapter.extract(timestamp, extractionContext))
            .toMatchObject({ rawDatetime: "1787343300" });
    });

    it("does not ingest initial payload scripts as an adapter side effect", () => {
        const payload = JSON.stringify({
            data: {
                node: {
                    __typename: "Story",
                    creation_time: 1_787_933_301,
                    encrypted_click_tracking: TRACKING_TOKEN,
                },
            },
        });
        document.body.innerHTML = `
            <script type="application/json" data-sjs>${payload}</script>
            <a id="timestamp" href="${trackedUrl()}"><span>1͏d͏</span></a>`;

        expect(facebookAdapter.discover(document, extractionContext)).toEqual([]);
    });
});
