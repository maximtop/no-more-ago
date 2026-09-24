/**
 * @file Verifies browser locale normalization and date-fns locale selection.
 */

import { describe, expect, it } from 'vitest';

import { resolveDateLocale } from '../../../../src/shared/date/date-locale';

describe('date locale resolution', () => {
    it('uses exact and ordered language-region matches', () => {
        expect(resolveDateLocale(['en-GB']).code).toBe('en-GB');
        expect(resolveDateLocale(['zz-ZZ', 'de-DE']).code).toBe('de');
    });

    it('handles script and region preferences for Chinese and Portuguese', () => {
        expect(resolveDateLocale(['zh-Hant-CN']).code).toBe('zh-TW');
        expect(resolveDateLocale(['zh-Hans-TW']).code).toBe('zh-CN');
        expect(resolveDateLocale(['pt-BR']).code).toBe('pt-BR');
    });

    it('ignores malformed tags and falls back to en-US', () => {
        expect(resolveDateLocale(['not a locale', 'zz-ZZ']).code).toBe('en-US');
        expect(resolveDateLocale(['de-DE-u-ca-gregory']).code).toBe('de');
    });
});
