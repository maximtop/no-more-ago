/**
 * @file Background initialization, serialization, and lifecycle reconciliation.
 */

import type {
    ActivationPolicy,
    ActivationReconcileResult,
} from "../runtime/document-activation";
import {
    ACTIVATION_POLICY,
} from "../runtime/document-activation";
import type { SettingsService } from "../settings/service";
import type { SettingsSnapshotV5 } from "../../shared/settings/snapshot";
import type { ActivationManager } from "./activation-manager";
import {
    APPLICATION_PHASE,
    LIFECYCLE_REASON,
    type ApplicationFailure,
    type ApplicationPhase,
    type LifecycleReason,
} from "./contracts";
import type { ApplicationStateView } from "./state";
import type { DiagnosticsService } from "../diagnostics/service";
import type { StateProjection } from "../projection/state-projection";
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../shared/diagnostics/contracts";

/**
 * Owns authoritative application state and serialized lifecycle transitions.
 */
export class ApplicationLifecycle {
    /**
     * Persistence boundary used during initialization and recovery.
     */
    private readonly settings: SettingsService;

    /**
     * Runtime reconciliation state.
     */
    private readonly activation: ActivationManager;

    /**
     * Popup projection refreshed after runtime transitions.
     */
    private readonly projection: StateProjection;

    /**
     * Diagnostic journal policy used during lifecycle transitions.
     */
    private readonly diagnostics: DiagnosticsService;

    /**
     * Current lifecycle phase.
     */
    private phaseValue: ApplicationPhase = APPLICATION_PHASE.COLD;

    /**
     * Last successfully loaded authoritative settings.
     */
    private snapshotValue: SettingsSnapshotV5 | undefined;

    /**
     * Failure retained while the application is unavailable.
     */
    private failureValue: ApplicationFailure | undefined;

    /**
     * Shared initialization or recovery promise.
     */
    private readinessFlight: Promise<void> | undefined;

    /**
     * Promise chain serializing state-changing operations.
     */
    private transactionTail: Promise<void> = Promise.resolve();

    /**
     * Lifecycle triggers waiting for an activation sweep.
     */
    private readonly lifecycleReasons = new Set<LifecycleReason>();

    /**
     * Shared promise preventing duplicate lifecycle drains.
     */
    private lifecycleFlight: Promise<void> | undefined;

    /**
     * Creates the lifecycle coordinator.
     *
     * @param settings - Settings persistence boundary.
     * @param activation - Runtime reconciliation manager.
     * @param projection - Popup and sites-state projection service.
     * @param diagnostics - Diagnostic journal service.
     */
    public constructor(
        settings: SettingsService,
        activation: ActivationManager,
        projection: StateProjection,
        diagnostics: DiagnosticsService,
    ) {
        this.settings = settings;
        this.activation = activation;
        this.projection = projection;
        this.diagnostics = diagnostics;
    }

    /**
     * Current lifecycle phase.
     *
     * @returns - Current phase.
     */
    public get phase(): ApplicationPhase {
        return this.phaseValue;
    }

    /**
     * Current authoritative settings snapshot.
     *
     * @returns - Loaded settings, when available.
     */
    public get snapshot(): SettingsSnapshotV5 | undefined {
        return this.snapshotValue;
    }

    /**
     * Latest runtime reconciliation result.
     *
     * @returns - Latest activation result, when available.
     */
    public get reconcileResult(): ActivationReconcileResult | undefined {
        return this.activation.result;
    }

    /**
     * Read-only lifecycle state consumed by projection services.
     *
     * @returns - Current phase, settings, and failure.
     */
    public get state(): ApplicationStateView {
        return {
            phase: this.phaseValue,
            snapshot: this.snapshotValue,
            failure: this.failureValue,
        };
    }

    /**
     * Serializes an operation after all earlier background work.
     *
     * @param operation - Asynchronous state-changing operation.
     * @returns - Promise carrying the operation result.
     */
    public enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.transactionTail.then(operation);
        this.transactionTail = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    /**
     * Replaces the authoritative settings snapshot after a successful write.
     *
     * @param snapshot - Newly persisted snapshot.
     */
    public adoptSnapshot(snapshot: SettingsSnapshotV5): void {
        this.snapshotValue = snapshot;
    }

