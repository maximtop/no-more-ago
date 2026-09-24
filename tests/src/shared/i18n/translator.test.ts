/**
 * @file Verifies message substitution, plurals, fallback, and document stamping.
 */

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import russian from '../../../../src/_locales/ru/messages.json';
import { resolveUiLocale } from '../../../../src/shared/i18n/locales';

/**
 * Loads the translator with a stubbed extension i18n API.
 *
 * @param uiLanguage - Value the stubbed API reports as the browser UI language.
 * @param messages - Messages the stubbed API resolves, by key.
 *
 * @returns - A freshly imported translator module bound to that stub.
 */
async function loadTranslator(
    uiLanguage: string,
    messages: Readonly<Record<string, string>> = {},
): Promise<typeof import('../../../../src/shared/i18n/translator')> {
    vi.stubGlobal('chrome', {
        i18n: {
            getUILanguage: () => uiLanguage,
            getMessage: (key: string) => messages[key] ?? (key === 'catalog_locale'
                ? resolveUiLocale(uiLanguage).code.replaceAll('_', '-') : ''),
        },
    });
    vi.resetModules();
    return import('../../../../src/shared/i18n/translator');
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
});

describe('t', () => {
    it('returns the English source when the browser locale is unsupported', async () => {
        const { t } = await loadTranslator('lv');
        expect(t('popup_status_active')).toBe('Active');
    });

    it('returns the translated message when the catalog has one', async () => {
        const { t } = await loadTranslator('ru', { popup_status_active: 'Активно' });
        expect(t('popup_status_active')).toBe('Активно');
    });

    it('falls back to English for a key the target catalog is missing', async () => {
        const { t } = await loadTranslator('ru', {});
        expect(t('popup_status_active')).toBe('Active');
    });

    it('substitutes placeholder values without translating them', async () => {
        const { t } = await loadTranslator('ru', {
            popup_site_switch_aria: 'Включено на %hostname%',
        });
        expect(t('popup_site_switch_aria', { hostname: 'example.com' }))
            .toBe('Включено на example.com');
    });

    it('throws for a key absent from every catalog', async () => {
        const { t } = await loadTranslator('en');
        expect(() => t('not_a_real_key' as never)).toThrow(/Was unable to find message/);
    });
});

describe('selected browser catalog', () => {
    it('uses the selected secondary language for plurals and document metadata', async () => {
        const messages = Object.fromEntries(Object.entries(russian).map(
            ([key, entry]) => [key, entry.message],
        ));
        const { tPlural, applyDocumentLocale, currentUiLocale } = await loadTranslator('lt', messages);
        expect(tPlural('sites_count', 0)).toBe('0 сайтов');
        expect(tPlural('sites_count', 2)).toBe('2 сайта');
        applyDocumentLocale('options_document_title');
        expect(currentUiLocale().code).toBe('ru');
        expect(document.documentElement.lang).toBe('ru');
        expect(document.documentElement.dir).toBe('ltr');
        expect(document.title).toBe(russian.options_document_title.message);
    });

    it('isolates dynamic technical substitutions in a right-to-left sentence', async () => {
        const { t } = await loadTranslator('ar', {
            popup_site_switch_aria: 'مفعّل على %hostname%',
        });
        expect(t('popup_site_switch_aria', { hostname: 'docs.example.com' }))
            .toBe('مفعّل على \u2066docs.example.com\u2069');
    });
});

describe('tPlural', () => {
    it.each([
        [0, '0 sites'],
        [1, '1 site'],
        [2, '2 sites'],
        [21, '21 sites'],
    ])('renders the English form for %i', async (count, expected) => {
        const { tPlural } = await loadTranslator('en');
        expect(tPlural('sites_count', count)).toBe(expected);
    });

    it.each([
        [0, '0 сайтов'],
        [1, '1 сайт'],
        [2, '2 сайта'],
        [5, '5 сайтов'],
        [11, '11 сайтов'],
        [21, '21 сайт'],
    ])('renders the Russian form for %i', async (count, expected) => {
        const { tPlural } = await loadTranslator('ru', {
            sites_count: '%count% сайтов|%count% сайт|%count% сайта|%count% сайтов',
        });
        expect(tPlural('sites_count', count)).toBe(expected);
    });
});

describe('applyDocumentLocale', () => {
    it('stamps a right-to-left language before render', async () => {
        const { applyDocumentLocale, uiDirection } = await loadTranslator('ar');
        applyDocumentLocale('options_document_title');
        expect(document.documentElement.lang).toBe('ar');
        expect(document.documentElement.dir).toBe('rtl');
        expect(uiDirection()).toBe('rtl');
    });

    it('stamps a hyphenated regional tag left to right', async () => {
        const { applyDocumentLocale, uiDirection } = await loadTranslator('pt-BR');
        applyDocumentLocale('options_document_title');
        expect(document.documentElement.lang).toBe('pt-BR');
        expect(document.documentElement.dir).toBe('ltr');
        expect(uiDirection()).toBe('ltr');
    });

    it('sets the document title from the catalog', async () => {
        const { applyDocumentLocale } = await loadTranslator('ru', {
            options_document_title: 'Настройки No More Ago',
        });
        applyDocumentLocale('options_document_title');
        expect(document.title).toBe('Настройки No More Ago');
    });
});
