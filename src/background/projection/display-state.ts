/**
 * @file Display-settings projection from authoritative application state.
 */

import { UNAVAILABLE_TIME_ZONE_ERROR } from '../../shared/date/presentation-errors';
import {
    createUnavailableDisplayState,
    type DisplayState,
} from '../../shared/messaging/view-state';
import { STATE_AVAILABILITY } from '../../shared/messaging/view-state-values';
import { TIME_ZONE_MODE } from '../../shared/settings/snapshot';
import { APPLICATION_PHASE } from '../application/contracts';

import type { ApplicationStateView } from '../application/state';

/**
 * Checks whether the runtime supports an IANA time-zone identifier.
 *
 * @param identifier - Structurally valid IANA time-zone identifier.
 *
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
 *
 * @returns - Display state derived from the authoritative snapshot.
 */
export function deriveDisplayState(state: ApplicationStateView): DisplayState {
    const { snapshot } = state;
    if (state.phase !== APPLICATION_PHASE.READY || !snapshot) {
        return createUnavailableDisplayState(state.failure);
    }
    const { display } = snapshot;
    const unavailable = display.timeZone.mode === TIME_ZONE_MODE.IANA
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
