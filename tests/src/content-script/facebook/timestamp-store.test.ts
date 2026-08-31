/**
 * @file Verifies bounded Facebook timestamp associations and invalidation transitions.
 */

import { afterEach, describe, expect, it } from "vitest";

import { FACEBOOK_PAYLOAD_LIMIT, type FacebookTimestampRecord } from
    "../../../../src/content-script/facebook/contracts";
import { extractFacebookTimestampUpdate } from
    "../../../../src/content-script/facebook/payload-parser";
import {
    FACEBOOK_TIMESTAMP_RECORD_CHANGE,
    clearFacebookTimestampRecords,
    getFacebookTimestampRecord,
    ingestFacebookPayloadScripts,
    storeFacebookTimestampRecords,
    storeFacebookTimestampUpdate,
} from "../../../../src/content-script/facebook/timestamp-store";

/**
 * Creates a bounded opaque token for one fixture association.
 *
 * @param index - Stable numeric fixture suffix.
 * @returns - Opaque token within the Facebook boundary.
 */
function token(index: number): string {
    return `AZ-facebook-store-token-${String(index).padStart(6, "0")}`;
}

/**
 * Creates one minimal timestamp record.
 *
 * @param index - Token suffix.
 * @param rawDatetime - Unix-seconds value associated with the token.
 * @returns - Store input record.
 */
function record(index: number, rawDatetime = "1787933301"): FacebookTimestampRecord {
    return { trackingToken: token(index), rawDatetime };
}

/**
 * Creates a connected anchor carrying one fixture token.
 *
 * @param trackingToken - Token encoded in the Facebook query parameter.
 * @returns - Connected page-owned source candidate.
 */
function source(trackingToken: string): HTMLAnchorElement {
    const element = document.createElement("a");
    element.href = `https://www.facebook.com/story?__cft__[0]=${trackingToken}`;
    document.body.append(element);
    return element;
}

afterEach(() => {
    clearFacebookTimestampRecords(document);
    document.body.replaceChildren();
});

describe("Facebook timestamp store", () => {
    it("reports only a newly available association", () => {
        expect(storeFacebookTimestampRecords(document, [record(1)])).toEqual([{
            trackingToken: token(1),
            state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.AVAILABLE,
        }]);
        expect(storeFacebookTimestampRecords(document, [record(1)])).toEqual([]);
        expect(getFacebookTimestampRecord(source(token(1)))).toEqual(record(1));
    });

    it("invalidates a token permanently after a cross-update conflict", () => {
        storeFacebookTimestampRecords(document, [record(1)]);

        expect(storeFacebookTimestampRecords(document, [record(1, "1787933302")]))
            .toEqual([{
                trackingToken: token(1),
                state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED,
            }]);
        expect(getFacebookTimestampRecord(source(token(1)))).toBeNull();
        expect(storeFacebookTimestampRecords(document, [record(1)])).toEqual([]);
        expect(getFacebookTimestampRecord(source(token(1)))).toBeNull();
    });

    it("invalidates an existing record after a conflict within one later payload", () => {
        storeFacebookTimestampRecords(document, [record(1)]);
        const update = extractFacebookTimestampUpdate(JSON.stringify([
            {
                __typename: "Story",
                creation_time: 1_787_933_301,
                encrypted_click_tracking: token(1),
            },
            {
                __typename: "Story",
                creation_time: 1_787_933_302,
                encrypted_click_tracking: token(1),
            },
        ]));

        expect(storeFacebookTimestampUpdate(document, update)).toEqual([{
            trackingToken: token(1),
            state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED,
        }]);
        expect(getFacebookTimestampRecord(source(token(1)))).toBeNull();
    });

    it("invalidates the oldest association when document capacity is exceeded", () => {
        storeFacebookTimestampRecords(
            document,
            Array.from({
                length: FACEBOOK_PAYLOAD_LIMIT.MAX_ASSOCIATIONS_PER_DOCUMENT,
            }, (_, index) => record(index)),
        );
        const overflowIndex = FACEBOOK_PAYLOAD_LIMIT.MAX_ASSOCIATIONS_PER_DOCUMENT;

        expect(storeFacebookTimestampRecords(document, [record(overflowIndex)])).toEqual([
            {
                trackingToken: token(overflowIndex),
                state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.AVAILABLE,
            },
            {
                trackingToken: token(0),
                state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED,
            },
        ]);
        expect(getFacebookTimestampRecord(source(token(0)))).toBeNull();
        expect(getFacebookTimestampRecord(source(token(overflowIndex))))
            .toEqual(record(overflowIndex));
    });

    it("counts conflicts toward the shared document capacity", () => {
        storeFacebookTimestampRecords(document, [record(0)]);
        storeFacebookTimestampRecords(document, [record(0, "1787933302")]);
        storeFacebookTimestampRecords(
            document,
            Array.from({
                length: FACEBOOK_PAYLOAD_LIMIT.MAX_ASSOCIATIONS_PER_DOCUMENT - 1,
            }, (_, index) => record(index + 1)),
        );
        storeFacebookTimestampRecords(document, [
            record(FACEBOOK_PAYLOAD_LIMIT.MAX_ASSOCIATIONS_PER_DOCUMENT),
        ]);

        expect(storeFacebookTimestampRecords(document, [record(0)])).toEqual([
            {
                trackingToken: token(0),
                state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.AVAILABLE,
            },
            {
                trackingToken: token(1),
                state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.INVALIDATED,
            },
        ]);
    });

    it("clears every retained association for the document", () => {
        const element = source(token(1));
        storeFacebookTimestampRecords(document, [record(1)]);
        expect(getFacebookTimestampRecord(element)).toEqual(record(1));

        clearFacebookTimestampRecords(document);

        expect(getFacebookTimestampRecord(element)).toBeNull();
    });

    it("parses a payload script once after its text becomes available", () => {
        const script = document.createElement("script");
        script.type = "application/json";
        script.dataset.sjs = "1";
        document.body.append(script);

        expect(ingestFacebookPayloadScripts(document)).toEqual([]);
        script.textContent = JSON.stringify({
            __typename: "Story",
            creation_time: 1_787_933_301,
            encrypted_click_tracking: token(1),
        });
        expect(ingestFacebookPayloadScripts(document)).toEqual([{
            trackingToken: token(1),
            state: FACEBOOK_TIMESTAMP_RECORD_CHANGE.AVAILABLE,
        }]);
        expect(ingestFacebookPayloadScripts(document)).toEqual([]);
    });
});
