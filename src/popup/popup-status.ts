/**
 * @file User-visible status, run-mode, and site-control copy for the popup.
 */

import {
    POPUP_STATUS,
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import type { PopupState } from "../shared/messaging/view-state-schemas";
import { SITE_SCOPE_MODE, type SiteScopeMode } from "../shared/settings/site-scope";

/**
 * Semantic tone paired with every status so state is never color alone.
 */
export type StatusTone = "active" | "neutral" | "warning" | "danger";

/**
 * Status text and its semantic tone.
 */
export interface PopupStatusModel {
    /**
     * Sentence describing what the extension is doing on this page.
     */
    readonly text: string;

    /**
     * Semantic tone rendered as a dot and text, never as color alone.
     */
    readonly tone: StatusTone;
}

/**
 * Describes the extension's state on the current page.
 *
 * @param state - Current popup projection.
 * @returns - Status text and tone.
 */
export function popupStatusModel(state: PopupState): PopupStatusModel {
    if (state.availability === STATE_AVAILABILITY.UNAVAILABLE) {
        return state.failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
            ? { text: "Current processing state is unknown", tone: "warning" }
            : { text: "Settings are unavailable", tone: "danger" };
    }
    switch (state.status) {
        case POPUP_STATUS.ACTIVE:
            return { text: "Active", tone: "active" };
        case POPUP_STATUS.GLOBAL_DISABLED:
            return { text: "Extension is off", tone: "neutral" };
        case POPUP_STATUS.SITE_EXCLUDED:
            return { text: "Excluded on this site", tone: "neutral" };
        case POPUP_STATUS.SITE_NOT_SELECTED:
            return { text: "Not selected for this site", tone: "neutral" };
        case POPUP_STATUS.INACCESSIBLE:
            return { text: "Cannot run on this page", tone: "warning" };
        case POPUP_STATUS.RUNTIME_FAILED:
            return { text: "Could not process this page", tone: "danger" };
    }
}

/**
 * Names the active run mode for the popup summary row.
 *
 * @param mode - Active scope mode.
 * @returns - Run-mode label shared with the settings page.
 */
export function runModeLabel(mode: SiteScopeMode): string {
    return mode === SITE_SCOPE_MODE.SELECTED_ONLY
        ? "Selected sites only"
        : "All supported sites";
}

/**
 * Explains what toggling the site switch will change under the active mode.
 *
 * @param mode - Active scope mode.
 * @param enabled - Whether processing currently applies to the hostname.
 * @returns - Sentence describing the effect of toggling the switch.
 */
export function siteControlDescription(mode: SiteScopeMode, enabled: boolean): string {
    if (mode === SITE_SCOPE_MODE.SELECTED_ONLY) {
        return enabled
            ? "Turning this off removes this hostname from Allowed sites."
            : "Turning this on adds this hostname to Allowed sites.";
    }
    return enabled
        ? "Turning this off adds this hostname to Excluded sites."
        : "Turning this on removes this hostname from Excluded sites.";
}
