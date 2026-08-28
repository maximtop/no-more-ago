/**
 * @file Caches universal document-runtime reconciliation within serialized application work.
 */
import type {
    ActivationMode,
    ActivationPolicy,
    ActivationReconcileResult,
} from "../runtime/document-activation";
import {
    RECONCILE_FAILURE_SCOPE,
    REGISTRATION_OPERATION,
    REGISTRATION_OUTCOME,
} from "../runtime/document-activation";
import type { ActivationCoordinator } from "./contracts";

/**
 * Merges a host-scoped reconciliation into the cached complete result.
 *
 * @param previous - Previously cached reconciliation result.
 * @param current - Newly completed reconciliation result.
 * @returns - Result containing current data and untouched tab data.
 */
function mergeScopedResult(
    previous: ActivationReconcileResult,
    current: ActivationReconcileResult,
): ActivationReconcileResult {
    const reconciledTabIds = new Set(current.tabs.map(({ tabId }) => tabId));
    const preservedFailures = previous.failures.filter((failure) =>
        failure.scope === RECONCILE_FAILURE_SCOPE.TAB
        && !reconciledTabIds.has(failure.tabId));
    const preservedTabs = previous.tabs.filter(({ tabId }) => !reconciledTabIds.has(tabId));
    return {
        ...current,
        failures: [...current.failures, ...preservedFailures],
        tabs: [...current.tabs, ...preservedTabs],
    };
}

/**
 * Owns the latest non-stale universal-runtime reconciliation result.
 */
export class ActivationManager {
    /**
     * Last successful or failed reconciliation retained by this manager.
     */
    private lastResult: ActivationReconcileResult | undefined;

    /**
     * Creates a manager over a runtime coordinator.
     *
     * @param coordinator - Runtime coordinator used to perform reconciliation.
     * @returns - A new activation manager.
     */
    public constructor(private readonly coordinator: ActivationCoordinator) {}

    /**
     * Latest reconciliation result, when available.
     *
     * @returns - The newest retained result, if reconciliation has run.
     */
    public get result(): ActivationReconcileResult | undefined {
        return this.lastResult;
    }

    /**
     * Runs reconciliation and retains the newest revisioned result.
     *
     * @param mode - Reconciliation trigger.
     * @param policy - Global activation policy.
     * @param revision - Settings revision associated with the operation.
     * @param sitePreferences - Effective per-host activation preferences.
     * @param affectedHostnames - Optional subset of hosts to reconcile.
     * @returns - The completed reconciliation result.
     */
    public async reconcile(
        mode: ActivationMode,
        policy: ActivationPolicy,
        revision: number | null,
        sitePreferences: Readonly<Record<string, boolean>>,
        affectedHostnames?: readonly string[],
    ): Promise<ActivationReconcileResult> {
        let result: ActivationReconcileResult;
        try {
            result = await this.coordinator.reconcile({
                revision,
                mode,
                policy,
                sitePreferences,
                ...(affectedHostnames === undefined ? {} : { affectedHostnames }),
            });
        } catch {
            result = {
                revision,
                mode,
                policy,
                failures: [{
                    scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
                    operation: REGISTRATION_OPERATION.GET,
                }],
                registration: REGISTRATION_OUTCOME.FAILED,
                tabs: [],
            };
        }
        if (
            !this.lastResult
            || result.revision === null
            || this.lastResult.revision === null
            || result.revision >= this.lastResult.revision
        ) {
            this.lastResult = affectedHostnames === undefined || !this.lastResult
                ? result
                : mergeScopedResult(this.lastResult, result);
        }
        return result;
    }

    /**
     * Advances the cached revision after a no-op settings write.
     *
     * @param revision - New settings revision to cache.
     */
    public advanceRevision(revision: number): void {
        if (this.lastResult) {
            this.lastResult = { ...this.lastResult, revision };
        }
    }

    /**
     * Clears the cached result before a complete runtime rebuild.
     */
    public clear(): void {
        this.lastResult = undefined;
    }
}
