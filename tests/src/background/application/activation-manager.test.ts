/**
 * @file Verifies scoped activation reconciliation preserves unrelated tab outcomes.
 */

import { describe, expect, it, vi } from "vitest";
import { ActivationManager } from "../../../../src/background/application/activation-manager";
import type { ActivationCoordinator } from "../../../../src/background/application/contracts";
import type {
    ActivationReconcileResult,
} from "../../../../src/background/runtime/document-activation";
import {
    ACTIVATION_POLICY,
    RECONCILE_FAILURE_SCOPE,
    REGISTRATION_OUTCOME,
    TAB_ACTION,
} from "../../../../src/background/runtime/document-activation";

describe("ActivationManager", () => {
    it("preserves an unrelated tab failure until that tab succeeds", async () => {
        const results: readonly ActivationReconcileResult[] = [
            {
                revision: 1,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [{
                    scope: RECONCILE_FAILURE_SCOPE.TAB,
                    tabId: 2,
                    hostname: "b.test",
                    action: TAB_ACTION.INJECT,
                }],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                tabs: [{
                    tabId: 2,
                    hostname: "b.test",
                    action: TAB_ACTION.INJECT,
                    ok: false,
                }],
            },
            {
                revision: 2,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                tabs: [{
                    tabId: 1,
                    hostname: "a.test",
                    action: TAB_ACTION.INJECT,
                    ok: true,
                }],
            },
            {
                revision: 3,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                tabs: [{
                    tabId: 2,
                    hostname: "b.test",
                    action: TAB_ACTION.INJECT,
                    ok: true,
                }],
            },
        ];
        let nextResult = 0;
        const coordinator: ActivationCoordinator = {
            reconcile: vi.fn(() => {
                const result = results[nextResult];
                nextResult += 1;
                if (!result) {
                    return Promise.reject(new Error("Unexpected reconciliation"));
                }
                return Promise.resolve(result);
            }),
        };
        const manager = new ActivationManager(coordinator);

        await manager.reconcile(
            ACTIVATION_POLICY.ENABLED,
            1,
            {},
        );
        await manager.reconcile(
            ACTIVATION_POLICY.ENABLED,
            2,
            {},
            ["a.test"],
        );

        expect(manager.result?.failures).toContainEqual({
            scope: RECONCILE_FAILURE_SCOPE.TAB,
            tabId: 2,
            hostname: "b.test",
            action: TAB_ACTION.INJECT,
        });

        await manager.reconcile(
            ACTIVATION_POLICY.ENABLED,
            3,
            {},
            ["b.test"],
        );

        expect(manager.result?.failures).toEqual([]);
    });

    it("drops a scoped failure when its tab is no longer returned", async () => {
        const results: readonly ActivationReconcileResult[] = [
            {
                revision: 1,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [{
                    scope: RECONCILE_FAILURE_SCOPE.TAB,
                    tabId: 2,
                    hostname: "b.test",
                    action: TAB_ACTION.INJECT,
                }],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                tabs: [{
                    tabId: 2,
                    hostname: "b.test",
                    action: TAB_ACTION.INJECT,
                    ok: false,
                }],
            },
            {
                revision: 2,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                tabs: [],
            },
        ];
        let nextResult = 0;
        const coordinator: ActivationCoordinator = {
            reconcile: vi.fn(() => {
                const result = results[nextResult];
                nextResult += 1;
                return result
                    ? Promise.resolve(result)
                    : Promise.reject(new Error("Unexpected reconciliation"));
            }),
        };
        const manager = new ActivationManager(coordinator);

        await manager.reconcile(ACTIVATION_POLICY.ENABLED, 1, {});
        await manager.reconcile(
            ACTIVATION_POLICY.ENABLED,
            2,
            {},
            ["b.test"],
        );

        expect(manager.result?.failures).toEqual([]);
        expect(manager.result?.tabs).toEqual([]);
    });
});
