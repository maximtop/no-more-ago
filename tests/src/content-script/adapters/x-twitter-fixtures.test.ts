/**
 * @file Verifies X/Twitter public surfaces through the production timestamp pipeline.
 */

import { readFile } from 'node:fs/promises';

import {
    beforeAll, describe, expect, it,
} from 'vitest';

import { GENERIC_TIME_RULE_ID } from
    '../../../../src/content-script/adapters/generic-time';
import { defaultRegistry } from
    '../../../../src/content-script/adapters/registry';
import {
    OWNED_OUTPUT_ATTRIBUTE,
    OWNED_SOURCE_ATTRIBUTE,
} from '../../../../src/content-script/ownership-markers';
import { processDocument } from
    '../../../../src/content-script/transformation/process-document';
import { restoreExactTimes } from
    '../../../../src/content-script/transformation/render-exact-time';

import type { DisplaySettings } from
    '../../../../src/shared/settings/snapshot';

/**
 * Expected observable result for one fixture timestamp.
 */
interface ExpectedSource {
    /**
     * Fixture-only source identifier.
     */
    readonly id: string;

    /**
     * Exact page-provided datetime.
     */
    readonly rawDatetime: string;

    /**
     * Normalized UTC instant.
     */
    readonly instant: string;

    /**
     * Deterministic UTC presentation.
     */
    readonly text: string;

    /**
     * Whether the current visible label is relative and eligible for output.
     */
    readonly relative: boolean;
}

/**
 * One sanitized public-surface scenario.
 */
interface FixtureCase {
    /**
     * Fixture filename.
     */
    readonly name: string;

    /**
     * Public path used with either final hostname.
     */
    readonly path: string;

    /**
     * Expected timestamp sources in the fixture.
     */
    readonly sources: readonly ExpectedSource[];

    /**
     * Page-owned element that processing must not alter.
     */
    readonly unrelatedSelector: string;
}

const hostnames = ['x.com', 'twitter.com'] as const;
const display: DisplaySettings = {
    formatMode: 'custom',
    pattern: 'yyyy-MM-dd HH:mm',
    timeZone: { mode: 'utc' },
};
const fixtureCases: FixtureCase[] = [
    {
        name: 'feed.html',
        path: '/home',
        sources: [
            {
                id: 'feed-post',
                rawDatetime: '2026-08-20T08:30:00.000Z',
                instant: '2026-08-20T08:30:00.000Z',
                text: '2026-08-20 08:30',
                relative: true,
            },
        ],
        unrelatedSelector: '[data-unrelated="feed"]',
    },
    {
        name: 'individual-post.html',
        path: '/example/status/1002',
        sources: [
            {
                id: 'primary-post',
                rawDatetime: '2026-08-21T14:45:00.000Z',
                instant: '2026-08-21T14:45:00.000Z',
                text: '2026-08-21 14:45',
                relative: false,
            },
        ],
        unrelatedSelector: '[data-unrelated="individual-post"]',
    },
    {
        name: 'thread.html',
        path: '/example/status/1003',
        sources: [
            {
                id: 'thread-root',
                rawDatetime: '2026-08-22T09:00:00Z',
                instant: '2026-08-22T09:00:00.000Z',
                text: '2026-08-22 09:00',
                relative: true,
            },
            {
                id: 'thread-reply-one',
                rawDatetime: '2026-08-22T10:15:00Z',
                instant: '2026-08-22T10:15:00.000Z',
                text: '2026-08-22 10:15',
                relative: true,
            },
            {
                id: 'thread-reply-two',
                rawDatetime: '2026-08-22T11:40:00Z',
                instant: '2026-08-22T11:40:00.000Z',
                text: '2026-08-22 11:40',
                relative: true,
            },
        ],
        unrelatedSelector: '[data-unrelated="thread"]',
    },
    {
        name: 'quoted-post.html',
        path: '/example/status/1006',
        sources: [
            {
                id: 'quoted-outer',
                rawDatetime: '2026-08-23T12:00:00Z',
                instant: '2026-08-23T12:00:00.000Z',
                text: '2026-08-23 12:00',
                relative: true,
            },
            {
                id: 'quoted-inner',
                rawDatetime: '2026-08-22T22:10:00Z',
                instant: '2026-08-22T22:10:00.000Z',
                text: '2026-08-22 22:10',
                relative: true,
            },
        ],
        unrelatedSelector: '[data-unrelated="quoted-post"]',
    },
    {
        name: 'nested-card.html',
        path: '/example/status/1008',
        sources: [
            {
                id: 'card-outer',
                rawDatetime: '2026-08-24T15:45:00Z',
                instant: '2026-08-24T15:45:00.000Z',
                text: '2026-08-24 15:45',
                relative: true,
            },
            {
                id: 'card-inner-offset',
                rawDatetime: '2026-08-24T18:20:00+02:30',
                instant: '2026-08-24T15:50:00.000Z',
                text: '2026-08-24 15:50',
                relative: true,
            },
        ],
        unrelatedSelector: '[data-unrelated="nested-card"]',
    },
];

