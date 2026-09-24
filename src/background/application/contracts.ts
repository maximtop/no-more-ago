/**
 * @file Background application lifecycle and dependency contracts.
 */

import type { DiagnosticBrowserFamily } from '../../shared/diagnostics/events';
import type { SettingsStateFailure } from '../../shared/messaging/view-state-values';
import type { SiteScopePolicy } from '../../shared/settings/site-scope';
import type { DiagnosticJournalStore } from '../diagnostics/journal';
import type {
    ActivationPolicy,
    ActivationReconcileResult,
} from '../runtime/document-activation';
import type { TabsRuntime } from '../runtime/tabs';
import type { SettingsPersistence } from '../settings/service';

/**
 * Lifecycle states of the background application.
 */
export const APPLICATION_PHASE = {
    COLD: 'cold',
    INITIALIZING: 'initializing',
    READY: 'ready',
    FAILED_CLOSED: 'failed-closed',
} as const;

/**
 * Lifecycle state of the background application.
 */
export type ApplicationPhase = (typeof APPLICATION_PHASE)[keyof typeof APPLICATION_PHASE];

/**
 * Failure retained while the application is unavailable.
 */
export type ApplicationFailure = SettingsStateFailure;

/**
 * Reconciles registered scripts and matching tabs with the current settings.
 */
export interface ActivationCoordinator {
    /**
     * Applies an activation policy and reports registration and tab failures.
     */
    reconcile(input: {
        /**
         * Settings revision associated with this reconciliation, or null while failing closed.
         */
        readonly revision: number | null;

        /**
         * Global activation policy to apply.
         */
        readonly policy: ActivationPolicy;

        /**
         * Active scope mode and hostname lists used by the document runtime.
         */
        readonly siteScope?: SiteScopePolicy;

        /**
         * Limits reconciliation to these top-level hostnames when provided.
         */
        readonly affectedHostnames?: readonly string[];
    }): Promise<ActivationReconcileResult>;
}

/**
 * Announces committed settings changes to open extension pages.
 */
export interface SettingsBroadcast {
    /**
     * Announces one committed settings revision. Delivery failure is contained
     * by the implementation, because no page may be listening.
     *
     * @param revision - Committed settings revision.
     */
    settingsChanged(revision: number): void;
}

/**
 * Dependencies used by the background application.
 */
export interface BackgroundApplicationOptions {
    /**
     * Settings load and serialized writes.
     */
    readonly settings: SettingsPersistence;

    /**
     * Runtime registration and tab-reconciliation implementation.
     */
    readonly coordinator: ActivationCoordinator;

    /**
     * Browser tab query, frame enumeration, and messaging API.
     */
    readonly tabs: TabsRuntime;

    /**
     * Optional persistent diagnostic-event journal.
     */
    readonly journal?: DiagnosticJournalStore;

    /**
     * Optional announcer for committed settings changes.
     */
    readonly broadcast?: SettingsBroadcast;

    /**
     * Optional browser and extension metadata added to diagnostic events.
     */
    readonly diagnosticEnvironment?: {
        /**
         * Extension version recorded with trusted diagnostic events.
         */
        readonly extensionVersion?: string;

        /**
         * Browser family recorded with trusted diagnostic events.
         */
        readonly browserFamily: DiagnosticBrowserFamily;
    };
}

/**
 * Events that trigger background initialization or reconciliation.
 */
export const LIFECYCLE_REASON = {
    STARTUP: 'startup',
    INSTALLED: 'installed',
    UPDATED: 'updated',
    COLD_WORKER: 'cold-worker',
} as const;

/**
 * Event that triggered background initialization or reconciliation.
 */
export type LifecycleReason = (typeof LIFECYCLE_REASON)[keyof typeof LIFECYCLE_REASON];
