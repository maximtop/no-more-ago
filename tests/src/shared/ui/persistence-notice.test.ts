/**
 * @file Verifies notice keys, including the per-surface ambiguous outcome.
 */

import { describe, expect, it } from 'vitest';

import { CLIENT_RESULT_KIND } from '../../../../src/shared/client-result';
import {
    SETTINGS_PERSISTENCE_ERROR,
    SETTINGS_STATE_FAILURE,
    SITE_SETTINGS_ERROR,
} from '../../../../src/shared/messaging/view-state-values';
import { SITE_SCOPE_MODE } from '../../../../src/shared/settings/site-scope';
import {
    SCOPE_MODE_KEY,
    unavailableSettingsKeys,
} from '../../../../src/shared/ui/copy';
import {
    MUTATION_NOTICE,
    NOTICE_SURFACE,
    mutationNoticeKey,
    persistenceNotice,
    settleMutation,
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

describe('persistenceNotice', () => {
    it.each([
        [SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE, MUTATION_NOTICE.UNKNOWN],
        [SETTINGS_PERSISTENCE_ERROR.SAVE_FAILED, MUTATION_NOTICE.SAVE_FAILED],
        [SITE_SETTINGS_ERROR.INVALID_HOSTNAME, MUTATION_NOTICE.INVALID_HOSTNAME],
        [SITE_SETTINGS_ERROR.LIST_FULL, MUTATION_NOTICE.LIST_FULL],
        [SITE_SETTINGS_ERROR.SCOPE_CHANGED, MUTATION_NOTICE.SCOPE_CHANGED],
    ])('maps %s to %s', (error, notice) => {
        expect(persistenceNotice(error)).toBe(notice);
    });
});

describe('settleMutation', () => {
    const state = { revision: 3 };
    const reread = { revision: 4 };

    it('renders the response state with no notice after success', () => {
        expect(settleMutation({
            kind: CLIENT_RESULT_KIND.RESPONSE,
            response: { ok: true, state },
        })).toEqual({ state, notice: undefined });
    });

    it('renders the response state with the mapped notice after a rejected command', () => {
        expect(settleMutation({
            kind: CLIENT_RESULT_KIND.RESPONSE,
            response: { ok: false, error: SITE_SETTINGS_ERROR.LIST_FULL, state },
        })).toEqual({ state, notice: MUTATION_NOTICE.LIST_FULL });
    });

    it('reports an unknown outcome when the background could not tell whether the write landed', () => {
        expect(settleMutation({
            kind: CLIENT_RESULT_KIND.RESPONSE,
            response: { ok: false, error: SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE, state },
        })).toEqual({ state, notice: MUTATION_NOTICE.UNKNOWN });
    });

    it('renders the reread state as interrupted after a lost response', () => {
        expect(settleMutation({ kind: CLIENT_RESULT_KIND.AMBIGUOUS, state: reread }))
            .toEqual({ state: reread, notice: MUTATION_NOTICE.INTERRUPTED });
    });

    it('renders nothing and reports unknown when the reread also failed', () => {
        expect(settleMutation({ kind: CLIENT_RESULT_KIND.AMBIGUOUS }))
            .toEqual({ state: undefined, notice: MUTATION_NOTICE.UNKNOWN });
    });
});
