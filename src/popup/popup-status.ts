/**
 * @file User-visible status, run-mode, and site-control copy for the popup.
 */

import {
    POPUP_STATUS,
    type ReadyPopupStatus,
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import type { PopupState } from "../shared/messaging/view-state";
import {
    SITE_SCOPE_MODE,
    type SiteScopeMode,
} from "../shared/settings/site-scope";
import { t, type MessageKey } from "../shared/i18n/translator";

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
     * Translated sentence describing what the extension is doing on this page.
     */
    readonly text: string;

    /**
     * Semantic tone rendered as a dot and text, never as color alone.
     */
    readonly tone: StatusTone;
}

/**
 * Message mapping for every supported outcome.
 */
const READY_STATUS_MODELS = {
    [POPUP_STATUS.ACTIVE]: {
        get text(): string {
            return t("popup_status_active");
        },
        tone: STATUS_TONE.ACTIVE,
    },
    [POPUP_STATUS.GLOBAL_DISABLED]: {
        get text(): string {
            return t("popup_status_global_disabled");
        },
        tone: STATUS_TONE.NEUTRAL,
    },
    [POPUP_STATUS.SITE_EXCLUDED]: {
        get text(): string {
            return t("popup_status_site_excluded");
        },
        tone: STATUS_TONE.NEUTRAL,
    },
    [POPUP_STATUS.SITE_NOT_SELECTED]: {
        get text(): string {
            return t("popup_status_site_not_selected");
        },
        tone: STATUS_TONE.NEUTRAL,
    },
    [POPUP_STATUS.INACCESSIBLE]: {
        get text(): string {
            return t("popup_status_inaccessible");
        },
        tone: STATUS_TONE.WARNING,
    },
    [POPUP_STATUS.RUNTIME_FAILED]: {
        get text(): string {
            return t("popup_status_runtime_failed");
        },
        tone: STATUS_TONE.DANGER,
    },
} as const satisfies Record<ReadyPopupStatus, PopupStatusModel>;

/**
 * Describes the extension's state on the current page.
 *
 * @param state - Current popup projection.
 * @returns - Status message key and tone.
 */
export function popupStatusModel(state: PopupState): PopupStatusModel {
    if (state.availability === STATE_AVAILABILITY.UNAVAILABLE) {
        return state.failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
            ? { text: t("popup_status_unknown"), tone: STATUS_TONE.WARNING }
            : { text: t("popup_status_unavailable"), tone: STATUS_TONE.DANGER };
    }
    return READY_STATUS_MODELS[state.status];
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
