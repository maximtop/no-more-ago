/**
 * @file Verifies generic standard-time discovery and extraction behavior.
 */

import { describe, expect, it } from 'vitest';

import { genericTimeRule } from '../../../../src/content-script/adapters/generic-time';
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
} from '../../../../src/content-script/adapters/types';
import { OWNED_OUTPUT_ATTRIBUTE } from '../../../../src/content-script/ownership-markers';
import { processDocument } from
    '../../../../src/content-script/transformation/process-document';

describe('genericTimeRule', () => {
    it.each([
        ['2 hours ago', true],
        ['2h', true],
        ['Aug 22, 2026', false],
        ['16:08', false],
        ['2 hrs', false],
    ])('classifies the current label %s as eligible: %s', (label, eligible) => {
        document.body.innerHTML = `<time datetime="2026-08-23T10:15:00Z">${label}</time>`;

        const outputs = processDocument({
            url: new URL('https://example.test/'),
            root: document,
            locales: ['en-US'],
        });

        expect(outputs).toHaveLength(eligible ? 1 : 0);
        expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`))
            .toHaveLength(eligible ? 1 : 0);
        expect(document.querySelector('time')?.textContent).toBe(label);
    });

    it.each([
        ['https://example.test/path', true],
        ['http://example.test/path', true],
        ['file:///example.test/path', false],
        ['ftp://example.test/path', false],
    ])('matches HTTP(S) URL %s as %s', (value, expected) => {
        expect(genericTimeRule.matches(new URL(value))).toBe(expected);
    });

    it('discovers direct and descendant light-DOM time elements', () => {
        const direct = document.createElement('time');
        const wrapper = document.createElement('section');
        const nested = document.createElement('time');
        wrapper.append(nested);
        expect(genericTimeRule.discover(direct)).toEqual([direct]);
        expect(genericTimeRule.discover(wrapper)).toEqual([nested]);
    });

    it('extracts only a non-empty datetime attribute', () => {
        document.body.innerHTML = `
            <time id="valid" datetime="2026-08-23T10:15Z">relative text</time>
            <time id="empty" datetime="   ">absolute text</time>
            <time id="title" title="2026-08-23T10:15Z">prose</time>
            <time id="aria" aria-label="2026-08-23T10:15Z">prose</time>
            <time id="data" data-datetime="2026-08-23T10:15Z">prose</time>`;
        const valid = document.getElementById('valid');
        if (!valid) {
            throw new Error('Expected valid time');
        }
        expect(genericTimeRule.extract(valid)).toEqual({
            ruleId: 'generic-time',
            source: valid,
            sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
            rawDatetime: '2026-08-23T10:15Z',
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        });
        for (const id of ['empty', 'title', 'aria', 'data']) {
            const element = document.getElementById(id);
            expect(element ? genericTimeRule.extract(element) : null).toBeNull();
        }
    });

    it('ignores owned output and Shadow DOM content', () => {
        document.body.innerHTML = '<time id="owned" datetime="2026-08-23T10:15Z" '
            + `${OWNED_OUTPUT_ATTRIBUTE}="token">owned</time><div id="host"></div>`;
        const host = document.getElementById('host');
        if (!host) {
            throw new Error('Expected shadow host');
        }
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<time datetime="2026-08-23T10:15Z">shadow</time>';
        expect(genericTimeRule.discover(document)).toEqual([]);
    });

    it('ignores time elements outside the HTML namespace', () => {
        document.body.innerHTML = '<svg><time datetime="2026-08-23T10:15Z">svg</time></svg>';
        expect(genericTimeRule.discover(document)).toEqual([]);
        const source = document.querySelector('svg time');
        expect(source ? genericTimeRule.extract(source) : null).toBeNull();
    });
});
