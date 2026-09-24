/**
 * @file Verifies scoped activation reconciliation preserves unrelated tab outcomes.
 */

import {
    describe, expect, it, vi,
} from 'vitest';

import { ActivationManager } from '../../../../src/background/application/activation-manager';
import {
    ACTIVATION_POLICY,
    RECONCILE_FAILURE_SCOPE,
    REGISTRATION_OUTCOME,
    TAB_ACTION,
} from '../../../../src/background/runtime/document-activation';
import { DEFAULT_SITE_SCOPE } from '../../../../src/shared/settings/site-scope';

import type { ActivationCoordinator } from '../../../../src/background/application/contracts';
import type {
    ActivationReconcileResult,
} from '../../../../src/background/runtime/document-activation';

describe('ActivationManager', () => {
    it('preserves an unrelated tab failure until that tab succeeds', async () => {
        const results: readonly ActivationReconcileResult[] = [
            {
                revision: 1,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [{
                    scope: RECONCILE_FAILURE_SCOPE.TAB,
                    tabId: 2,
                    hostname: 'b.test',
                    action: TAB_ACTION.INJECT,
                }],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                registrations: [],
                tabs: [{
                    tabId: 2,
                    hostname: 'b.test',
                    action: TAB_ACTION.INJECT,
                    ok: false,
                }],
            },
            {
                revision: 2,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                registrations: [],
                tabs: [{
                    tabId: 1,
                    hostname: 'a.test',
                    action: TAB_ACTION.INJECT,
                    ok: true,
                }],
            },
            {
                revision: 3,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                registrations: [],
                tabs: [{
                    tabId: 2,
                    hostname: 'b.test',
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
                    return Promise.reject(new Error('Unexpected reconciliation'));
                }
                return Promise.resolve(result);
            }),
        };
        const manager = new ActivationManager(coordinator);

        await manager.reconcile(
            ACTIVATION_POLICY.ENABLED,
            1,
            DEFAULT_SITE_SCOPE,
        );
        await manager.reconcile(
            ACTIVATION_POLICY.ENABLED,
            2,
            DEFAULT_SITE_SCOPE,
            ['a.test'],
        );

        expect(manager.result?.failures).toContainEqual({
            scope: RECONCILE_FAILURE_SCOPE.TAB,
            tabId: 2,
            hostname: 'b.test',
            action: TAB_ACTION.INJECT,
        });

        await manager.reconcile(
            ACTIVATION_POLICY.ENABLED,
            3,
            DEFAULT_SITE_SCOPE,
            ['b.test'],
        );

        expect(manager.result?.failures).toEqual([]);
    });

    it('drops a scoped failure when its tab is no longer returned', async () => {
        const results: readonly ActivationReconcileResult[] = [
            {
                revision: 1,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [{
                    scope: RECONCILE_FAILURE_SCOPE.TAB,
                    tabId: 2,
                    hostname: 'b.test',
                    action: TAB_ACTION.INJECT,
                }],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                registrations: [],
                tabs: [{
                    tabId: 2,
                    hostname: 'b.test',
                    action: TAB_ACTION.INJECT,
                    ok: false,
                }],
            },
            {
                revision: 2,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                registrations: [],
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
                    : Promise.reject(new Error('Unexpected reconciliation'));
            }),
        };
        const manager = new ActivationManager(coordinator);

        await manager.reconcile(ACTIVATION_POLICY.ENABLED, 1, DEFAULT_SITE_SCOPE);
        await manager.reconcile(
            ACTIVATION_POLICY.ENABLED,
            2,
            DEFAULT_SITE_SCOPE,
            ['b.test'],
        );

        expect(manager.result?.failures).toEqual([]);
        expect(manager.result?.tabs).toEqual([]);
    });
});
