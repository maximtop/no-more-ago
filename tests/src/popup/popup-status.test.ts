/**
 * @file Verifies popup status text, tone, and site-control copy.
 */

import { describe, expect, it } from 'vitest';

import { popupStatusModel, siteSwitchDescriptionKey } from '../../../src/popup/popup-status';
import {
    POPUP_STATUS,
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from '../../../src/shared/messaging/view-state-values';
import { SITE_SCOPE_MODE } from '../../../src/shared/settings/site-scope';
import { APPEARANCE } from '../../../src/shared/settings/snapshot';

import type { PopupState } from '../../../src/shared/messaging/view-state';

const ready = (overrides: Partial<PopupState> = {}): PopupState => ({
    availability: STATE_AVAILABILITY.READY,
    revision: 2,
    globalEnabled: true,
    hostname: 'github.com',
    siteEnabled: true,
    scopeMode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
    appearance: APPEARANCE.SYSTEM,
    status: POPUP_STATUS.ACTIVE,
    ...overrides,
} as PopupState);

describe('popup status', () => {
    it.each([
        [POPUP_STATUS.ACTIVE, 'Active', 'active'],
        [POPUP_STATUS.GLOBAL_DISABLED, 'Extension is off', 'neutral'],
        [POPUP_STATUS.SITE_EXCLUDED, 'Excluded on this site', 'neutral'],
        [POPUP_STATUS.SITE_NOT_SELECTED, 'Not selected for this site', 'neutral'],
        [POPUP_STATUS.INACCESSIBLE, 'Cannot run on this page', 'warning'],
        [POPUP_STATUS.RUNTIME_FAILED, 'Could not process this page', 'danger'],
    ])('describes %s', (status, text, tone) => {
        expect(popupStatusModel(ready({ status }))).toEqual({ text, tone });
    });

    it('describes an unknown processing state after a fail-closed cleanup', () => {
        expect(popupStatusModel({
            availability: STATE_AVAILABILITY.UNAVAILABLE,
            revision: null,
            globalEnabled: null,
            hostname: null,
            siteEnabled: null,
            scopeMode: null,
            appearance: APPEARANCE.SYSTEM,
            status: POPUP_STATUS.RUNTIME_FAILED,
            failure: SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP,
        })).toEqual({ text: 'Current processing state is unknown', tone: 'warning' });
    });

    it.each([
        [SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, true, 'popup_site_switch_all_on'],
        [SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, false, 'popup_site_switch_all_off'],
        [SITE_SCOPE_MODE.SELECTED_ONLY, true, 'popup_site_switch_selected_on'],
        [SITE_SCOPE_MODE.SELECTED_ONLY, false, 'popup_site_switch_selected_off'],
    ])('names the site-switch sentence for %s when enabled is %s', (mode, enabled, key) => {
        expect(siteSwitchDescriptionKey(mode, enabled)).toBe(key);
    });
});