describe('offline X/Twitter public-surface fixtures', () => {
    const fixtures = new Map<string, string>();

    beforeAll(async () => {
        await Promise.all(fixtureCases.map(async ({ name }) => {
            fixtures.set(
                name,
                await readFile(
                    `tests/src/content-script/fixtures/x-twitter/${name}`,
                    'utf8',
                ),
            );
        }));
    });

    it.each(fixtureCases)(
        'processes $name through the universal source on each final hostname',
        ({
            name, path, sources, unrelatedSelector,
        }) => {
            const fixture = fixtures.get(name);
            if (!fixture) {
                throw new Error(`Missing fixture ${name}`);
            }
            for (const hostname of hostnames) {
                document.body.innerHTML = fixture;
                const url = new URL(`https://${hostname}${path}`);
                const unrelatedBefore = document.querySelector(
                    unrelatedSelector,
                )?.outerHTML;
                const originalTextById = new Map(sources.map(({ id }) => [
                    id,
                    document.querySelector(`[data-source-id="${id}"]`)?.textContent,
                ]));
                const relativeSources = sources.filter(({ relative }) => relative);

                expect(defaultRegistry.matching(url).map(({ id }) => id))
                    .toEqual([GENERIC_TIME_RULE_ID]);
                const outputs = processDocument({
                    url,
                    root: document,
                    locales: ['en-US'],
                    display,
                });

                expect(outputs).toHaveLength(relativeSources.length);
                expect(document.querySelectorAll(
                    `[${OWNED_OUTPUT_ATTRIBUTE}]`,
                )).toHaveLength(relativeSources.length);
                const tokens = new Set<string>();
                for (const expected of sources) {
                    const source = document.querySelector(
                        `[data-source-id="${expected.id}"]`,
                    );
                    if (!(source instanceof HTMLTimeElement)) {
                        throw new Error(`Missing time source ${expected.id}`);
                    }
                    const output = source.nextElementSibling;
                    if (!expected.relative) {
                        expect(source.getAttribute(OWNED_SOURCE_ATTRIBUTE)).toBeNull();
                        expect(source.hidden).toBe(false);
                        expect(output).toBeNull();
                        expect(source.textContent).toBe(originalTextById.get(expected.id));
                        continue;
                    }
                    if (!(output instanceof HTMLTimeElement)) {
                        throw new Error(`Missing output for ${expected.id}`);
                    }
                    expect(source.getAttribute(OWNED_SOURCE_ATTRIBUTE))
                        .toMatch(/^visible:/);
                    expect(source.hidden).toBe(true);
                    expect(output.dateTime).toBe(expected.rawDatetime);
                    expect(new Date(output.dateTime).toISOString())
                        .toBe(expected.instant);
                    expect(output.textContent).toBe(expected.text);
                    const token = output.getAttribute(OWNED_OUTPUT_ATTRIBUTE);
                    expect(token).toBeTruthy();
                    if (token) {
                        tokens.add(token);
                    }
                }
                expect(tokens.size).toBe(relativeSources.length);
                expect(document.querySelector(unrelatedSelector)?.outerHTML)
                    .toBe(unrelatedBefore);
                restoreExactTimes(document);
            }
        },
    );
});
