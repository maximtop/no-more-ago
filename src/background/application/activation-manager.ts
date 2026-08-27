/**
 * @file Runtime adapter reconciliation state and scoped-result merging.
 */

import type {
    ActivationMode,
    ActivationPolicy,
    ActivationReconcileResult,
    RegistrationOutcome,
    RuntimeAdapterDefinition,
} from "../runtime/adapter-activation";
import type { ActivationCoordinator } from "./contracts";

/**
 * Owns runtime reconciliation and the latest authoritative result.
 */
export class ActivationManager {
    /**
     * Runtime reconciliation boundary.
     */
    private readonly coordinator: ActivationCoordinator;

    /**
     * Immutable adapter catalog used to scope and merge results.
     */
    private readonly adapters: readonly RuntimeAdapterDefinition[];

    /**
     * Most recent non-stale reconciliation result.
     */
    private lastResult: ActivationReconcileResult | undefined;

    /**
     * Creates a reconciliation manager.
     *
     * @param coordinator - Runtime registration and tab reconciler.
     * @param adapters - Runtime adapter catalog.
     */
    public constructor(
        coordinator: ActivationCoordinator,
        adapters: readonly RuntimeAdapterDefinition[],
    ) {
        this.coordinator = coordinator;
        this.adapters = adapters;
    }

    /**
     * Most recent adapter reconciliation result.
     *
     * @returns - Latest result, when reconciliation has completed.
     */
    public get result(): ActivationReconcileResult | undefined {
        return this.lastResult;
    }

    /**
     * Reconciles runtime adapters and retains the newest non-stale result.
     *
     * @param mode - Activation reconciliation mode.
     * @param policy - Effective global settings policy.
     * @param revision - Settings revision associated with the request.
     * @param sitePreferences - Canonical-host activation overrides.
     * @param affectedHostnames - Optional hostnames to limit document updates.
     * @returns - Latest non-stale activation reconciliation result.
     */
    public async reconcile(
        mode: ActivationMode,
        policy: ActivationPolicy,
        revision: number | null,
        sitePreferences: Readonly<Record<string, boolean>>,
        affectedHostnames?: readonly string[],
    ): Promise<ActivationReconcileResult> {
        let result = await this.run(
            mode,
            policy,
            revision,
            sitePreferences,
            affectedHostnames,
        );
        if (affectedHostnames !== undefined && this.lastResult) {
            result = this.mergeScopedResult(result, affectedHostnames);
        }
        if (
            !this.lastResult
            || result.revision === null
            || this.lastResult.revision === null
            || result.revision >= this.lastResult.revision
        ) {
            this.lastResult = result;
        }
        return result;
    }

    /**
     * Updates the cached reconciliation revision after a no-op settings write.
     *
     * @param revision - New settings revision for the cached result.
     */
    public advanceRevision(revision: number): void {
        if (this.lastResult) {
            this.lastResult = { ...this.lastResult, revision };
        }
    }

    /**
     * Clears the retained result before a complete runtime rebuild.
     */
    public clear(): void {
        this.lastResult = undefined;
    }

    /**
     * Reports whether the retained result contains a failure for an adapter.
     *
     * @param adapterId - Adapter identifier to inspect.
     * @returns - Whether the latest reconciliation records its failure.
     */
    public hasFailure(adapterId: string): boolean {
        return (this.lastResult?.failures ?? []).some(
            (failure) => failure.adapterId === adapterId,
        );
    }

    /**
     * Runs the coordinator and converts thrown failures into adapter-scoped failures.
     *
     * @param mode - Activation reconciliation mode.
     * @param policy - Effective global policy.
     * @param revision - Settings revision for the reconciliation.
     * @param sitePreferences - Effective per-host preferences.
     * @param affectedHostnames - Optional hostnames limiting the operation.
     * @returns - Coordinator result or a contained failure result.
     */
    private async run(
        mode: ActivationMode,
        policy: ActivationPolicy,
        revision: number | null,
        sitePreferences: Readonly<Record<string, boolean>>,
        affectedHostnames?: readonly string[],
    ): Promise<ActivationReconcileResult> {
        try {
            return await this.coordinator.reconcile({
                revision,
                mode,
                policy,
                sitePreferences,
                ...(affectedHostnames === undefined ? {} : { affectedHostnames }),
            });
        } catch {
            return {
                revision,
                mode,
                policy,
                failures: this.adapters
                    .filter(
                        (adapter) =>
                            affectedHostnames === undefined
                            || affectedHostnames.includes(adapter.hostname),
                    )
                    .map((adapter) => ({
                        scope: "registration" as const,
                        adapterId: adapter.id,
                        operation: "get" as const,
                    })),
                registration: {},
                tabs: [],
            };
        }
    }

    /**
     * Replaces only affected adapters in an existing authoritative result.
     *
     * @param result - Scoped coordinator result.
     * @param affectedHostnames - Hostnames included in the scoped operation.
     * @returns - Result merged with retained state for unrelated adapters.
     */
    private mergeScopedResult(
        result: ActivationReconcileResult,
        affectedHostnames: readonly string[],
    ): ActivationReconcileResult {
        const previous = this.lastResult;
        if (!previous) {
            return result;
        }
        const affectedIds = new Set(
            this.adapters
                .filter((adapter) => affectedHostnames.includes(adapter.hostname))
                .map((adapter) => adapter.id),
        );
        const failures = [
            ...previous.failures.filter((failure) => !affectedIds.has(failure.adapterId)),
            ...result.failures,
        ];
        const registration: Record<string, RegistrationOutcome> = {};
        for (const [id, value] of Object.entries(previous.registration)) {
            if (!affectedIds.has(id)) {
                registration[id] = value;
            }
        }
        for (const [id, value] of Object.entries(result.registration)) {
            registration[id] = value;
        }
        const tabs = [
            ...previous.tabs.filter((record) => !affectedIds.has(record.adapterId)),
            ...result.tabs,
        ];
        return { ...result, failures, registration, tabs };
    }
}
