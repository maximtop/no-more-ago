/**
 * @file Verifies popup projection matches tab failures to the current hostname.
 */

import {
    describe, expect, it, vi,
} from 'vitest';

import { ActivationManager } from '../../../../src/background/application/activation-manager';
import { APPLICATION_PHASE } from '../../../../src/background/application/contracts';
import { StateProjection } from '../../../../src/background/projection/state-projection';
import {
    ACTIVATION_POLICY,
    RECONCILE_FAILURE_SCOPE,
    REGISTRATION_OPERATION,
    REGISTRATION_OUTCOME,
    TAB_ACTION,
} from '../../../../src/background/runtime/document-activation';
import { FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID } from
    '../../../../src/background/runtime/register-documents';
import {
    DOCUMENT_PHASE,
    DOCUMENT_STATUS_MESSAGE,
} from '../../../../src/shared/messaging/document-messages';
import {
    POPUP_RUNTIME_FAILURE,
    POPUP_STATUS,
    STATE_AVAILABILITY,
} from '../../../../src/shared/messaging/view-state-values';
import {
    DEFAULT_SITE_SCOPE,
    SITE_SCOPE_MODE,
} from '../../../../src/shared/settings/site-scope';
import {
    APPEARANCE,
    DEFAULT_SETTINGS_SNAPSHOT,
    createSettingsSnapshot,
} from '../../../../src/shared/settings/snapshot';

import type { ActivationCoordinator } from '../../../../src/background/application/contracts';
import type { ApplicationStateView } from '../../../../src/background/application/state';
import type {
    ActivationReconcileResult,
} from '../../../../src/background/runtime/document-activation';
import type { TabsRuntime } from '../../../../src/background/runtime/tabs';

