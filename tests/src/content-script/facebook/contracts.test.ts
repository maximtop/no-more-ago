/**
 * @file Verifies bounded authenticated messages exchanged by Facebook execution worlds.
 */

import { describe, expect, it } from "vitest";

import {
    FACEBOOK_PAYLOAD_LIMIT,
    FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
    FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
    createFacebookPayloadMessage,
    isFacebookPayloadMessage,
    verifyFacebookPayloadMessage,
} from "../../../../src/content-script/facebook/contracts";

const TRACKING_TOKEN = "AZ-facebook-story-tracking-token-1234567890";
const LEASE_ID = "12345678-1234-1234-1234-123456789abc";
const SECRET = "ab".repeat(32);

describe("Facebook cross-world contracts", () => {
    it("creates and verifies a complete authenticated minimal record message", async () => {
        const message = await createFacebookPayloadMessage({
            records: [{
                trackingToken: TRACKING_TOKEN,
                rawDatetime: "1787933301",
            }],
            invalidatedTrackingTokens: [],
        }, LEASE_ID, 3, SECRET);

        expect(isFacebookPayloadMessage(message)).toBe(true);
        await expect(verifyFacebookPayloadMessage(message, SECRET)).resolves.toBe(true);
        const record = message.records[0];
        if (!record) {
            throw new Error("Expected signed record");
        }
        await expect(verifyFacebookPayloadMessage({
            ...message,
            records: [{ ...record, rawDatetime: "1787933302" }],
        }, SECRET)).resolves.toBe(false);
        await expect(verifyFacebookPayloadMessage({
            ...message,
            invalidatedTrackingTokens: [TRACKING_TOKEN],
        }, SECRET)).resolves.toBe(false);
    });

    it("accepts at most the configured number of bounded timestamp records", () => {
        const records = Array.from({
            length: FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE,
        }, (_, index) => ({
            trackingToken: `${TRACKING_TOKEN}-${String(index)}`,
            rawDatetime: "1787933301",
        }));
        const message = {
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
            leaseId: LEASE_ID,
            sequence: 0,
            records,
            invalidatedTrackingTokens: [],
            signature: "00".repeat(32),
        };

        expect(isFacebookPayloadMessage(message)).toBe(true);
        expect(isFacebookPayloadMessage({
            ...message,
            records: [...records, records[0]],
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
            leaseId: LEASE_ID,
            sequence: 0,
            records: [record],
            invalidatedTrackingTokens: [],
            signature: "00".repeat(32),
        })).toBe(false);
    });

    it.each([
        { leaseId: "guessable", sequence: 0, signature: "00".repeat(32) },
        { leaseId: LEASE_ID, sequence: -1, signature: "00".repeat(32) },
        { leaseId: LEASE_ID, sequence: 0.5, signature: "00".repeat(32) },
        { leaseId: LEASE_ID, sequence: 0, signature: "not-a-signature" },
    ])("rejects invalid authentication metadata", (authentication) => {
        expect(isFacebookPayloadMessage({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_RECORDS_MESSAGE,
            records: [],
            invalidatedTrackingTokens: [],
            ...authentication,
        })).toBe(false);
    });
});
