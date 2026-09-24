/**
 * @file Verifies diagnostic context derivation and privacy-preserving normalization.
 */

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from '../../../../src/shared/diagnostics/contracts';
import {
    createDiagnosticEvent,
    diagnosticEventSchema,
    deriveDiagnosticContext,
} from '../../../../src/shared/diagnostics/events';

describe('diagnostic events', () => {
    it('derives only coarse context from the browser sender', () => {
        expect(deriveDiagnosticContext({
            url: 'https://github.com/acme/project/issues/3?token=secret#comment',
            tab: { incognito: true },
        })).toEqual({
            hostname: 'github.com',
            pageCategory: 'issue',
            incognito: true,
        });
        expect(deriveDiagnosticContext({ url: 'chrome://extensions' })).toBeNull();
    });

    it('keeps bounded technical fields and redacts stack contents', () => {
        const event = createDiagnosticEvent(
            {
                category: 'error',
                count: 2,
                durationMs: 10,
                reason: 'processing-failed',
                extensionVersion: '0.1.0',
                browserFamily: 'chromium',
                stack: 'Error: secret token\n at run (/Users/max/app.ts:12:7)',
            },
            { url: 'https://github.com/acme/project/issues/3' },
            123,
        );
        expect(event).toEqual({
            category: 'error',
            timestamp: 123,
            hostname: 'github.com',
            pageCategory: 'issue',
            incognito: false,
            count: 2,
            durationMs: 10,
            reason: 'processing-failed',
            extensionVersion: '0.1.0',
            browserFamily: 'chromium',
            stack: ['frame', 'frame:12:7'],
        });
        expect(JSON.stringify(event)).not.toMatch(/secret|token|Users|max|app\.ts/u);
    });

    it('rejects unknown fields and unsupported sender URLs', () => {
        expect(createDiagnosticEvent(
            { category: 'mutation', currentUrl: 'https://github.com/private' },
            { url: 'https://github.com/acme/project' },
            1,
        )).toBeNull();
        expect(createDiagnosticEvent(
            { category: 'mutation' },
            { url: 'ftp://github.com/acme/project' },
            1,
        )).toBeNull();
    });

    it('retains bounded numeric source evidence only for invalid timestamps', () => {
        const failed = createDiagnosticEvent(
            {
                category: DIAGNOSTIC_CATEGORY.SKIP,
                reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
                count: 1,
                sourceTimestamp: '123456789',
            },
            { url: 'https://web.telegram.org/k/?private=query#fragment' },
            123,
        );
        expect(failed).toMatchObject({
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
            hostname: 'web.telegram.org',
            pageCategory: 'other',
            sourceTimestamp: '123456789',
        });
        expect(JSON.stringify(failed)).not.toMatch(/private|query|fragment/u);

        const successful = createDiagnosticEvent(
            {
                category: DIAGNOSTIC_CATEGORY.ADAPTER,
                reason: DIAGNOSTIC_REASON.ADAPTER_MATCHED,
                sourceTimestamp: '1778774880',
            },
            { url: 'https://web.telegram.org/k/' },
            124,
        );
        expect(successful).not.toHaveProperty('sourceTimestamp');
    });

    it.each([
        '0',
        '123456789',
        '12345678901234567890',
    ])('retains approved numeric source value %s', (sourceTimestamp) => {
        expect(createDiagnosticEvent(
            {
                category: DIAGNOSTIC_CATEGORY.SKIP,
                reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
                sourceTimestamp,
            },
            { url: 'https://web.telegram.org/k/' },
            1,
        )).toHaveProperty('sourceTimestamp', sourceTimestamp);
    });

    it.each([
        '',
        '+123',
        '-123',
        ' 123',
        '123 ',
        '12.3',
        '1e3',
        '12\n3',
        'not-a-timestamp',
        '<time>123</time>',
        '123456789012345678901',
    ])('omits unsafe source value %j', (sourceTimestamp) => {
        expect(createDiagnosticEvent(
            {
                category: DIAGNOSTIC_CATEGORY.SKIP,
                reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
                sourceTimestamp,
            },
            { url: 'https://web.telegram.org/k/' },
            1,
        )).not.toHaveProperty('sourceTimestamp');
    });

    it('rejects persisted success events that carry raw source evidence', () => {
        const base = {
            timestamp: 1,
            hostname: 'web.telegram.org',
            pageCategory: 'other',
            incognito: false,
            sourceTimestamp: '1778774880',
        } as const;
        expect(v.is(diagnosticEventSchema, {
            ...base,
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
        })).toBe(true);
        expect(v.is(diagnosticEventSchema, {
            ...base,
            category: DIAGNOSTIC_CATEGORY.ADAPTER,
            reason: DIAGNOSTIC_REASON.ADAPTER_MATCHED,
        })).toBe(false);
    });
});
