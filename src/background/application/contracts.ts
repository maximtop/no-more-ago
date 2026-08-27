/**
 * @file Background application lifecycle and dependency contracts.
 */

import type { DiagnosticBrowserFamily } from "../../diagnostics/events";
import type { DiagnosticJournal } from "../../diagnostics/journal";
import type {
    ActivationMode,
    ActivationPolicy,
    ActivationReconcileResult,
    RuntimeAdapterDefinition,
} from "../../runtime/adapter-activation";
import type { TabsRuntime } from "../../runtime/tabs";
import type { SettingsService } from "../../settings/settings-service";
import type { SettingsStateFailure } from "../messaging/view-state-values";

/**
 * Lifecycle state of the background application.
 */
export type ApplicationPhase = "cold" | "initializing" | "ready" | "failed-closed";

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
         * Reason for the reconciliation run.
         */
        readonly mode: ActivationMode;

        /**
         * Global activation policy to apply.
         */
        readonly policy: ActivationPolicy;

        /**
         * Per-host activation overrides used by adapters.
         */
        readonly sitePreferences?: Readonly<Record<string, boolean>>;

        /**
         * Limits reconciliation to adapters for these hostnames when provided.
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
     * Browser tab query and messaging API.
     */
    readonly tabs: TabsRuntime;

    /**
     * Runtime adapters that define supported sites and scripts.
     */
    readonly adapters: readonly RuntimeAdapterDefinition[];

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
 * Event that triggered background initialization or reconciliation.
 */
export type LifecycleReason = "startup" | "installed" | "updated" | "cold-worker";
