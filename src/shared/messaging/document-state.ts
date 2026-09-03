/**
 * @file Document runtime state projected by the background context.
 */

import type { UNAVAILABLE_TIME_ZONE_ERROR } from "../date/presentation-errors";
import type { DisplaySettings } from "../settings/snapshot";
import type { STATE_AVAILABILITY, SettingsStateFailure } from "./view-state-values";

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
interface UnavailableDocumentState {
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
