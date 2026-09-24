/**
 * @file Verifies public Telegram and Telegram Web K behavior with offline fixtures.
 */

import { readFile } from 'node:fs/promises';

import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';

import { GENERIC_TIME_RULE_ID } from '../../../../src/content-script/adapters/generic-time';
import { defaultRegistry } from '../../../../src/content-script/adapters/registry';
import {
    DocumentTransformationController,
} from '../../../../src/content-script/transformation/document-transformation-controller';

const FIXTURE_NAMES = [
    'public-channel.html',
    'web-k-chat.html',
    'web-k-eligibility-matrix.html',
] as const;
const fixtures = new Map<string, string>();
const UTC_DISPLAY = {
    formatMode: 'custom',
    pattern: 'yyyy-MM-dd HH:mm',
    timeZone: { mode: 'utc' },
} as const;

/**
 * Allows native mutation delivery and queued document reconciliation to complete.
 *
 * @returns - Promise resolved after pending mutation microtasks.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('Telegram fixtures', () => {
    beforeAll(async () => {
        for (const name of FIXTURE_NAMES) {
            const path = `tests/src/content-script/fixtures/telegram/${name}`;
            fixtures.set(name, await readFile(path, 'utf8'));
        }
    });

    it('updates Web K clocks in place while preserving neighboring page nodes', () => {
        document.body.innerHTML = fixtures.get('web-k-chat.html') ?? '';
        const views = document.getElementById('ordinary-views');
        const icon = document.getElementById('ordinary-icon');
        const editedBadge = document.getElementById('edited-badge');
        const deliveryState = document.getElementById('delivery-state');
        const status = document.getElementById('ordinary-status');
        const timeInner = document.querySelector('#ordinary .time-inner');
        if (!(status instanceof HTMLButtonElement) || !views || !icon
            || !editedBadge || !deliveryState || !timeInner) {
            throw new Error('Expected Telegram Web K preservation fixture');
        }
        const statusListener = vi.fn();
        status.addEventListener('click', statusListener);
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
            throw new Error('Telegram support must not use the network');
        });
        const controller = new DocumentTransformationController({
            url: new URL('https://web.telegram.org/k/#@fictional'),
            root: document,
            locales: ['en-US'],
            display: UTC_DISPLAY,
        });

        try {
            controller.start();
            expect(document.getElementById('ordinary-clock')?.textContent)
                .toBe('2026-05-14 16:08');
            expect(document.getElementById('edited-clock')?.textContent)
                .toBe('16:09');
            expect(document.getElementById('edited-badge')?.textContent).toBe('edited');
            expect(document.getElementById('delivery-state')?.textContent).toBe('read');
            expect(document.getElementById('ordinary-views')).toBe(views);
            expect(document.getElementById('ordinary-icon')).toBe(icon);
            expect(document.getElementById('ordinary-status')).toBe(status);
            expect(document.querySelector('#ordinary .time-inner')).toBe(timeInner);
            expect(timeInner.getAttribute('data-page-owned')).toBe('kept');
            expect(document.querySelector('[data-no-more-ago-output]')).toBeNull();
            status.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(statusListener).toHaveBeenCalledOnce();
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            controller.teardown();
            fetchMock.mockRestore();
        }

        expect(document.getElementById('ordinary-clock')?.textContent)
            .toBe('2 hours ago');
        expect(document.getElementById('edited-clock')?.textContent).toBe('16:09');
        expect(document.getElementById('ordinary-status')).toBe(status);
        expect(document.getElementById('ordinary-views')).toBe(views);
        expect(document.getElementById('ordinary-icon')).toBe(icon);
    });

    it('keeps only the proven Web K clock eligible', () => {
        document.body.innerHTML = fixtures.get('web-k-eligibility-matrix.html') ?? '';
        const unchangedIds = [
            'primary-edited-clock',
            'forwarded-clock',
            'saved-clock',
            'empty-clock',
            'padded-clock',
            'signed-clock',
            'decimal-clock',
            'exponent-clock',
            'prose-clock',
            'nine-clock',
            'eleven-clock',
            'thirteen-clock',
            'no-time-inner-clock',
            'first-container-clock',
            'second-container-clock',
            'first-direct-clock',
            'second-direct-clock',
            'complex-clock',
            'nested-owner-clock',
            'wrong-source-clock',
        ];
        const originalLabels = new Map(unchangedIds.map((id) => [
            id,
            document.getElementById(id)?.textContent,
        ]));
        const controller = new DocumentTransformationController({
            url: new URL('https://web.telegram.org/k/?thread=fictional'),
            root: document,
            locales: ['en-US'],
            display: UTC_DISPLAY,
        });

        try {
            controller.start();
            expect(document.getElementById('eligible-clock')?.textContent)
                .toBe('2026-05-14 16:08');
            for (const [id, label] of originalLabels) {
                expect(document.getElementById(id)?.textContent).toBe(label);
            }
            expect(document.querySelector('[data-no-more-ago-output]')).toBeNull();
        } finally {
            controller.teardown();
        }
        expect(document.getElementById('eligible-clock')?.textContent)
            .toBe('2 hours ago');
    });

    it('uses generic public-channel timestamps and preserves their link', async () => {
        document.body.innerHTML = fixtures.get('public-channel.html') ?? '';
        const link = document.getElementById('public-link');
        const source = document.getElementById('public-clock');
        if (!(link instanceof HTMLAnchorElement) || !(source instanceof HTMLTimeElement)) {
            throw new Error('Expected public Telegram timestamp link');
        }
        const linkAttributes = Array.from(link.attributes)
            .map(({ name, value }) => [name, value]);
        const listener = vi.fn((event: Event) => {
            event.preventDefault();
        });
        link.addEventListener('click', listener);
        const controller = new DocumentTransformationController({
            url: new URL('https://t.me/s/fictional'),
            root: document,
            locales: ['en-US'],
            display: UTC_DISPLAY,
        });

        controller.start();
        expect(source.nextElementSibling?.textContent).toBe('2026-05-14 16:08');
        expect(document.getElementById('public-link')).toBe(link);
        expect(Array.from(link.attributes).map(({ name, value }) => [name, value]))
            .toEqual(linkAttributes);
        expect(document.getElementById('public-local')?.nextElementSibling).toBeNull();
        expect(document.getElementById('public-malformed')?.nextElementSibling).toBeNull();
        expect(document.getElementById('public-absolute-clock')?.nextElementSibling)
            .toBeNull();
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(listener).toHaveBeenCalledOnce();

        const article = document.createElement('article');
        article.innerHTML = '<time id="dynamic-public-clock" '
            + 'datetime="2026-05-15T16:08:00Z">16:08</time>';
        document.getElementById('telegram-public-channel')?.append(article);
        await flushMutations();
        expect(document.getElementById('dynamic-public-clock')?.nextElementSibling?.textContent)
            .toBeUndefined();

        controller.teardown();
        expect(document.getElementById('public-link')).toBe(link);
        expect(source.textContent).toBe('2 hours ago');
        expect(source.nextElementSibling).toBeNull();
        expect(document.getElementById('dynamic-public-clock')?.textContent).toBe('16:08');
        expect(document.getElementById('dynamic-public-clock')?.nextElementSibling).toBeNull();
    });

    it('keeps other t.me paths on the universal generic rule only', () => {
        expect(defaultRegistry.matching(new URL('https://t.me/fictional'))
            .map((rule) => rule.id)).toEqual([GENERIC_TIME_RULE_ID]);
    });
});
