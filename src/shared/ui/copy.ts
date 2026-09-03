/**
 * @file User-facing wording shared by the popup and the settings page.
 */

import {
    SETTINGS_STATE_FAILURE,
    type SettingsStateFailure,
} from "../messaging/view-state-values";

/**
 * Label of the persisted global switch on both surfaces.
 */
export const GLOBAL_SWITCH_LABEL = "Extension enabled" as const;

/**
 * Sentence announcing that another window changed the named settings.
 *
 * @param subject - Plural subject that changed, such as "Settings".
 * @returns - Sentence describing the external change.
 */
export function updatedInAnotherWindow(subject: string): string {
    return `${subject} were updated in another window.`;
}

/**
 * Status and consequence shown while settings cannot be read.
 */
export interface UnavailableSettingsCopy {
    /**
     * Sentence naming the failure.
     */
    readonly status: string;

    /**
     * Sentence describing what pages are doing meanwhile.
     */
    readonly consequence: string;
}

/**
 * Explains an unavailable settings projection by its failure kind.
 *
 * @param failure - Failure carried by the unavailable projection.
 * @returns - Status and consequence sentences for the recovery view.
 */
export function unavailableSettingsCopy(failure: SettingsStateFailure): UnavailableSettingsCopy {
    if (failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP) {
        return {
            status: "Current processing state is unknown.",
            consequence: "Settings were read, but the previous processing state could not be "
                + "cleaned up, so some pages may still be changed.",
        };
    }
    return {
        status: "Settings could not be read, so processing is disabled.",
        consequence: "No page is being changed.",
    };
}
