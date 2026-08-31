/**
 * @file Verifies the bounded messages exchanged by Facebook execution worlds.
 */

import { describe, expect, it } from "vitest";

import {
    FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
    FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
    createFacebookPayloadBridgeControlMessage,
    createFacebookPayloadBridgeReadyMessage,
    isFacebookPayloadBridgeControlMessage,
    isFacebookPayloadBridgeReadyMessage,
    isFacebookPayloadMessage,
} from "../../../../src/content-script/facebook/contracts";

const TRACKING_TOKEN = "AZ-facebook-story-tracking-token-1234567890";

describe("Facebook cross-world contracts", () => {
    it("creates and validates the bridge-ready message", () => {
        const message = createFacebookPayloadBridgeReadyMessage();

        expect(isFacebookPayloadBridgeReadyMessage(message)).toBe(true);
        expect(message).toEqual({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: "payload-bridge-ready",
        });
    });

    it.each([true, false])("creates and validates bridge control %s", (enabled) => {
        const message = createFacebookPayloadBridgeControlMessage(enabled);

        expect(isFacebookPayloadBridgeControlMessage(message)).toBe(true);
        expect(message).toEqual({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: "payload-bridge-control",
            enabled,
        });
    });

    it.each([
        null,
        {},
        {
            source: "other",
            type: "payload-bridge-ready",
        },
        {
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: "payload-bridge-control",
            enabled: "true",
        },
        {
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: "unexpected",
            enabled: true,
        },
    ])("rejects an unrelated lifecycle message", (message) => {
        expect(isFacebookPayloadBridgeReadyMessage(message)).toBe(false);
        expect(isFacebookPayloadBridgeControlMessage(message)).toBe(false);
    });

    it("accepts at most one thousand bounded timestamp records", () => {
        const records = Array.from({ length: 1_000 }, (_, index) => ({
            trackingToken: `${TRACKING_TOKEN}-${String(index)}`,
            rawDatetime: "1787933301",
        }));
        const message = {
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
            records,
        };

        expect(isFacebookPayloadMessage(message)).toBe(true);
        expect(isFacebookPayloadMessage({
            ...message,
            records: [...records, records[0]],
        })).toBe(false);
    });

    it.each([
        { trackingToken: "x".repeat(19), rawDatetime: "1787933301" },
        { trackingToken: "x".repeat(2_049), rawDatetime: "1787933301" },
        { trackingToken: TRACKING_TOKEN, rawDatetime: "1.5" },
        { trackingToken: TRACKING_TOKEN, rawDatetime: "-1" },
        { trackingToken: TRACKING_TOKEN, rawDatetime: "tomorrow" },
    ])("rejects an out-of-contract record", (record) => {
        expect(isFacebookPayloadMessage({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
            records: [record],
        })).toBe(false);
    });
});
