/**
 * @file Background application lifecycle and dependency contracts.
 */

import type { DiagnosticBrowserFamily } from "../../shared/diagnostics/events";
import type { DiagnosticJournal } from "../diagnostics/journal";
import type {
    ActivationPolicy,
    ActivationReconcileResult,
} from "../runtime/document-activation";
import type { TabsRuntime } from "../runtime/tabs";
import type { SettingsService } from "../settings/service";
import type { SettingsStateFailure } from "../../shared/messaging/view-state-values";

/**
 * Lifecycle states of the background application.
 */
export const APPLICATION_PHASE = {
    COLD: "cold",
    INITIALIZING: "initializing",
    READY: "ready",
    FAILED_CLOSED: "failed-closed",
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
         * Per-host activation overrides used by the document runtime.
         */
        readonly sitePreferences?: Readonly<Record<string, boolean>>;

        /**
         * Limits reconciliation to these top-level hostnames when provided.
         */
        readonly affectedHostnames?: readonly string[];
    }): Promise<ActivationReconcileResult>;
}

/**
 * Dependencies used by the background application.
 */
export interface BackgroundApplicationOptions {
    /**
     * Service that loads and persists extension settings.
     */
    readonly settings: SettingsService;

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
    readonly journal?: DiagnosticJournal;

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
    STARTUP: "startup",
    INSTALLED: "installed",
    UPDATED: "updated",
    COLD_WORKER: "cold-worker",
} as const;

/**
 * Event that triggered background initialization or reconciliation.
 */
export type LifecycleReason = (typeof LIFECYCLE_REASON)[keyof typeof LIFECYCLE_REASON];
