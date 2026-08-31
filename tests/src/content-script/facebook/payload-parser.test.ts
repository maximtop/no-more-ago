/**
 * @file Verifies fail-closed extraction from structured Facebook Story payloads.
 */

import { describe, expect, it } from "vitest";

import { extractFacebookTimestampRecords } from
    "../../../../src/content-script/facebook/payload-parser";

const TRACKING_TOKEN = "AZ-facebook-story-tracking-token-1234567890";
const VISIBLE_TRACKING_TOKEN = "AZ-facebook-visible-link-token-0987654321";

/**
 * Creates one typed Story record for parser boundary tests.
 *
 * @param trackingToken - Opaque association included in the Story.
 * @returns - Serialized Story-shaped object.
 */
function story(trackingToken: string): Record<string, unknown> {
    return {
        __typename: "Story",
        creation_time: 1_787_933_301,
        encrypted_click_tracking: trackingToken,
    };
}

describe("Facebook payload parser", () => {
    it("extracts only a typed Story with both tracking and creation fields", () => {
        const payload = JSON.stringify({
            data: {
                timeline: {
                    edges: [{
                        node: {
                            __typename: "Story",
                            creation_time: 1_787_933_301,
                            encrypted_click_tracking: TRACKING_TOKEN,
                            post_id: "1121295037226372",
                            comet_sections: {
                                timestamp: {
                                    story: {
                                        encrypted_click_tracking: VISIBLE_TRACKING_TOKEN,
                                    },
                                },
                            },
                        },
                    }],
                },
                device: {
                    __typename: "Device",
                    creation_time: 1_700_000_000,
                    encrypted_click_tracking: "AZ-unrelated-device-token-1234567890",
                },
            },
        });

        expect(extractFacebookTimestampRecords(payload)).toEqual([
            {
                trackingToken: TRACKING_TOKEN,
                rawDatetime: "1787933301",
            },
            {
                trackingToken: VISIBLE_TRACKING_TOKEN,
                rawDatetime: "1787933301",
            },
        ]);
    });

    it("accepts Facebook's XSSI-prefixed newline response stream", () => {
        const first = JSON.stringify({ data: { unrelated: true } });
        const second = JSON.stringify({
            data: {
                node: {
                    __typename: "Story",
                    creation_time: "1787343300",
                    encrypted_click_tracking: TRACKING_TOKEN,
                },
            },
        });

        expect(extractFacebookTimestampRecords(`for (;;);${first}\n${second}`)).toEqual([{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: "1787343300",
        }]);
    });

    it("discards a token associated with conflicting Story timestamps", () => {
        const payload = JSON.stringify([
            {
                __typename: "Story",
                creation_time: 1_787_343_300,
                encrypted_click_tracking: TRACKING_TOKEN,
            },
            {
                __typename: "Story",
                creation_time: 1_787_933_301,
                encrypted_click_tracking: TRACKING_TOKEN,
            },
        ]);

        expect(extractFacebookTimestampRecords(payload)).toEqual([]);
    });

    it("does not inherit an outer timestamp into a nested Story", () => {
        const payload = JSON.stringify({
            __typename: "Story",
            creation_time: 1_787_933_301,
            encrypted_click_tracking: TRACKING_TOKEN,
            attached_story: {
                __typename: "Story",
                encrypted_click_tracking: VISIBLE_TRACKING_TOKEN,
            },
        });

        expect(extractFacebookTimestampRecords(payload)).toEqual([{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: "1787933301",
        }]);
    });

    it.each([
        "",
        "not json",
        JSON.stringify({
            __typename: "Story",
            creation_time: 1_787_933_301,
        }),
        JSON.stringify({
            __typename: "Story",
            creation_time: "yesterday",
            encrypted_click_tracking: TRACKING_TOKEN,
        }),
        JSON.stringify({
            __typename: "NotAStory",
            creation_time: 1_787_933_301,
            encrypted_click_tracking: TRACKING_TOKEN,
        }),
    ])("rejects an incomplete payload without throwing", (payload) => {
        expect(extractFacebookTimestampRecords(payload)).toEqual([]);
    });

    it("accepts the payload size limit and rejects the next character", () => {
        const base = JSON.stringify({ ...story(TRACKING_TOKEN), padding: "" });
        const closingLength = 2;
        const accepted = `${base.slice(0, -closingLength)}${"x".repeat(
            8_000_000 - base.length,
        )}${base.slice(-closingLength)}`;

        expect(accepted).toHaveLength(8_000_000);
        expect(extractFacebookTimestampRecords(accepted)).toEqual([{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: "1787933301",
        }]);
        expect(extractFacebookTimestampRecords(`${accepted} `)).toEqual([]);
    });

    it("stops before a Story positioned beyond the traversal bound", () => {
        const payload = JSON.stringify([
            story(TRACKING_TOKEN),
            ...Array.from({ length: 250_000 }, () => null),
        ]);

        expect(extractFacebookTimestampRecords(payload)).toEqual([]);
    });

    it("emits no more than one thousand records from one payload", () => {
        const payload = JSON.stringify(Array.from({ length: 1_001 }, (_, index) =>
            story(`${TRACKING_TOKEN}-${String(index).padStart(4, "0")}`)));

        expect(extractFacebookTimestampRecords(payload)).toHaveLength(1_000);
    });

    it("accepts only tracking tokens inside the inclusive character bounds", () => {
        const payload = JSON.stringify([
            story("a".repeat(19)),
            story("b".repeat(20)),
            story("c".repeat(2_048)),
            story("d".repeat(2_049)),
        ]);

        expect(extractFacebookTimestampRecords(payload).map(({ trackingToken }) =>
            trackingToken.length).sort((left, right) => left - right)).toEqual([20, 2_048]);
    });
});
