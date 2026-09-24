/**
 * @file Document runtime state projected by the background context.
 */

import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
    type SettingsStateFailure,
} from './view-state-values';

import type { UNAVAILABLE_TIME_ZONE_ERROR } from '../date/presentation-errors';
import type { DisplaySettings } from '../settings/snapshot';

/**
 * Document state projected while settings are readable.
 */
interface ReadyDocumentState {
    /**
     * Marks a projection built from a loaded settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.READY;

    /**
     * Settings revision the projection was built from.
     */
    readonly revision: number;

    /**
     * Whether the document may process timestamps.
     */
    readonly enabled: boolean;

    /**
     * Display settings the document runtime must apply.
     */
    readonly display: DisplaySettings;

    /**
     * Whether the document may forward diagnostic events.
     */
    readonly debugEnabled: boolean;

    /**
     * Presentation error reported when the configured time zone is unavailable.
     */
    readonly error?: typeof UNAVAILABLE_TIME_ZONE_ERROR;
}

/**
 * Fail-closed document state projected when settings cannot be read safely.
 */
export interface UnavailableDocumentState {
    /**
     * Marks a projection built without a usable settings snapshot.
     */
    readonly availability: typeof STATE_AVAILABILITY.UNAVAILABLE;

    /**
     * Absent settings revision.
     */
    readonly revision: null;

    /**
     * Processing stays disabled while settings are unavailable.
     */
    readonly enabled: false;

    /**
     * Absent display settings.
     */
    readonly display: null;

    /**
     * Diagnostic forwarding stays disabled while settings are unavailable.
     */
    readonly debugEnabled: false;

    /**
     * Settings failure that made the projection unavailable.
     */
    readonly failure: SettingsStateFailure;
}

/**
 * Complete ready or unavailable document runtime state.
 */
export type DocumentState = ReadyDocumentState | UnavailableDocumentState;

/**
 * Builds the fail-closed document state used when settings cannot be read safely.
 *
 * @param failure - Settings failure that made the state unavailable.
 *
 * @returns - Complete unavailable document state.
 */
export function createUnavailableDocumentState(
    failure: SettingsStateFailure = SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
): UnavailableDocumentState {
    return {
        availability: STATE_AVAILABILITY.UNAVAILABLE,
        revision: null,
        enabled: false,
        display: null,
        debugEnabled: false,
        failure,
    };
}
