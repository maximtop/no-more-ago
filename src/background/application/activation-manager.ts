/**
 * @file Caches universal document-runtime reconciliation within serialized application work.
 */
import {
    RECONCILE_FAILURE_SCOPE,
    REGISTRATION_OPERATION,
    REGISTRATION_OUTCOME,
} from '../runtime/document-activation';

import type { ActivationCoordinator } from './contracts';
import type { SiteScopePolicy } from '../../shared/settings/site-scope';
import type {
    ActivationPolicy,
    ActivationReconcileResult,
} from '../runtime/document-activation';

/**
 * Merges a host-scoped reconciliation into the cached complete result.
 *
 * @param previous - Previously cached reconciliation result.
 * @param current - Newly completed reconciliation result.
 * @param affectedHostnames - Hostnames replaced by the scoped reconciliation.
 *
 * @returns - Result containing current data and untouched tab data.
 */
function mergeScopedResult(
    previous: ActivationReconcileResult,
    current: ActivationReconcileResult,
    affectedHostnames: readonly string[],
): ActivationReconcileResult {
    const affected = new Set(affectedHostnames);
    const preservedFailures = previous.failures.filter((failure) => failure.scope === RECONCILE_FAILURE_SCOPE.TAB
        && !affected.has(failure.hostname));
    const preservedTabs = previous.tabs.filter(({ hostname }) => !affected.has(hostname));
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
     *
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
     * @param policy - Global activation policy.
     * @param revision - Settings revision associated with the operation.
     * @param siteScope - Effective scope mode and hostname lists.
     * @param affectedHostnames - Optional subset of hosts to reconcile.
     *
     * @returns - The completed reconciliation result.
     */
    public async reconcile(
        policy: ActivationPolicy,
        revision: number | null,
        siteScope: SiteScopePolicy,
        affectedHostnames?: readonly string[],
    ): Promise<ActivationReconcileResult> {
        let result: ActivationReconcileResult;
        try {
            result = await this.coordinator.reconcile({
                revision,
                policy,
                siteScope,
                ...(affectedHostnames === undefined ? {} : { affectedHostnames }),
            });
        } catch {
            result = {
                revision,
                policy,
                failures: [{
                    scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
                    operation: REGISTRATION_OPERATION.GET,
                }],
                registration: REGISTRATION_OUTCOME.FAILED,
                registrations: [],
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
                : mergeScopedResult(this.lastResult, result, affectedHostnames);
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
