/**
 * @file Verifies LinkedIn host matching and local timestamp association.
 */

import {
    beforeEach, describe, expect, it,
} from 'vitest';

import { GENERIC_TIME_RULE_ID } from '../../../../src/content-script/adapters/generic-time';
import {
    LINKEDIN_ADAPTER_ID,
    linkedinAdapter,
    matchesLinkedInUrl,
} from '../../../../src/content-script/adapters/linkedin';
import { defaultRegistry } from '../../../../src/content-script/adapters/registry';
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_VALIDATION_RULE,
    type TimestampExtractionContext,
    type TimestampPresentationContext,
} from '../../../../src/content-script/adapters/types';
import { processDocument } from
    '../../../../src/content-script/transformation/process-document';

const ACTIVITY_ID = '7147784590025818113';
const UGC_POST_ID = '7159396357537529858';
const SHARE_ID = '7170283349280292867';
const COMMENT_ID = '7181895116414517252';

/**
 * Creates the read-only extraction context used by direct adapter tests.
 *
 * @returns - Extraction context that reads current page text.
 */
const context = (): TimestampExtractionContext => ({
    url: new URL('https://www.linkedin.com/feed/'),
    readPageText: (target) => target.data,
});

/**
 * Creates presentation-only locale evidence for direct classifier tests.
 *
 * @returns - Presentation context that reads current page text.
 */
const presentationContext = (): TimestampPresentationContext => ({
    locales: ['en-US'],
    readPageText: (target) => target.data,
});

/**
 * Loads markup and extracts its only accepted LinkedIn source.
 *
 * @param markup - Synthetic source markup.
 *
 * @returns - Extracted candidate, or null when the source is rejected.
 *
 * @throws If the markup has no source to extract.
 */
function extractSingle(markup: string) {
    document.body.innerHTML = markup;
    const extractionContext = context();
    const sources = linkedinAdapter.discover(document, extractionContext);
    expect(sources).toHaveLength(1);
    const source = sources[0];
    if (!source) {
        throw new Error('Expected one LinkedIn source');
    }
    return linkedinAdapter.extract(source, extractionContext);
}

beforeEach(() => {
    document.body.replaceChildren();
});

describe('matchesLinkedInUrl', () => {
    it.each([
        'https://linkedin.com/feed/',
        'https://www.linkedin.com/feed/',
        'http://de.linkedin.com/in/example/',
    ])('accepts LinkedIn HTTP(S) URL %s', (value) => {
        expect(matchesLinkedInUrl(new URL(value))).toBe(true);
    });

    it.each([
        'https://notlinkedin.com/',
        'https://linkedin.com.example/',
        'https://example.com/?next=https://linkedin.com/',
        'ftp://www.linkedin.com/feed/',
    ])('rejects lookalike or unsupported URL %s', (value) => {
        expect(matchesLinkedInUrl(new URL(value))).toBe(false);
    });
});

