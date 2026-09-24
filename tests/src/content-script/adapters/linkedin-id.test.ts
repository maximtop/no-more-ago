/**
 * @file Verifies strict LinkedIn logical-ID parsing and timestamp decoding.
 */

import { describe, expect, it } from 'vitest';

import {
    LINKEDIN_ID_KIND,
    decodeLinkedInIdMilliseconds,
    parseLinkedInIds,
    parseLinkedInTargetIds,
} from '../../../../src/content-script/adapters/linkedin-id';

const ACTIVITY_ID = '7147784590025818113';
const UGC_POST_ID = '7159396357537529858';
const SHARE_ID = '7170283349280292867';
const COMMENT_ID = '7181895116414517252';

describe('parseLinkedInIds', () => {
    it.each([
        [`urn:li:activity:${ACTIVITY_ID}`, LINKEDIN_ID_KIND.ACTIVITY, ACTIVITY_ID],
        [`urn:li:ugcPost:${UGC_POST_ID}`, LINKEDIN_ID_KIND.UGC_POST, UGC_POST_ID],
        [`urn:li:share:${SHARE_ID}`, LINKEDIN_ID_KIND.SHARE, SHARE_ID],
        [`ActivityUrn(activityId=${ACTIVITY_ID})`, LINKEDIN_ID_KIND.ACTIVITY, ACTIVITY_ID],
        [`UgcPostUrn(ugcPostId=${UGC_POST_ID})`, LINKEDIN_ID_KIND.UGC_POST, UGC_POST_ID],
        [`ShareUrn(shareId=${SHARE_ID})`, LINKEDIN_ID_KIND.SHARE, SHARE_ID],
        [`CommentUrn(commentId=${COMMENT_ID})`, LINKEDIN_ID_KIND.COMMENT, COMMENT_ID],
        [
            `comment-urn:li:comment:(ugcPost:${UGC_POST_ID},${COMMENT_ID})::0`,
            LINKEDIN_ID_KIND.COMMENT,
            COMMENT_ID,
        ],
    ])('parses %s', (value, kind, decimal) => {
        expect(parseLinkedInIds(value)).toContainEqual({ kind, decimal });
    });

    it('decodes percent-encoded URL evidence and deduplicates a repeated ID', () => {
        const encoded = 'https://www.linkedin.com/feed/update/'
            + `urn%3Ali%3Aactivity%3A${ACTIVITY_ID}/?duplicate=`
            + `urn%3Ali%3Aactivity%3A${ACTIVITY_ID}`;

        expect(parseLinkedInIds(encoded)).toEqual([
            { kind: LINKEDIN_ID_KIND.ACTIVITY, decimal: ACTIVITY_ID },
        ]);
    });

    it('keeps a comment ID distinct from its contextual thread ID', () => {
        const value = 'ContentUrnCommentUrn(commentUrn=CommentUrn('
            + `commentId=${COMMENT_ID}, thread=urn:li:ugcPost:${UGC_POST_ID}))`;

        expect(parseLinkedInIds(value)).toEqual(expect.arrayContaining([
            { kind: LINKEDIN_ID_KIND.COMMENT, decimal: COMMENT_ID },
            { kind: LINKEDIN_ID_KIND.UGC_POST, decimal: UGC_POST_ID },
        ]));
    });

    it('removes only a structurally proven parent thread from comment targets', () => {
        const contextual = 'ContentUrnCommentUrn(commentUrn=CommentUrn('
            + `commentId=${COMMENT_ID}, thread=urn:li:ugcPost:${UGC_POST_ID}))`;
        const independent = `CommentUrn(commentId=${COMMENT_ID}, shareId=${SHARE_ID})`;

        expect(parseLinkedInTargetIds(contextual)).toEqual([
            { kind: LINKEDIN_ID_KIND.COMMENT, decimal: COMMENT_ID },
        ]);
        expect(parseLinkedInTargetIds(independent)).toEqual(expect.arrayContaining([
            { kind: LINKEDIN_ID_KIND.COMMENT, decimal: COMMENT_ID },
            { kind: LINKEDIN_ID_KIND.SHARE, decimal: SHARE_ID },
        ]));
    });

    it.each([
        'urn:li:unknown:7147784590025818113',
        'urn:li:activity:',
        'urn:li:activity:0',
        'urn:li:activity:07147784590025818113',
        'urn:li:activity:-7147784590025818113',
        'urn:li:activity:+7147784590025818113',
        'urn:li:activity:7147784590025818113x',
        'urn:li:activity:7147784590025818113-0',
        'urn:li:activity:7147784590025818113.0',
        'urn:li:activity:7147784590025818113:0',
        'activityId=7147784590025818113_0',
        'activityId=7147784590025818113-0',
        'activityId=7147784590025818113.0',
        'activityId=7147784590025818113 0',
        'commentId= 7181895116414517252',
        'urn:li:activity:123456789012345678901',
        `xurn:li:activity:${ACTIVITY_ID}`,
        `noturn:li:comment:(ugcPost:${UGC_POST_ID},${COMMENT_ID})`,
    ])('rejects malformed or unsupported evidence %s', (value) => {
        expect(parseLinkedInIds(value)).toEqual([]);
    });
});

describe('decodeLinkedInIdMilliseconds', () => {
    it.each([
        [LINKEDIN_ID_KIND.ACTIVITY, ACTIVITY_ID, 1_704_164_645_678],
        [LINKEDIN_ID_KIND.UGC_POST, UGC_POST_ID, 1_706_933_106_789],
        [LINKEDIN_ID_KIND.SHARE, SHARE_ID, 1_709_528_767_891],
        [LINKEDIN_ID_KIND.COMMENT, COMMENT_ID, 1_712_297_228_912],
    ])('decodes %s without rounding', (kind, decimal, expected) => {
        expect(decodeLinkedInIdMilliseconds({ kind, decimal })).toBe(expected);
    });

    it('rejects a shifted value that is not a positive safe integer', () => {
        const unsafe = ((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 2n ** 22n).toString();

        expect(decodeLinkedInIdMilliseconds({
            kind: LINKEDIN_ID_KIND.ACTIVITY,
            decimal: unsafe,
        })).toBeNull();
        expect(decodeLinkedInIdMilliseconds({
            kind: LINKEDIN_ID_KIND.ACTIVITY,
            decimal: '1',
        })).toBeNull();
    });

    it('rejects values outside the supported unsigned 64-bit width', () => {
        expect(decodeLinkedInIdMilliseconds({
            kind: LINKEDIN_ID_KIND.ACTIVITY,
            decimal: '18446744073709551616',
        })).toBeNull();
        expect(decodeLinkedInIdMilliseconds({
            kind: LINKEDIN_ID_KIND.ACTIVITY,
            decimal: '9'.repeat(100_000),
        })).toBeNull();
    });
});
