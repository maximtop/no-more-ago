/**
 * @file Verifies the shipped catalogs for the four locales the spec names.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import { resolveUiLocale } from '../../../../src/shared/i18n/locales';

import type * as Translator from '../../../../src/shared/i18n/translator';

/**
 * Reads one committed catalog from the repository.
 *
 * @param code - Locale directory code.
 *
 * @returns - Parsed catalog keyed by message name.
 */
function catalog(code: string): Record<string, { message: string; description: string }> {
    const file = path.join(process.cwd(), 'src/_locales', code, 'messages.json');
    return JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        { message: string; description: string }
    >;
}

/**
 * Loads the translator bound to one shipped catalog.
 *
 * @param code - Locale directory code to serve as the browser UI language.
 *
 * @returns - A freshly imported translator module.
 */
async function withCatalog(
    code: string,
): Promise<typeof Translator> {
    const messages = catalog(code);
    vi.stubGlobal('chrome', {
        i18n: {
            getUILanguage: () => code.replace('_', '-'),
            getMessage: (key: string) => messages[key]?.message ?? '',
        },
    });
    vi.resetModules();
    return import('../../../../src/shared/i18n/translator');
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('shipped catalogs', () => {
    it.each(['ru', 'ar', 'zh_CN'])('%s translates away from English', async (code) => {
        const { t } = await withCatalog(code);
        expect(t('popup_status_active')).not.toBe('Active');
        expect(t('extension_name')).toBe('No More Ago');
    });

    it('falls back to English for an unshipped language', async () => {
        vi.stubGlobal('chrome', {
            i18n: { getUILanguage: () => 'lv', getMessage: () => '' },
        });
        vi.resetModules();
        const { t } = await import('../../../../src/shared/i18n/translator');
        expect(t('popup_status_active')).toBe('Active');
    });

    it.each(['en', 'ru', 'ar', 'zh_CN'])(
        'substitutes a hostname into %s without translating it',
        async (code) => {
            const { t } = await withCatalog(code);
            expect(t('popup_site_switch_aria', { hostname: 'example.com' }))
                .toContain('example.com');
        },
    );

    it('renders every Arabic plural form', async () => {
        const { tPlural } = await withCatalog('ar');
        const forms = new Set([0, 1, 2, 3, 11, 100].map((n) => tPlural('sites_count', n)));
        expect(forms.size).toBe(6);
    });

    it('renders the Russian few and many forms distinctly', async () => {
        const { tPlural } = await withCatalog('ru');
        expect(tPlural('sites_count', 2)).not.toBe(tPlural('sites_count', 5));
        expect(tPlural('sites_count', 21)).toBe(tPlural('sites_count', 1).replace('1', '21'));
    });

    it.each(['ar', 'fa', 'he'])(
        'isolates the left-to-right https:// literal in the %s hint',
        (code) => {
            // Without an isolate the neutral "://" takes the paragraph
            // direction and the literal renders as "//:https".
            const message = catalog(code).sites_hostname_hint?.message ?? '';
            expect(message).toContain('https://');
            expect(message).toContain('\u2066https://\u2069');
        },
    );

    it('marks Arabic as right to left and Simplified Chinese as left to right', () => {
        expect(resolveUiLocale('ar').rtl).toBe(true);
        expect(resolveUiLocale('zh-CN').rtl).toBe(false);
    });
});
