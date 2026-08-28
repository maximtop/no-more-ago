/**
 * @file Display-settings projection from authoritative application state.
 */

import type { ApplicationStateView } from "../application/state";
import {
    STATE_AVAILABILITY,
    UNAVAILABLE_TIME_ZONE_ERROR,
    type DisplayState,
} from "../../shared/messages";
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
            failure: state.failure === "fail-closed-cleanup"
                ? "fail-closed-cleanup"
                : "settings-load",
        };
    }
    const display = snapshot.display;
    const unavailable = display.timeZone.mode === "iana"
        && !isZoneAvailable(display.timeZone.identifier);
    return {
        availability: STATE_AVAILABILITY.READY,
        revision: snapshot.revision,
        display,
        debugEnabled: snapshot.debugEnabled,
        ...(unavailable ? { error: UNAVAILABLE_TIME_ZONE_ERROR } : {}),
    };
}
