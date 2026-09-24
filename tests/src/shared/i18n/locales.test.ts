/**
 * @file Verifies the UI locale registry shape and its Chromium alias.
 */

import { describe, expect, it } from 'vitest';

import {
    BASE_UI_LOCALE,
    CHROMIUM_LOCALE_ALIAS,
    UI_LOCALES,
    resolveUiLocale,
} from '../../../../src/shared/i18n/locales';

const EXPECTED_CODES = [
    'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es',
    'es_419', 'fa', 'fi', 'fil', 'fr', 'he', 'hi', 'hr', 'hu', 'id',
    'it', 'ja', 'ko', 'ms', 'nb', 'nl', 'pl', 'pt_BR', 'pt_PT', 'ro',
    'ru', 'sk', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh_CN', 'zh_TW',
];

describe('UI locale registry', () => {
    it('lists exactly the 40 supported codes in order', () => {
        expect(UI_LOCALES.map(({ code }) => code)).toEqual(EXPECTED_CODES);
        expect(EXPECTED_CODES).toHaveLength(40);
    });

    it('keeps every code unique', () => {
        expect(new Set(UI_LOCALES.map(({ code }) => code)).size).toBe(40);
    });

    it('flags exactly the right-to-left languages', () => {
        expect(UI_LOCALES.filter(({ rtl }) => rtl).map(({ code }) => code))
            .toEqual(['ar', 'fa', 'he']);
    });

    it('maps regional codes onto their library locales', () => {
        const byCode = new Map(UI_LOCALES.map(({ code, adguardCode }) => [code, adguardCode]));
        expect(byCode.get('es_419')).toBe('es');
        expect(byCode.get('pt_BR')).toBe('pt_br');
        expect(byCode.get('pt_PT')).toBe('pt_pt');
        expect(byCode.get('zh_CN')).toBe('zh_cn');
        expect(byCode.get('zh_TW')).toBe('zh_tw');
        expect(byCode.get('nb')).toBe('nb');
    });

    it('bases every catalog on English', () => {
        expect(BASE_UI_LOCALE).toBe('en');
        expect(UI_LOCALES.some(({ code }) => code === BASE_UI_LOCALE)).toBe(true);
    });

    it('aliases only Norwegian for Chromium stores', () => {
        expect(CHROMIUM_LOCALE_ALIAS).toEqual({ no: 'nb' });
    });
});

describe('resolveUiLocale', () => {
    it.each(UI_LOCALES.map(({ code }) => code))('resolves the exact code %s', (code) => {
        expect(resolveUiLocale(code.replace('_', '-')).code).toBe(code);
    });

    it.each([
        ['en-US', 'en'],
        ['de-AT', 'de'],
        ['zh', 'zh_CN'],
        ['zh-Hans', 'zh_CN'],
        ['zh-Hant', 'zh_TW'],
        ['zh-HK', 'zh_TW'],
        ['zh-MO', 'zh_TW'],
        ['zh-TW', 'zh_TW'],
        ['pt', 'pt_PT'],
        ['pt-PT', 'pt_PT'],
        ['pt-BR', 'pt_BR'],
        ['es', 'es'],
        ['es-ES', 'es'],
        ['es-MX', 'es_419'],
        ['es-AR', 'es_419'],
        ['no', 'nb'],
        ['no-NO', 'nb'],
        ['nb-NO', 'nb'],
    ])('narrows %s to %s', (uiLanguage, expected) => {
        expect(resolveUiLocale(uiLanguage).code).toBe(expected);
    });

    it.each(['lv', 'lt', 'sl', 'xx', '', 'not a locale', 'en_US_'])(
        'falls back to English for the unsupported value %s',
        (uiLanguage) => {
            expect(resolveUiLocale(uiLanguage).code).toBe('en');
        },
    );

    it('reports direction from the resolved entry', () => {
        expect(resolveUiLocale('ar').rtl).toBe(true);
        expect(resolveUiLocale('he').rtl).toBe(true);
        expect(resolveUiLocale('fa').rtl).toBe(true);
        expect(resolveUiLocale('de').rtl).toBe(false);
    });
});
