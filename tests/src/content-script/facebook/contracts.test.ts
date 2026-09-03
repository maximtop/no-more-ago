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
    isFacebookPayloadBridgeReadyMessage,
    readFacebookBridgeControlEnabled,
    readFacebookPayloadMessage,
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

        expect(readFacebookPayloadMessage(message)).not.toBeNull();
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

        expect(readFacebookPayloadMessage(message)).not.toBeNull();
        expect(readFacebookPayloadMessage({
            ...message,
            invalidatedTrackingTokens: [TRACKING_TOKEN],
        })).toBeNull();
    });

    it("accepts only an empty fail-closed invalidation message", () => {
        const message = createFacebookPayloadMessage({
            records: [],
            invalidatedTrackingTokens: [],
            invalidateAll: true,
        });

        expect(readFacebookPayloadMessage(message)).not.toBeNull();
        expect(readFacebookPayloadMessage({
            ...message,
            records: [{ trackingToken: TRACKING_TOKEN, rawDatetime: "1787933301" }],
        })).toBeNull();
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
        expect(readFacebookPayloadMessage({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
            records: [record],
            invalidatedTrackingTokens: [],
            invalidateAll: false,
        })).toBeNull();
    });

    it("creates and recognizes bridge lifecycle messages", () => {
        expect(isFacebookPayloadBridgeReadyMessage(
            createFacebookPayloadBridgeReadyMessage(),
        )).not.toBeNull();
        expect(readFacebookBridgeControlEnabled(
            createFacebookPayloadBridgeControlMessage(true),
        )).toBe(true);
        expect(readFacebookBridgeControlEnabled(
            createFacebookPayloadBridgeControlMessage(false),
        )).toBe(false);
        expect(readFacebookBridgeControlEnabled({
            ...createFacebookPayloadBridgeControlMessage(true),
            enabled: "yes",
        })).toBeNull();
    });
});
