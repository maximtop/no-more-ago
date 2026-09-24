/**
 * @file Verifies fail-closed extraction from structured Facebook Story payloads.
 */

import { describe, expect, it } from 'vitest';

import { FACEBOOK_PAYLOAD_LIMIT, type FacebookTimestampRecord } from
    '../../../../src/content-script/facebook/contracts';
import { extractFacebookTimestampUpdate } from
    '../../../../src/content-script/facebook/payload-parser';

const TRACKING_TOKEN = 'AZ-facebook-story-tracking-token-1234567890';
const VISIBLE_TRACKING_TOKEN = 'AZ-facebook-visible-link-token-0987654321';

/**
 * Creates one typed Story record for parser boundary tests.
 *
 * @param trackingToken - Opaque association included in the Story.
 *
 * @returns - Serialized Story-shaped object.
 */
function story(trackingToken: string): Record<string, unknown> {
    return {
        __typename: 'Story',
        creation_time: 1_787_933_301,
        encrypted_click_tracking: trackingToken,
    };
}

/**
 * Reads records through the complete update contract.
 *
 * @param payload - Serialized Facebook payload.
 *
 * @returns - Conflict-free records retained by the update.
 */
function extractFacebookTimestampRecords(payload: string): readonly FacebookTimestampRecord[] {
    return extractFacebookTimestampUpdate(payload).records;
}

