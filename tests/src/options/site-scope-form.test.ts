/**
 * @file Verifies hostname form validation and per-mode Sites copy.
 */

import { describe, expect, it } from 'vitest';

import {
    activeListCopy,
    validateHostnameEntry,
} from '../../../src/options/site-scope-form';
import { SITE_SCOPE_MODE } from '../../../src/shared/settings/site-scope';

describe('hostname entry validation', () => {
    it('accepts and normalizes a hostname that is not already listed', () => {
        expect(validateHostnameEntry('  GitHub.COM. ', ['example.test']))
            .toEqual({ ok: true, hostname: 'github.com' });
        expect(validateHostnameEntry('例え.テスト', []))
            .toEqual({ ok: true, hostname: 'xn--r8jz45g.xn--zckzah' });
    });

    it.each([
        ['', 'sites_error_empty'],
        ['https://example.com', 'sites_error_invalid'],
        ['example.com/path', 'sites_error_invalid'],
        ['*.example.com', 'sites_error_invalid'],
    ])('rejects %s', (input, key) => {
        expect(validateHostnameEntry(input, [])).toEqual({ ok: false, error: key });
    });

    it('rejects a hostname already present in the active list', () => {
        expect(validateHostnameEntry('github.com', ['github.com']))
            .toEqual({ ok: false, error: 'sites_error_duplicate' });
    });
});

describe('active list copy', () => {
    it('names the excluded list and its actions', () => {
        expect(activeListCopy(SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED)).toEqual({
            title: 'scope_list_excluded',
            description: 'sites_excluded_description',
            fieldLabel: 'sites_excluded_field_label',
            submitLabel: 'sites_excluded_submit',
            removalEffect: 'sites_excluded_removal_effect',
            emptyState: 'sites_excluded_empty',
            removeAria: 'sites_remove_from_excluded_aria',
            addedConfirmation: 'sites_added_to_excluded',
            addEnables: false,
        });
    });

    it('names the allowed list and its actions', () => {
        expect(activeListCopy(SITE_SCOPE_MODE.SELECTED_ONLY)).toEqual({
            title: 'scope_list_allowed',
            description: 'sites_allowed_description',
            fieldLabel: 'sites_allowed_field_label',
            submitLabel: 'sites_allowed_submit',
            removalEffect: 'sites_allowed_removal_effect',
            emptyState: 'sites_allowed_empty',
            removeAria: 'sites_remove_from_allowed_aria',
            addedConfirmation: 'sites_added_to_allowed',
            addEnables: true,
        });
    });
});
