/**
 * @file Verifies browser locale normalization and date-fns locale selection.
 */

import { de } from 'date-fns/locale/de';
import { enGB } from 'date-fns/locale/en-GB';
import { enUS } from 'date-fns/locale/en-US';
import { ptBR } from 'date-fns/locale/pt-BR';
import { zhCN } from 'date-fns/locale/zh-CN';
import { zhTW } from 'date-fns/locale/zh-TW';
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

    it('returns the date-fns locale object and Intl tag that match the selected code', () => {
        expect(resolveDateLocale(['en-GB'])).toEqual({ tag: 'en-GB', code: 'en-GB', locale: enGB });
        expect(resolveDateLocale(['de-DE'])).toEqual({ tag: 'de', code: 'de', locale: de });
        expect(resolveDateLocale(['pt-BR']).locale).toBe(ptBR);
        expect(resolveDateLocale(['zh-Hant-CN']).locale).toBe(zhTW);
        expect(resolveDateLocale(['zh-Hans-TW']).locale).toBe(zhCN);
        expect(resolveDateLocale([]).locale).toBe(enUS);
    });
});
