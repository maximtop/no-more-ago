/**
 * @file User-visible status, run-mode, and site-control copy for the popup.
 */

import {
    POPUP_STATUS,
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import type { PopupState } from "../shared/messaging/view-state-schemas";
import {
    SITE_SCOPE_MODE,
    type SiteScopeMode,
} from "../shared/settings/site-scope";
import type { MessageKey } from "../shared/i18n/translator";

/**
 * Named semantic tones paired with every status so state is never color alone.
 */
export const STATUS_TONE = {
    ACTIVE: "active",
    NEUTRAL: "neutral",
    WARNING: "warning",
    DANGER: "danger",
} as const;

/**
 * Semantic tone paired with a popup status.
 */
export type StatusTone = (typeof STATUS_TONE)[keyof typeof STATUS_TONE];

/**
 * Status message key and its semantic tone.
 */
export interface PopupStatusModel {
    /**
     * Key of the sentence describing what the extension is doing on this page.
     */
    readonly key: MessageKey;

    /**
     * Semantic tone rendered as a dot and text, never as color alone.
     */
    readonly tone: StatusTone;
}

/**
 * Describes the extension's state on the current page.
 *
 * @param state - Current popup projection.
 * @returns - Status message key and tone.
 */
export function popupStatusModel(state: PopupState): PopupStatusModel {
    if (state.availability === STATE_AVAILABILITY.UNAVAILABLE) {
        return state.failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
            ? { key: "popup_status_unknown", tone: STATUS_TONE.WARNING }
            : { key: "popup_status_unavailable", tone: STATUS_TONE.DANGER };
    }
    switch (state.status) {
        case POPUP_STATUS.ACTIVE:
            return { key: "popup_status_active", tone: STATUS_TONE.ACTIVE };
        case POPUP_STATUS.GLOBAL_DISABLED:
            return { key: "popup_status_global_disabled", tone: STATUS_TONE.NEUTRAL };
        case POPUP_STATUS.SITE_EXCLUDED:
            return { key: "popup_status_site_excluded", tone: STATUS_TONE.NEUTRAL };
        case POPUP_STATUS.SITE_NOT_SELECTED:
            return { key: "popup_status_site_not_selected", tone: STATUS_TONE.NEUTRAL };
        case POPUP_STATUS.INACCESSIBLE:
            return { key: "popup_status_inaccessible", tone: STATUS_TONE.WARNING };
        case POPUP_STATUS.RUNTIME_FAILED:
            return { key: "popup_status_runtime_failed", tone: STATUS_TONE.DANGER };
    }
}

/**
 * Names the sentence explaining what toggling the site switch will change.
 *
 * Each combination has its own complete sentence rather than one template with
 * an injected list name, because that name declines in several supported
 * languages.
 *
 * @param mode - Active scope mode.
 * @param enabled - Whether processing currently applies to the hostname.
 * @returns - Message key describing the effect of toggling the switch.
 */
export function siteSwitchDescriptionKey(mode: SiteScopeMode, enabled: boolean): MessageKey {
    if (mode === SITE_SCOPE_MODE.SELECTED_ONLY) {
        return enabled ? "popup_site_switch_selected_on" : "popup_site_switch_selected_off";
    }
    return enabled ? "popup_site_switch_all_on" : "popup_site_switch_all_off";
}