describe('StateProjection', () => {
    it('scopes Facebook bridge registration failures to Facebook tabs', async () => {
        const result: ActivationReconcileResult = {
            revision: 1,
            policy: ACTIVATION_POLICY.ENABLED,
            failures: [{
                scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
                operation: REGISTRATION_OPERATION.REGISTER,
                registrationId: FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID,
            }],
            registration: REGISTRATION_OUTCOME.FAILED,
            registrations: [],
            tabs: [],
        };
        const activation = new ActivationManager({
            reconcile: vi.fn(() => Promise.resolve(result)),
        });
        await activation.reconcile(ACTIVATION_POLICY.ENABLED, 1, DEFAULT_SITE_SCOPE);
        let tabUrl = 'https://example.test/page';
        const tabs: TabsRuntime = {
            query: vi.fn(() => Promise.resolve([{ id: 1, url: tabUrl }])),
            getAllFrames: vi.fn(() => Promise.resolve([])),
            sendMessage: vi.fn(() => Promise.resolve({
                type: DOCUMENT_STATUS_MESSAGE,
                phase: DOCUMENT_PHASE.ACTIVE,
            })),
        };
        const projection = new StateProjection(tabs, activation);
        const state: ApplicationStateView = {
            phase: APPLICATION_PHASE.READY,
            snapshot: DEFAULT_SETTINGS_SNAPSHOT,
            failure: undefined,
        };

        const unrelated = await projection.derivePopup(state);
        tabUrl = 'https://www.facebook.com/home';
        const facebook = await projection.derivePopup(state);

        expect(unrelated).toMatchObject({ status: POPUP_STATUS.ACTIVE });
        expect(facebook).toMatchObject({
            status: POPUP_STATUS.RUNTIME_FAILED,
            failure: POPUP_RUNTIME_FAILURE.REGISTRATION,
        });
    });

    it('does not apply a stale failure after a tab navigates', async () => {
        const result: ActivationReconcileResult = {
            revision: 1,
            policy: ACTIVATION_POLICY.ENABLED,
            failures: [{
                scope: RECONCILE_FAILURE_SCOPE.TAB,
                tabId: 1,
                hostname: 'a.test',
                action: TAB_ACTION.INJECT,
            }],
            registration: REGISTRATION_OUTCOME.UNCHANGED,
            registrations: [],
            tabs: [{
                tabId: 1,
                hostname: 'a.test',
                action: TAB_ACTION.INJECT,
                ok: false,
            }],
        };
        const coordinator: ActivationCoordinator = {
            reconcile: vi.fn(() => Promise.resolve(result)),
        };
        const activation = new ActivationManager(coordinator);
        await activation.reconcile(ACTIVATION_POLICY.ENABLED, 1, DEFAULT_SITE_SCOPE);

        let tabUrl = 'https://a.test/page';
        const tabs: TabsRuntime = {
            query: vi.fn(() => Promise.resolve([{ id: 1, url: tabUrl }])),
            getAllFrames: vi.fn(() => Promise.resolve([])),
            sendMessage: vi.fn(() => Promise.resolve({
                type: DOCUMENT_STATUS_MESSAGE,
                phase: DOCUMENT_PHASE.ACTIVE,
            })),
        };
        const projection = new StateProjection(tabs, activation);
        const state: ApplicationStateView = {
            phase: APPLICATION_PHASE.READY,
            snapshot: DEFAULT_SETTINGS_SNAPSHOT,
            failure: undefined,
        };

        const failed = await projection.derivePopup(state);
        tabUrl = 'https://b.test/page';
        const navigated = await projection.derivePopup(state);

        expect(failed).toMatchObject({
            availability: STATE_AVAILABILITY.READY,
            status: POPUP_STATUS.RUNTIME_FAILED,
        });
        expect(navigated).toMatchObject({
            availability: STATE_AVAILABILITY.READY,
            hostname: 'b.test',
            status: POPUP_STATUS.ACTIVE,
        });
    });

    it.each([
        {
            pending: 'active tab query',
            expectedFailure: POPUP_RUNTIME_FAILURE.CURRENT_TAB_QUERY,
        },
        {
            pending: 'document status',
            expectedFailure: POPUP_RUNTIME_FAILURE.DOCUMENT_STATUS,
        },
    ] as const)('bounds a pending $pending while seeding popup state', async (testCase) => {
        vi.useFakeTimers();
        try {
            const result: ActivationReconcileResult = {
                revision: 1,
                policy: ACTIVATION_POLICY.ENABLED,
                failures: [],
                registration: REGISTRATION_OUTCOME.UNCHANGED,
                registrations: [],
                tabs: [],
            };
            const activation = new ActivationManager({
                reconcile: vi.fn(() => Promise.resolve(result)),
            });
            const pending = new Promise<never>(() => undefined);
            const tabs: TabsRuntime = {
                query: vi.fn(() => (testCase.pending === 'active tab query'
                    ? pending
                    : Promise.resolve([{ id: 1, url: 'https://example.test/page' }]))),
                getAllFrames: vi.fn(() => Promise.resolve([])),
                sendMessage: vi.fn(() => (testCase.pending === 'document status'
                    ? pending
                    : Promise.resolve({
                        type: DOCUMENT_STATUS_MESSAGE,
                        phase: DOCUMENT_PHASE.ACTIVE,
                    }))),
            };
            const projection = new StateProjection(tabs, activation);
            const state: ApplicationStateView = {
                phase: APPLICATION_PHASE.READY,
                snapshot: DEFAULT_SETTINGS_SNAPSHOT,
                failure: undefined,
            };
            const seeding = projection.seed(state);

            await vi.advanceTimersByTimeAsync(1_000);
            await expect(seeding).resolves.toBeUndefined();
            expect(projection.cachedPopup).toMatchObject({
                status: POPUP_STATUS.RUNTIME_FAILED,
                failure: testCase.expectedFailure,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        [SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, ['example.test'], [], POPUP_STATUS.SITE_EXCLUDED],
        [SITE_SCOPE_MODE.SELECTED_ONLY, [], [], POPUP_STATUS.SITE_NOT_SELECTED],
        [SITE_SCOPE_MODE.SELECTED_ONLY, [], ['example.test'], POPUP_STATUS.ACTIVE],
    ])(
        'reports %s coverage for the current hostname',
        async (mode, excludedSites, allowedSites, expected) => {
            const activation = new ActivationManager({
                reconcile: vi.fn(() => Promise.resolve({
                    revision: 1,
                    policy: ACTIVATION_POLICY.ENABLED,
                    failures: [],
                    registration: REGISTRATION_OUTCOME.UNCHANGED,
                    registrations: [],
                    tabs: [],
                })),
            });
            const tabs: TabsRuntime = {
                query: vi.fn(() => Promise.resolve([{ id: 1, url: 'https://example.test/a' }])),
                getAllFrames: vi.fn(() => Promise.resolve([])),
                sendMessage: vi.fn(() => Promise.resolve({
                    type: DOCUMENT_STATUS_MESSAGE,
                    phase: DOCUMENT_PHASE.ACTIVE,
                })),
            };
            const state: ApplicationStateView = {
                phase: APPLICATION_PHASE.READY,
                snapshot: createSettingsSnapshot({
                    revision: 1,
                    globalEnabled: true,
                    siteScope: { mode, excludedSites, allowedSites },
                }),
                failure: undefined,
            };

            const popup = await new StateProjection(tabs, activation).derivePopup(state);

            expect(popup.status).toBe(expected);
            expect(popup.scopeMode).toBe(mode);
            expect(popup.appearance).toBe(APPEARANCE.SYSTEM);
        },
    );

    it('projects both retained hostname lists for the settings page', () => {
        const activation = new ActivationManager({ reconcile: vi.fn() });
        const tabs: TabsRuntime = {
            query: vi.fn(() => Promise.resolve([])),
            getAllFrames: vi.fn(() => Promise.resolve([])),
            sendMessage: vi.fn(() => Promise.resolve(undefined)),
        };
        const sites = new StateProjection(tabs, activation).deriveSites({
            phase: APPLICATION_PHASE.READY,
            snapshot: createSettingsSnapshot({
                revision: 2,
                globalEnabled: true,
                siteScope: {
                    mode: SITE_SCOPE_MODE.SELECTED_ONLY,
                    excludedSites: ['excluded.test'],
                    allowedSites: ['allowed.test'],
                },
            }),
            failure: undefined,
        });

        expect(sites).toEqual({
            availability: STATE_AVAILABILITY.READY,
            revision: 2,
            globalEnabled: true,
            scopeMode: SITE_SCOPE_MODE.SELECTED_ONLY,
            excludedSites: ['excluded.test'],
            allowedSites: ['allowed.test'],
        });
    });
});