describe('linkedinAdapter', () => {
    it('registers LinkedIn before the generic HTTP(S) fallback', () => {
        expect(
            defaultRegistry
                .matching(new URL('https://www.linkedin.com/feed/'))
                .map(({ id }) => id),
        ).toEqual([LINKEDIN_ADAPTER_ID, GENERIC_TIME_RULE_ID]);
    });

    it('extracts one activity ID and preserves compound presentation', () => {
        const candidate = extractSingle(`
            <article>
                <header>
                    <p componentkey="timestamp-feed">
                        <span> 1w • Edited • </span>
                        <a href="/visibility">Connections</a>
                    </p>
                </header>
                <a href="/feed/update/urn:li:activity:${ACTIVITY_ID}/">Post</a>
            </article>
        `);

        expect(candidate).toMatchObject({
            ruleId: LINKEDIN_ADAPTER_ID,
            epochMilliseconds: 1_704_164_645_678,
            validationRule: TIMESTAMP_VALIDATION_RULE.DERIVED_UNIX_MILLISECONDS,
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                textPrefix: ' ',
                textSuffix: ' • Edited • ',
            },
        });
    });

    it('rejects an oversized page-owned presentation label', () => {
        document.body.innerHTML = `
            <article>
                <p componentkey="timestamp"><span id="label"></span></p>
                <a href="/feed/update/urn:li:activity:${ACTIVITY_ID}/">Post</a>
            </article>
        `;
        const label = document.getElementById('label');
        if (!label) {
            throw new Error('Expected oversized LinkedIn label');
        }
        label.textContent = 'x'.repeat(513);

        expect(linkedinAdapter.discover(document, context())).toEqual([]);
    });

    it('processes the English just-now literal', () => {
        document.body.innerHTML = `
            <article>
                <p componentkey="timestamp"><span id="label">just now • Edited</span></p>
                <a href="/feed/update/urn:li:activity:${ACTIVITY_ID}/">Post</a>
            </article>
        `;

        processDocument({
            url: context().url,
            root: document,
            locales: ['en-US'],
            display: {
                formatMode: 'custom',
                pattern: 'yyyy-MM-dd HH:mm:ss.SSS',
                timeZone: { mode: 'utc' },
            },
        });

        expect(document.getElementById('label')?.textContent)
            .toBe('2024-01-02 03:04:05.678 • Edited');
    });

    it('uses inherited Polish for a relative label and rejects an absolute label', () => {
        document.body.innerHTML = `
            <article id="polish-post" lang="pl">
                <p componentkey="polish-time">
                    <span id="polish-label">2 tyg. • Edited</span>
                </p>
                <a href="/feed/update/urn:li:activity:${ACTIVITY_ID}/">Polish post</a>
            </article>
            <article id="absolute-post">
                <p componentkey="absolute-time">
                    <span id="absolute-label">Aug 22, 2026 • Edited</span>
                </p>
                <div componentkey="ContentUrnUgcPostUrn(ugcPostUrn=urn:li:ugcPost:${UGC_POST_ID})">
                </div>
            </article>
        `;

        const extractionContext = context();
        const candidates = linkedinAdapter
            .discover(document, extractionContext)
            .map((source) => linkedinAdapter.extract(source, extractionContext))
            .filter((candidate) => candidate !== null);
        expect(candidates).toHaveLength(2);
        expect(candidates.map((candidate) => linkedinAdapter.isRelativePresentation(candidate, presentationContext())))
            .toEqual([true, false]);

        processDocument({
            url: context().url,
            root: document,
            locales: ['en-US'],
            display: {
                formatMode: 'custom',
                pattern: 'yyyy-MM-dd HH:mm:ss.SSS',
                timeZone: { mode: 'utc' },
            },
        });

        expect(document.getElementById('polish-label')?.textContent)
            .toBe('2024-01-02 03:04:05.678 • Edited');
        const absolute = document.getElementById('absolute-label');
        expect(absolute?.textContent).toBe('Aug 22, 2026 • Edited');
    });

    it('accepts only direct LinkedIn feed permalinks as href evidence', () => {
        const permalink = 'https://www.linkedin.com/feed/update/'
            + `urn%3Ali%3Aactivity%3A${ACTIVITY_ID}/`;
        const absolute = extractSingle(`
            <article>
                <p componentkey="timestamp"><span>1w</span></p>
                <a href="${permalink}">
                    Post
                </a>
            </article>
        `);
        expect(absolute).toMatchObject({ epochMilliseconds: 1_704_164_645_678 });

        for (const href of [
            `https://example.test/?next=urn:li:activity:${ACTIVITY_ID}`,
            `/redirect?url=urn%3Ali%3Aactivity%3A${ACTIVITY_ID}`,
            `/profile#urn:li:activity:${ACTIVITY_ID}`,
        ]) {
            document.body.innerHTML = `
                <article>
                    <p componentkey="timestamp"><span>1w</span></p>
                    <a href="${href}">Outbound</a>
                </article>
            `;
            expect(linkedinAdapter.discover(document, context())).toEqual([]);
        }
    });

    it.each([
        [`urn:li:ugcPost:${UGC_POST_ID}`, 1_706_933_106_789],
        [`ShareUrn(shareId=${SHARE_ID})`, 1_709_528_767_891],
    ])('accepts post evidence %s', (evidence, epochMilliseconds) => {
        const candidate = extractSingle(`
            <article>
                <p componentkey="timestamp-post"><span>2d •</span></p>
                <div componentkey="${evidence}"></div>
            </article>
        `);

        expect(candidate).toMatchObject({ epochMilliseconds });
    });

    it('selects the explicit comment ID instead of its thread context', () => {
        const candidate = extractSingle(`
            <article>
                <p componentkey="timestamp-comment"><span>5d</span></p>
                <div componentkey="CommentUrn(commentId=${COMMENT_ID},
                    thread=urn:li:ugcPost:${UGC_POST_ID})"></div>
            </article>
        `);

        expect(candidate).toMatchObject({ epochMilliseconds: 1_712_297_228_912 });
    });

    it('rejects an independent post ID beside a comment ID', () => {
        document.body.innerHTML = `
            <article>
                <p componentkey="timestamp-comment"><span>5d</span></p>
                <div componentkey="CommentUrn(commentId=${COMMENT_ID},
                    shareId=${SHARE_ID})"></div>
            </article>
        `;

        expect(linkedinAdapter.discover(document, context())).toEqual([]);
    });

    it('does not derive the instant from the relative token', () => {
        const first = extractSingle(`
            <article>
                <p componentkey="timestamp-a"><span>1d •</span></p>
                <div data-urn="urn:li:activity:${ACTIVITY_ID}"></div>
            </article>
        `);
        const second = extractSingle(`
            <article>
                <p componentkey="timestamp-b"><span>99y •</span></p>
                <div data-urn="urn:li:activity:${ACTIVITY_ID}"></div>
            </article>
        `);

        expect(first).toMatchObject({ epochMilliseconds: 1_704_164_645_678 });
        expect(second).toMatchObject({ epochMilliseconds: 1_704_164_645_678 });
    });

    it('rejects two distinct post IDs in the nearest accepted boundary', () => {
        document.body.innerHTML = `
            <article>
                <p componentkey="timestamp"><span>1w •</span></p>
                <a href="/feed/update/urn:li:activity:${ACTIVITY_ID}/">A</a>
                <div componentkey="ShareUrn(shareId=${SHARE_ID})"></div>
            </article>
        `;

        expect(linkedinAdapter.discover(document, context())).toEqual([]);
        expect(document.querySelector('p')?.textContent).toBe('1w •');
    });

    it('rejects distinct post IDs at unequal distances in one local boundary', () => {
        document.body.innerHTML = `
            <article>
                <header>
                    <p componentkey="timestamp"><span>1w •</span></p>
                    <a data-urn="urn:li:activity:${ACTIVITY_ID}">Near</a>
                    <section>
                        <div data-urn="urn:li:share:${SHARE_ID}">Far</div>
                    </section>
                </header>
            </article>
        `;

        expect(linkedinAdapter.discover(document, context())).toEqual([]);
        expect(document.querySelector('p')?.textContent).toBe('1w •');
    });

    it('keeps nested post and reply associations independent', () => {
        document.body.innerHTML = `
            <article id="post">
                <header>
                    <p componentkey="post-time"><span>1w •</span></p>
                    <a href="/feed/update/urn:li:activity:${ACTIVITY_ID}/">Post</a>
                </header>
                <article id="reply">
                    <header>
                        <p componentkey="reply-time"><span>3d</span></p>
                        <span data-sdui-anchor-id=
                            "comment-urn:li:comment:(ugcPost:1,${COMMENT_ID})::0">
                        </span>
                    </header>
                </article>
            </article>
        `;
        const extractionContext = context();
        const candidates = linkedinAdapter
            .discover(document, extractionContext)
            .map((source) => linkedinAdapter.extract(source, extractionContext));

        expect(candidates).toHaveLength(2);
        expect(candidates).toEqual(expect.arrayContaining([
            expect.objectContaining({ epochMilliseconds: 1_704_164_645_678 }),
            expect.objectContaining({ epochMilliseconds: 1_712_297_228_912 }),
        ]));
    });

    it('keeps a post ID at its outer boundary independent from nested comments', () => {
        document.body.innerHTML = `
            <article id="post" data-urn="urn:li:activity:${ACTIVITY_ID}">
                <header>
                    <p componentkey="post-time"><span>1w •</span></p>
                </header>
                <article id="reply">
                    <header>
                        <p componentkey="reply-time"><span>3d</span></p>
                        <span data-sdui-anchor-id=
                            "comment-urn:li:comment:(ugcPost:1,${COMMENT_ID})::0">
                        </span>
                    </header>
                </article>
            </article>
        `;
        const extractionContext = context();
        const candidates = linkedinAdapter
            .discover(document, extractionContext)
            .map((source) => linkedinAdapter.extract(source, extractionContext));

        expect(candidates).toEqual(expect.arrayContaining([
            expect.objectContaining({ epochMilliseconds: 1_704_164_645_678 }),
            expect.objectContaining({ epochMilliseconds: 1_712_297_228_912 }),
        ]));
        expect(candidates).toHaveLength(2);
    });

    it('does not lend an outer post ID to a nested comment without local evidence', () => {
        document.body.innerHTML = `
            <article id="post" data-urn="urn:li:activity:${ACTIVITY_ID}">
                <header>
                    <p componentkey="post-time"><span>1w</span></p>
                </header>
                <article id="comment">
                    <p componentkey="comment-time"><span>3d</span></p>
                    <div data-sdui-anchor-id="malformed-comment"></div>
                </article>
            </article>
        `;
        const extractionContext = context();
        const sources = linkedinAdapter.discover(document, extractionContext);

        expect(sources).toEqual([document.getElementById('post')]);
        expect(linkedinAdapter.extract(sources[0] as Element, extractionContext))
            .toMatchObject({ epochMilliseconds: 1_704_164_645_678 });
        expect(document.querySelector('#comment p')?.textContent).toBe('3d');
    });
});