    /**
     * Marks a persisted snapshot as ready and clears lifecycle failure state.
     *
     * @param snapshot - Newly authoritative snapshot.
     */
    public markReady(snapshot: SettingsSnapshotV5): void {
        this.snapshotValue = snapshot;
        this.failureValue = undefined;
        this.phaseValue = APPLICATION_PHASE.READY;
    }

    /**
     * Enters fail-closed mode after settings become unavailable.
     *
     * @param inspectCleanup - Whether cleanup failures replace the settings failure.
     * @returns - Promise settled after fail-closed runtime reconciliation.
     */
    public async enterFailedClosed(inspectCleanup = false): Promise<void> {
        this.snapshotValue = undefined;
        this.failureValue = "settings-load";
        const cleanup = await this.reconcile(
            ACTIVATION_POLICY.UNKNOWN,
            null,
            {},
        );
        if (inspectCleanup && cleanup.failures.length > 0) {
            this.failureValue = "fail-closed-cleanup";
        }
        this.phaseValue = APPLICATION_PHASE.FAILED_CLOSED;
    }

    /**
     * Clears retained activation state before a complete runtime rebuild.
     */
    public clearReconcileResult(): void {
        this.activation.clear();
    }

    /**
     * Clears lifecycle events consumed by a complete reset reconciliation.
     */
    public clearLifecycleReasons(): void {
        this.lifecycleReasons.clear();
    }

    /**
     * Advances the retained reconciliation revision after a no-op settings write.
     *
     * @param revision - Newly persisted settings revision.
     */
    public advanceReconcileRevision(revision: number): void {
        this.activation.advanceRevision(revision);
    }

    /**
     * Reconciles the document runtime and updates cached popup state.
     *
     * @param policy - Effective global policy.
     * @param revision - Associated settings revision.
     * @param sitePreferences - Canonical-host activation overrides.
     * @param affectedHostnames - Optional hostnames limiting reconciliation.
     * @returns - Reconciliation result.
     */
    public async reconcile(
        policy: ActivationPolicy,
        revision: number | null,
        sitePreferences: Readonly<Record<string, boolean>> =
            this.snapshotValue?.sitePreferences ?? {},
        affectedHostnames?: readonly string[],
    ): Promise<ActivationReconcileResult> {
        const result = await this.activation.reconcile(
            policy,
            revision,
            sitePreferences,
            affectedHostnames,
        );
        this.projection.refreshCachedPopup(this.state);
        return result;
    }

    /**
     * Ensures settings and runtime activation are ready for a lifecycle reason.
     *
     * @param reason - Lifecycle event requiring initialized state.
     * @returns - Promise settled after settings and activation are ready.
     */
    public ensureReady(reason: LifecycleReason = LIFECYCLE_REASON.COLD_WORKER): Promise<void> {
        if (reason !== LIFECYCLE_REASON.COLD_WORKER) {
            this.lifecycleReasons.add(reason);
        }
        if (this.phaseValue === APPLICATION_PHASE.READY) {
            return this.drainLifecycle();
        }
        if (
            this.phaseValue === APPLICATION_PHASE.FAILED_CLOSED
            && this.readinessFlight === undefined
        ) {
            this.readinessFlight = this.enqueue(() => this.recover()).finally(() => {
                this.readinessFlight = undefined;
            });
            return this.readinessFlight;
        }
        if (this.readinessFlight) {
            return this.readinessFlight;
        }
        this.readinessFlight = this.enqueue(() => this.initialize()).finally(() => {
            this.readinessFlight = undefined;
        });
        return this.readinessFlight;
    }

