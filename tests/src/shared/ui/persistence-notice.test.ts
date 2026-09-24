/**
 * @file Verifies notice keys, including the per-surface ambiguous outcome.
 */

import { describe, expect, it } from 'vitest';

import { SETTINGS_STATE_FAILURE } from '../../../../src/shared/messaging/view-state-values';
import { SITE_SCOPE_MODE } from '../../../../src/shared/settings/site-scope';
import {
    SCOPE_MODE_KEY,
    unavailableSettingsKeys,
} from '../../../../src/shared/ui/copy';
import {
    MUTATION_NOTICE,
    NOTICE_SURFACE,
    mutationNoticeKey,
} from '../../../../src/shared/ui/persistence-notice';

describe('mutationNoticeKey', () => {
    it.each([
        [MUTATION_NOTICE.SAVE_FAILED, 'notice_save_failed'],
        [MUTATION_NOTICE.INVALID_HOSTNAME, 'notice_invalid_hostname'],
        [MUTATION_NOTICE.LIST_FULL, 'notice_list_full'],
        [MUTATION_NOTICE.SCOPE_CHANGED, 'notice_scope_changed'],
        [MUTATION_NOTICE.INTERRUPTED, 'notice_interrupted'],
    ])('maps %s to a surface-independent key', (notice, key) => {
        expect(mutationNoticeKey(notice, NOTICE_SURFACE.POPUP)).toBe(key);
        expect(mutationNoticeKey(notice, NOTICE_SURFACE.OPTIONS)).toBe(key);
    });

    it('words the ambiguous outcome per surface', () => {
        expect(mutationNoticeKey(MUTATION_NOTICE.UNKNOWN, NOTICE_SURFACE.POPUP))
            .toBe('notice_unknown_popup');
        expect(mutationNoticeKey(MUTATION_NOTICE.UNKNOWN, NOTICE_SURFACE.OPTIONS))
            .toBe('notice_unknown_options');
    });

    it('shows nothing when there is no notice', () => {
        expect(mutationNoticeKey(undefined, NOTICE_SURFACE.POPUP)).toBeUndefined();
    });
});

describe('scope keys', () => {
    it('names each run mode', () => {
        expect(SCOPE_MODE_KEY[SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED]).toBe('scope_mode_all');
        expect(SCOPE_MODE_KEY[SITE_SCOPE_MODE.SELECTED_ONLY]).toBe('scope_mode_selected');
    });
});

describe('unavailableSettingsKeys', () => {
    it('distinguishes a fail-closed cleanup from an unreadable snapshot', () => {
        expect(unavailableSettingsKeys(SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP)).toEqual({
            status: 'unavailable_status_cleanup',
            consequence: 'unavailable_consequence_cleanup',
        });
        expect(unavailableSettingsKeys(SETTINGS_STATE_FAILURE.SETTINGS_LOAD)).toEqual({
            status: 'unavailable_status_default',
            consequence: 'unavailable_consequence_default',
        });
    });
});