describe('Facebook payload parser', () => {
    it('extracts only a typed Story with both tracking and creation fields', () => {
        const payload = JSON.stringify({
            data: {
                timeline: {
                    edges: [{
                        node: {
                            __typename: 'Story',
                            creation_time: 1_787_933_301,
                            encrypted_click_tracking: TRACKING_TOKEN,
                            post_id: '1121295037226372',
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
                    __typename: 'Device',
                    creation_time: 1_700_000_000,
                    encrypted_click_tracking: 'AZ-unrelated-device-token-1234567890',
                },
            },
        });

        expect(extractFacebookTimestampRecords(payload)).toEqual([
            {
                trackingToken: TRACKING_TOKEN,
                rawDatetime: '1787933301',
            },
            {
                trackingToken: VISIBLE_TRACKING_TOKEN,
                rawDatetime: '1787933301',
            },
        ]);
    });

    it("accepts Facebook's XSSI-prefixed newline response stream", () => {
        const first = JSON.stringify({ data: { unrelated: true } });
        const second = JSON.stringify({
            data: {
                node: {
                    __typename: 'Story',
                    creation_time: '1787343300',
                    encrypted_click_tracking: TRACKING_TOKEN,
                },
            },
        });

        expect(extractFacebookTimestampRecords(`for (;;);${first}\n${second}`)).toEqual([{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: '1787343300',
        }]);
    });

    it('discards a token associated with conflicting Story timestamps', () => {
        const payload = JSON.stringify([
            {
                __typename: 'Story',
                creation_time: 1_787_343_300,
                encrypted_click_tracking: TRACKING_TOKEN,
            },
            {
                __typename: 'Story',
                creation_time: 1_787_933_301,
                encrypted_click_tracking: TRACKING_TOKEN,
            },
        ]);

        expect(extractFacebookTimestampRecords(payload)).toEqual([]);
    });

    it('does not inherit an outer timestamp into a nested Story', () => {
        const payload = JSON.stringify({
            __typename: 'Story',
            creation_time: 1_787_933_301,
            encrypted_click_tracking: TRACKING_TOKEN,
            attached_story: {
                __typename: 'Story',
                encrypted_click_tracking: VISIBLE_TRACKING_TOKEN,
            },
        });

        expect(extractFacebookTimestampRecords(payload)).toEqual([{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: '1787933301',
        }]);
    });

    it('does not associate arbitrary Story descendants with the post timestamp', () => {
        const payload = JSON.stringify({
            __typename: 'Story',
            creation_time: 1_787_933_301,
            encrypted_click_tracking: TRACKING_TOKEN,
            comments: {
                __typename: 'CommentConnection',
                encrypted_click_tracking: VISIBLE_TRACKING_TOKEN,
            },
        });

        expect(extractFacebookTimestampRecords(payload)).toEqual([{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: '1787933301',
        }]);
    });

    it.each([
        '',
        'not json',
        JSON.stringify({
            __typename: 'Story',
            creation_time: 1_787_933_301,
        }),
        JSON.stringify({
            __typename: 'Story',
            creation_time: 'yesterday',
            encrypted_click_tracking: TRACKING_TOKEN,
        }),
        JSON.stringify({
            __typename: 'NotAStory',
            creation_time: 1_787_933_301,
            encrypted_click_tracking: TRACKING_TOKEN,
        }),
    ])('rejects an incomplete payload without throwing', (payload) => {
        expect(extractFacebookTimestampRecords(payload)).toEqual([]);
    });

    it('accepts the payload size limit and rejects the next character', () => {
        const base = JSON.stringify({ ...story(TRACKING_TOKEN), padding: '' });
        const closingLength = 2;
        const accepted = `${base.slice(0, -closingLength)}${'x'.repeat(
            FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS - base.length,
        )}${base.slice(-closingLength)}`;

        expect(accepted).toHaveLength(FACEBOOK_PAYLOAD_LIMIT.MAX_CHARACTERS);
        expect(extractFacebookTimestampRecords(accepted)).toEqual([{
            trackingToken: TRACKING_TOKEN,
            rawDatetime: '1787933301',
        }]);
        expect(extractFacebookTimestampRecords(`${accepted} `)).toEqual([]);
    });

    it('stops before a Story positioned beyond the traversal bound', () => {
        const payload = JSON.stringify([
            story(TRACKING_TOKEN),
            ...Array.from({
                length: FACEBOOK_PAYLOAD_LIMIT.MAX_VISITED_VALUES,
            }, () => null),
        ]);

        expect(extractFacebookTimestampRecords(payload)).toEqual([]);
    });

    it('invalidates records when a conflicting stream root lies beyond the visit limit', () => {
        const first = JSON.stringify(story(TRACKING_TOKEN));
        const padding = Array.from({
            length: FACEBOOK_PAYLOAD_LIMIT.MAX_VISITED_VALUES - 1,
        }, () => 'null').join('\n');
        const conflict = JSON.stringify({
            ...story(TRACKING_TOKEN),
            creation_time: 1_787_933_302,
        });

        expect(extractFacebookTimestampRecords(`${first}\n${padding}\n${conflict}`))
            .toEqual([]);
    });

    it('reports a token contradicted within one bounded payload', () => {
        const payload = JSON.stringify([
            story(TRACKING_TOKEN),
            { ...story(TRACKING_TOKEN), creation_time: 1_787_933_302 },
        ]);

        expect(extractFacebookTimestampUpdate(payload)).toEqual({
            records: [],
            invalidatedTrackingTokens: [TRACKING_TOKEN],
            invalidateAll: false,
        });
    });

    it('fails closed when one payload exceeds the record transfer limit', () => {
        const payload = JSON.stringify(Array.from({
            length: FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE + 1,
        }, (_, index) => story(`${TRACKING_TOKEN}-${String(index).padStart(4, '0')}`)));

        expect(extractFacebookTimestampUpdate(payload)).toEqual({
            records: [],
            invalidatedTrackingTokens: [],
            invalidateAll: true,
        });
    });

    it('fails closed when a conflict appears after the record transfer limit', () => {
        const stories = Array.from({
            length: FACEBOOK_PAYLOAD_LIMIT.MAX_RECORDS_PER_UPDATE,
        }, (_, index) => story(`${TRACKING_TOKEN}-${String(index).padStart(4, '0')}`));
        stories.push({
            ...story(TRACKING_TOKEN),
            creation_time: 1_787_933_302,
        });

        expect(extractFacebookTimestampUpdate(JSON.stringify(stories))).toEqual({
            records: [],
            invalidatedTrackingTokens: [],
            invalidateAll: true,
        });
    });

    it('bounds newline scanning even when every stream entry is empty', () => {
        const padding = '\n'.repeat(FACEBOOK_PAYLOAD_LIMIT.MAX_STREAM_LINES + 1);
        const payload = `${JSON.stringify(story(TRACKING_TOKEN))}${padding}${
            JSON.stringify(story(VISIBLE_TRACKING_TOKEN))}`;

        expect(extractFacebookTimestampUpdate(payload).invalidateAll).toBe(true);
    });

    it('accepts only tracking tokens inside the inclusive character bounds', () => {
        const payload = JSON.stringify([
            story('a'.repeat(FACEBOOK_PAYLOAD_LIMIT.MIN_TRACKING_TOKEN_CHARACTERS - 1)),
            story('b'.repeat(FACEBOOK_PAYLOAD_LIMIT.MIN_TRACKING_TOKEN_CHARACTERS)),
            story('c'.repeat(FACEBOOK_PAYLOAD_LIMIT.MAX_TRACKING_TOKEN_CHARACTERS)),
            story('d'.repeat(FACEBOOK_PAYLOAD_LIMIT.MAX_TRACKING_TOKEN_CHARACTERS + 1)),
        ]);

        expect(extractFacebookTimestampRecords(payload).map(({ trackingToken }) => trackingToken.length).sort((left, right) => left - right)).toEqual([
            FACEBOOK_PAYLOAD_LIMIT.MIN_TRACKING_TOKEN_CHARACTERS,
            FACEBOOK_PAYLOAD_LIMIT.MAX_TRACKING_TOKEN_CHARACTERS,
        ]);
    });
});
