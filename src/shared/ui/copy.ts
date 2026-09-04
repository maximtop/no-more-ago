/**
 * @file Maps shared discriminants onto the message keys both surfaces render.
 */

import type { MessageKey } from "../i18n/translator";
import {
    SETTINGS_STATE_FAILURE,
    type SettingsStateFailure,
} from "../messaging/view-state-values";
import { SITE_SCOPE_MODE, type SiteScopeMode } from "../settings/site-scope";

/**
 * Message key naming each run mode.
 */
export const SCOPE_MODE_KEY: Readonly<Record<SiteScopeMode, MessageKey>> = Object.freeze({
    [SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED]: "scope_mode_all",
    [SITE_SCOPE_MODE.SELECTED_ONLY]: "scope_mode_selected",
});

/**
 * Message key naming the hostname list each run mode owns.
 */
export const SCOPE_LIST_KEY: Readonly<Record<SiteScopeMode, MessageKey>> = Object.freeze({
    [SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED]: "scope_list_excluded",
    [SITE_SCOPE_MODE.SELECTED_ONLY]: "scope_list_allowed",
});

/**
 * Status and consequence keys shown while settings cannot be read.
 */
export interface UnavailableSettingsKeys {
    /**
     * Key of the sentence naming the failure.
     */
    readonly status: MessageKey;

    /**
     * Key of the sentence describing what pages are doing meanwhile.
     */
    readonly consequence: MessageKey;
}

/**
 * Explains an unavailable settings projection by its failure kind.
 *
 * @param failure - Failure carried by the unavailable projection.
 * @returns - Status and consequence keys for the recovery view.
 */
export function unavailableSettingsKeys(failure: SettingsStateFailure): UnavailableSettingsKeys {
    if (failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP) {
        return {
            status: "unavailable_status_cleanup",
            consequence: "unavailable_consequence_cleanup",
        };
    }
    return {
        status: "unavailable_status_default",
        consequence: "unavailable_consequence_default",
    };
}
