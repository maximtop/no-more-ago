/**
 * @file Read-only lifecycle state shared by background collaborators.
 */

import type { SettingsSnapshotV5 } from "../settings/snapshot";
import type { ApplicationFailure, ApplicationPhase } from "./application-contracts";

/**
 * Current authoritative lifecycle and settings state.
 */
export interface ApplicationStateView {
    /**
     * Current lifecycle phase.
     */
    readonly phase: ApplicationPhase;

    /**
     * Last successfully loaded settings snapshot.
     */
    readonly snapshot: SettingsSnapshotV5 | undefined;

    /**
     * Failure retained while the application is unavailable.
     */
    readonly failure: ApplicationFailure | undefined;
}
