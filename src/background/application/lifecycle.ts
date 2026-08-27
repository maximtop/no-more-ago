/**
 * @file Background initialization, serialization, and lifecycle reconciliation.
 */

import type {
    ActivationMode,
    ActivationPolicy,
    ActivationReconcileResult,
} from "../runtime/adapter-activation";
import type { SettingsService } from "../settings/service";
import type { SettingsSnapshotV5 } from "../../shared/settings/snapshot";
import type { ActivationManager } from "./activation-manager";
import type {
    ApplicationFailure,
    ApplicationPhase,
    LifecycleReason,
} from "./contracts";
import type { ApplicationStateView } from "./state";
import type { DiagnosticsService } from "../diagnostics/service";
import type { StateProjection } from "../projection/state-projection";

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
    private phaseValue: ApplicationPhase = "cold";

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
        this.phaseValue = "ready";
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
        const cleanup = await this.reconcile("failed-closed", "unknown", null, {});
        if (inspectCleanup && cleanup.failures.length > 0) {
            this.failureValue = "fail-closed-cleanup";
        }
        this.phaseValue = "failed-closed";
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
     * Reports whether an adapter has a retained runtime failure.
     *
     * @param adapterId - Adapter identifier to inspect.
     * @returns - Whether the latest reconciliation records its failure.
     */
    public hasAdapterFailure(adapterId: string): boolean {
        return this.activation.hasFailure(adapterId);
    }

    /**
     * Reconciles adapters and updates cached popup state.
     *
     * @param mode - Runtime reconciliation mode.
     * @param policy - Effective global policy.
     * @param revision - Associated settings revision.
     * @param sitePreferences - Canonical-host activation overrides.
     * @param affectedHostnames - Optional hostnames limiting reconciliation.
     * @returns - Reconciliation result.
     */
    public async reconcile(
        mode: ActivationMode,
        policy: ActivationPolicy,
        revision: number | null,
        sitePreferences: Readonly<Record<string, boolean>> =
            this.snapshotValue?.sitePreferences ?? {},
        affectedHostnames?: readonly string[],
    ): Promise<ActivationReconcileResult> {
        const result = await this.activation.reconcile(
            mode,
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
    public ensureReady(reason: LifecycleReason = "cold-worker"): Promise<void> {
        if (reason !== "cold-worker") {
            this.lifecycleReasons.add(reason);
        }
        if (this.phaseValue === "ready") {
            return this.drainLifecycle();
        }
        if (this.phaseValue === "failed-closed" && this.readinessFlight === undefined) {
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
                if (this.phaseValue !== "ready" || !snapshot) {
                    return;
                }
                await this.reconcile(
                    "activation-sweep",
                    snapshot.globalEnabled ? "enabled" : "disabled",
                    snapshot.revision,
                    snapshot.sitePreferences,
                );
                this.lifecycleReasons.clear();
                this.diagnostics.log({ category: "lifecycle", count: 1 }, this.state);
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
    public requestLifecycle(reason: Exclude<LifecycleReason, "cold-worker">): Promise<void> {
        this.lifecycleReasons.add(reason);
        return this.ensureReady(reason);
    }

    /**
     * Loads settings and reconciles adapters for a cold application.
     */
    private async initialize(): Promise<void> {
        this.phaseValue = "initializing";
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
        const mode: ActivationMode = this.lifecycleReasons.size > 0
            ? "activation-sweep"
            : "cold-worker";
        try {
            await this.reconcile(
                mode,
                loaded.snapshot.globalEnabled ? "enabled" : "disabled",
                loaded.snapshot.revision,
                loaded.snapshot.sitePreferences,
            );
            this.lifecycleReasons.clear();
            this.phaseValue = "ready";
            await this.projection.seed(this.state);
            this.diagnostics.log({ category: "lifecycle", count: 1 }, this.state);
        } catch {
            this.activation.clear();
            await this.reconcile(
                mode,
                loaded.snapshot.globalEnabled ? "enabled" : "disabled",
                loaded.snapshot.revision,
                loaded.snapshot.sitePreferences,
            );
            this.lifecycleReasons.clear();
            this.phaseValue = "ready";
            this.diagnostics.log(
                { category: "error", reason: "processing-failed", count: 1 },
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
            "activation-sweep",
            loaded.snapshot.globalEnabled ? "enabled" : "disabled",
            loaded.snapshot.revision,
            loaded.snapshot.sitePreferences,
        );
        this.phaseValue = "ready";
        await this.projection.seed(this.state);
    }
}
