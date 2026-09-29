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
    REGISTRATION_OPERATION,
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
    describe('retained result', () => {
        const resultAt = (revision: number | null, hostname = 'a.test'): ActivationReconcileResult => ({
            revision,
            policy: ACTIVATION_POLICY.ENABLED,
            failures: [],
            registration: REGISTRATION_OUTCOME.UNCHANGED,
            registrations: [],
            tabs: [{
                tabId: 1,
                hostname,
                action: TAB_ACTION.INJECT,
                ok: true,
            }],
        });
        const managerReturning = (...results: ActivationReconcileResult[]) => {
            const queue = [...results];
            const coordinator: ActivationCoordinator = {
                reconcile: vi.fn(() => {
                    const next = queue.shift();
                    return next
                        ? Promise.resolve(next)
                        : Promise.reject(new Error('Unexpected reconciliation'));
                }),
            };
            return { manager: new ActivationManager(coordinator), coordinator };
        };

        it('is undefined before the first reconciliation', () => {
            expect(managerReturning().manager.result).toBeUndefined();
        });

        it('passes the request to the coordinator and omits an unset host scope', async () => {
            const { manager, coordinator } = managerReturning(resultAt(1), resultAt(2));

            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 1, DEFAULT_SITE_SCOPE);
            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 2, DEFAULT_SITE_SCOPE, ['a.test']);

            expect(coordinator.reconcile).toHaveBeenNthCalledWith(1, {
                revision: 1,
                policy: ACTIVATION_POLICY.ENABLED,
                siteScope: DEFAULT_SITE_SCOPE,
            });
            expect(coordinator.reconcile).toHaveBeenNthCalledWith(2, {
                revision: 2,
                policy: ACTIVATION_POLICY.ENABLED,
                siteScope: DEFAULT_SITE_SCOPE,
                affectedHostnames: ['a.test'],
            });
        });

        it('records a registration failure when the coordinator throws', async () => {
            const coordinator: ActivationCoordinator = {
                reconcile: vi.fn(() => Promise.reject(new Error('scripting unavailable'))),
            };
            const manager = new ActivationManager(coordinator);

            const result = await manager.reconcile(ACTIVATION_POLICY.ENABLED, 4, DEFAULT_SITE_SCOPE);

            expect(result).toEqual({
                revision: 4,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [{
                    scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
                    operation: REGISTRATION_OPERATION.GET,
                }],
                registration: REGISTRATION_OUTCOME.FAILED,
                registrations: [],
                tabs: [],
            });
            expect(manager.result).toEqual(result);
        });

        it('returns but does not retain a result older than the retained revision', async () => {
            const newer = resultAt(5, 'new.test');
            const older = resultAt(4, 'old.test');
            const { manager } = managerReturning(newer, older);

            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 5, DEFAULT_SITE_SCOPE);
            const returned = await manager.reconcile(ACTIVATION_POLICY.ENABLED, 4, DEFAULT_SITE_SCOPE);

            expect(returned).toEqual(older);
            expect(manager.result).toEqual(newer);
        });

        it('retains a result with the same revision', async () => {
            const second = resultAt(5, 'second.test');
            const { manager } = managerReturning(resultAt(5, 'first.test'), second);

            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 5, DEFAULT_SITE_SCOPE);
            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 5, DEFAULT_SITE_SCOPE);

            expect(manager.result).toEqual(second);
        });

        it.each([
            ['a null-revision result replaces a revisioned one', 5, null],
            ['a revisioned result replaces a null-revision one', null, 5],
        ])('%s', async (_, first, second) => {
            const latest = resultAt(second, 'latest.test');
            const { manager } = managerReturning(resultAt(first, 'first.test'), latest);

            await manager.reconcile(ACTIVATION_POLICY.ENABLED, first, DEFAULT_SITE_SCOPE);
            await manager.reconcile(ACTIVATION_POLICY.ENABLED, second, DEFAULT_SITE_SCOPE);

            expect(manager.result).toEqual(latest);
        });

        it('retains a scoped result as-is when nothing was cached before', async () => {
            const scoped = resultAt(1, 'a.test');
            const { manager } = managerReturning(scoped);

            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 1, DEFAULT_SITE_SCOPE, ['a.test']);

            expect(manager.result).toEqual(scoped);
        });

        it('keeps the tabs of unaffected hosts when merging a scoped result', async () => {
            const { manager } = managerReturning(resultAt(1, 'a.test'), resultAt(2, 'b.test'));

            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 1, DEFAULT_SITE_SCOPE);
            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 2, DEFAULT_SITE_SCOPE, ['b.test']);

            expect(manager.result?.revision).toBe(2);
            expect(manager.result?.tabs.map(({ hostname }) => hostname)).toEqual(['b.test', 'a.test']);
        });

        it('advanceRevision changes only the cached revision', async () => {
            const first = resultAt(1);
            const { manager } = managerReturning(first);
            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 1, DEFAULT_SITE_SCOPE);

            manager.advanceRevision(3);

            expect(manager.result).toEqual({ ...first, revision: 3 });
        });

        it('advanceRevision does nothing before the first reconciliation', () => {
            const { manager } = managerReturning();

            manager.advanceRevision(3);

            expect(manager.result).toBeUndefined();
        });

        it('advanceRevision makes the next lower-revision result stale', async () => {
            const { manager } = managerReturning(resultAt(1, 'a.test'), resultAt(2, 'b.test'));
            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 1, DEFAULT_SITE_SCOPE);
            manager.advanceRevision(3);

            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 2, DEFAULT_SITE_SCOPE);

            expect(manager.result?.revision).toBe(3);
            expect(manager.result?.tabs[0]?.hostname).toBe('a.test');
        });

        it('clear drops the cached result so an older revision is retained afterwards', async () => {
            const older = resultAt(2, 'older.test');
            const { manager } = managerReturning(resultAt(5, 'newer.test'), older);
            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 5, DEFAULT_SITE_SCOPE);

            manager.clear();
            expect(manager.result).toBeUndefined();
            await manager.reconcile(ACTIVATION_POLICY.ENABLED, 2, DEFAULT_SITE_SCOPE);

            expect(manager.result).toEqual(older);
        });
    });
});
