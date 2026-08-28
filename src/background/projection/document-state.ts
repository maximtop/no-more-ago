/**
 * Derives authoritative policy state for one content-script document.
 *
 * @file Top-level tab policy projection for document hydration.
 */
import type { DiagnosticSender } from "../../shared/diagnostics/events";
import {
    STATE_AVAILABILITY,
    type DocumentState,
} from "../../shared/messages";
import { parseHttpUrl } from "../../shared/url/http";
import { isSiteEnabled } from "../../shared/settings/snapshot";
import type { ApplicationStateView } from "../application/state";
import { APPLICATION_PHASE } from "../application/contracts";
import { deriveDisplayState } from "./display-state";

/**
 * Builds document state from application settings and sender tab metadata.
 *
 * @param state - Current authoritative application state.
 * @param sender - Untrusted sender metadata supplied by the browser.
 * @returns Fail-closed or ready document state.
 */
export function deriveDocumentState(
    state: ApplicationStateView,
    sender: DiagnosticSender,
): DocumentState {
    const displayState = deriveDisplayState(state);
    if (state.phase !== APPLICATION_PHASE.READY || !state.snapshot) {
        return {
            availability: STATE_AVAILABILITY.UNAVAILABLE,
            revision: null,
            enabled: false,
            display: null,
            debugEnabled: false,
            failure: state.failure ?? "settings-load",
        };
    }
    const topLevelUrl = parseHttpUrl(sender.tab?.url);
    return {
        availability: STATE_AVAILABILITY.READY,
        revision: state.snapshot.revision,
        enabled: state.snapshot.globalEnabled
            && topLevelUrl !== null
            && isSiteEnabled(state.snapshot.sitePreferences, topLevelUrl.hostname),
        display: displayState.availability === STATE_AVAILABILITY.READY
            ? displayState.display
            : state.snapshot.display,
        debugEnabled: state.snapshot.debugEnabled,
        ...(displayState.availability === STATE_AVAILABILITY.READY && "error" in displayState
            ? { error: displayState.error }
            : {}),
    };
}
