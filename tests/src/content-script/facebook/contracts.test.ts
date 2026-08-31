/**
 * @file Verifies bounded messages exchanged by Facebook execution worlds.
 */

import { describe, expect, it } from "vitest";

import {
    FACEBOOK_PAYLOAD_LIMIT,
    FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
    FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
    createFacebookPayloadBridgeControlMessage,
    createFacebookPayloadBridgeReadyMessage,
    createFacebookPayloadMessage,
    isFacebookPayloadBridgeControlMessage,
    isFacebookPayloadBridgeReadyMessage,
    isFacebookPayloadMessage,
} from "../../../../src/content-script/facebook/contracts";

const TRACKING_TOKEN = "AZ-facebook-story-tracking-token-1234567890";

describe("Facebook cross-world contracts", () => {
    it("creates a complete minimal record message", () => {
        const message = createFacebookPayloadMessage({
            records: [{
                trackingToken: TRACKING_TOKEN,
                rawDatetime: "1787933301",
            }],
            invalidatedTrackingTokens: [],
            invalidateAll: false,
        });

        expect(isFacebookPayloadMessage(message)).toBe(true);
        expect(message).toEqual({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
            records: [{
                trackingToken: TRACKING_TOKEN,
                rawDatetime: "1787933301",
            }],
            invalidatedTrackingTokens: [],
            invalidateAll: false,
        });
    });

    it("accepts at most the configured number of bounded update entries", () => {
        const records = Array.from({
            length: FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE,
        }, (_, index) => ({
            trackingToken: `${TRACKING_TOKEN}-${String(index)}`,
            rawDatetime: "1787933301",
        }));
        const message = createFacebookPayloadMessage({
            records,
            invalidatedTrackingTokens: [],
            invalidateAll: false,
        });

        expect(isFacebookPayloadMessage(message)).toBe(true);
        expect(isFacebookPayloadMessage({
            ...message,
            invalidatedTrackingTokens: [TRACKING_TOKEN],
        })).toBe(false);
    });

    it("accepts only an empty fail-closed invalidation message", () => {
        const message = createFacebookPayloadMessage({
            records: [],
            invalidatedTrackingTokens: [],
            invalidateAll: true,
        });

        expect(isFacebookPayloadMessage(message)).toBe(true);
        expect(isFacebookPayloadMessage({
            ...message,
            records: [{ trackingToken: TRACKING_TOKEN, rawDatetime: "1787933301" }],
        })).toBe(false);
    });

    it.each([
        {
            trackingToken: "x".repeat(
                FACEBOOK_PAYLOAD_LIMIT.MIN_TRACKING_TOKEN_CHARACTERS - 1,
            ),
            rawDatetime: "1787933301",
        },
        {
            trackingToken: "x".repeat(
                FACEBOOK_PAYLOAD_LIMIT.MAX_TRACKING_TOKEN_CHARACTERS + 1,
            ),
            rawDatetime: "1787933301",
        },
        { trackingToken: TRACKING_TOKEN, rawDatetime: "1.5" },
        { trackingToken: TRACKING_TOKEN, rawDatetime: "-1" },
        { trackingToken: TRACKING_TOKEN, rawDatetime: "tomorrow" },
    ])("rejects an out-of-contract record", (record) => {
        expect(isFacebookPayloadMessage({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
            records: [record],
            invalidatedTrackingTokens: [],
            invalidateAll: false,
        })).toBe(false);
    });

    it("creates and recognizes bridge lifecycle messages", () => {
        expect(isFacebookPayloadBridgeReadyMessage(
            createFacebookPayloadBridgeReadyMessage(),
        )).toBe(true);
        expect(isFacebookPayloadBridgeControlMessage(
            createFacebookPayloadBridgeControlMessage(true),
        )).toBe(true);
        expect(isFacebookPayloadBridgeControlMessage({
            ...createFacebookPayloadBridgeControlMessage(true),
            enabled: "yes",
        })).toBe(false);
    });
});
