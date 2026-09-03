/**
 * @file Display-settings projection from authoritative application state.
 */

import type { ApplicationStateView } from "../application/state";
import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../../shared/messaging/view-state-values";
import { UNAVAILABLE_TIME_ZONE_ERROR } from "../../shared/date/presentation-errors";
import type { DisplayState } from "../../shared/messaging/view-state-schemas";
import { APPEARANCE } from "../../shared/settings/snapshot";
import { APPLICATION_PHASE } from "../application/contracts";

/**
 * Checks whether the runtime supports an IANA time-zone identifier.
 *
 * @param identifier - Structurally valid IANA time-zone identifier.
 * @returns - Whether the current runtime can resolve the identifier.
 */
function isZoneAvailable(identifier: string): boolean {
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions();
        return true;
    } catch {
        return false;
    }
}

/**
 * Builds display state and flags an unavailable configured IANA time zone.
 *
 * @param state - Current lifecycle state.
 * @returns - Display state derived from the authoritative snapshot.
 */
export function deriveDisplayState(state: ApplicationStateView): DisplayState {
    const snapshot = state.snapshot;
    if (state.phase !== APPLICATION_PHASE.READY || !snapshot) {
        return {
            availability: STATE_AVAILABILITY.UNAVAILABLE,
            revision: null,
            display: null,
            appearance: APPEARANCE.SYSTEM,
            failure: state.failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
                ? SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
                : SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
        };
    }
    const display = snapshot.display;
    const unavailable = display.timeZone.mode === "iana"
        && !isZoneAvailable(display.timeZone.identifier);
    return {
        availability: STATE_AVAILABILITY.READY,
        revision: snapshot.revision,
        display,
        appearance: snapshot.appearance,
        debugEnabled: snapshot.debugEnabled,
        ...(unavailable ? { error: UNAVAILABLE_TIME_ZONE_ERROR } : {}),
    };
}