    /**
     * Drains queued lifecycle events through activation sweeps.
     *
     * @returns - Promise settled after queued lifecycle events are reconciled.
     */
    public drainLifecycle(): Promise<void> {
        if (this.lifecycleReasons.size === 0) {
            return Promise.resolve();
        }
        if (this.lifecycleFlight) {
            return this.lifecycleFlight;
        }
        this.lifecycleFlight = this.enqueue(async () => {
            while (this.lifecycleReasons.size > 0) {
                const snapshot = this.snapshotValue;
                if (this.phaseValue !== APPLICATION_PHASE.READY || !snapshot) {
                    return;
                }
                await this.reconcile(
                    snapshot.globalEnabled
                        ? ACTIVATION_POLICY.ENABLED
                        : ACTIVATION_POLICY.DISABLED,
                    snapshot.revision,
                    snapshot.sitePreferences,
                );
                this.lifecycleReasons.clear();
                this.diagnostics.log({
                    category: DIAGNOSTIC_CATEGORY.LIFECYCLE,
                    count: 1,
                }, this.state);
            }
        }).finally(() => {
            this.lifecycleFlight = undefined;
        });
        return this.lifecycleFlight;
    }

    /**
     * Queues a browser lifecycle event and ensures it is reconciled.
     *
     * @param reason - Browser lifecycle event to reconcile.
     * @returns - Promise settled when the event has been processed.
     */
    public requestLifecycle(
        reason: Exclude<LifecycleReason, typeof LIFECYCLE_REASON.COLD_WORKER>,
    ): Promise<void> {
        this.lifecycleReasons.add(reason);
        return this.ensureReady(reason);
    }

    /**
     * Loads settings and reconciles the document runtime for a cold application.
     */
    private async initialize(): Promise<void> {
        this.phaseValue = APPLICATION_PHASE.INITIALIZING;
        const loaded = await this.settings.load();
        if (!loaded.ok) {
            await this.enterFailedClosed(true);
            return;
        }
        this.snapshotValue = loaded.snapshot;
        this.failureValue = undefined;
        if (loaded.snapshot.debugEnabled) {
            await this.diagnostics.setEnabled(true);
        }
        try {
            await this.reconcile(
                loaded.snapshot.globalEnabled
                    ? ACTIVATION_POLICY.ENABLED
                    : ACTIVATION_POLICY.DISABLED,
                loaded.snapshot.revision,
                loaded.snapshot.sitePreferences,
            );
            this.lifecycleReasons.clear();
            this.phaseValue = APPLICATION_PHASE.READY;
            await this.projection.seed(this.state);
            this.diagnostics.log({
                category: DIAGNOSTIC_CATEGORY.LIFECYCLE,
                count: 1,
            }, this.state);
        } catch {
            this.activation.clear();
            await this.reconcile(
                loaded.snapshot.globalEnabled
                    ? ACTIVATION_POLICY.ENABLED
                    : ACTIVATION_POLICY.DISABLED,
                loaded.snapshot.revision,
                loaded.snapshot.sitePreferences,
            );
            this.lifecycleReasons.clear();
            this.phaseValue = APPLICATION_PHASE.READY;
            this.diagnostics.log(
                {
                    category: DIAGNOSTIC_CATEGORY.ERROR,
                    reason: DIAGNOSTIC_REASON.PROCESSING_FAILED,
                    count: 1,
                },
                this.state,
            );
        }
    }

    /**
     * Retries settings and fail-closed cleanup for an unavailable application.
     */
    private async recover(): Promise<void> {
        const loaded = await this.settings.load();
        if (!loaded.ok || loaded.source === "default") {
            await this.enterFailedClosed(true);
            return;
        }
        this.snapshotValue = loaded.snapshot;
        this.failureValue = undefined;
        if (loaded.snapshot.debugEnabled) {
            await this.diagnostics.setEnabled(true);
        }
        await this.reconcile(
            loaded.snapshot.globalEnabled ? "enabled" : "disabled",
            loaded.snapshot.revision,
            loaded.snapshot.sitePreferences,
        );
        this.phaseValue = APPLICATION_PHASE.READY;
        await this.projection.seed(this.state);
    }
}
