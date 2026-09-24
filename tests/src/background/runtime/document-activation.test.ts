/**
 * @file Verifies universal document-runtime reconciliation.
 */

import {
    describe, expect, it, vi,
} from 'vitest';

import {
    DocumentActivationCoordinator,
    ACTIVATION_POLICY,
    RECONCILE_FAILURE_SCOPE,
    REGISTRATION_OPERATION,
    REGISTRATION_OUTCOME,
    TAB_ACTION,
} from '../../../../src/background/runtime/document-activation';
import {
    DOCUMENT_RUNTIME_REGISTRATION,
    DOCUMENT_RUNTIME_REGISTRATION_ID,
    FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION,
    FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID,
} from '../../../../src/background/runtime/register-documents';
import {
    SCRIPT_EXECUTION_WORLD,
    type RegisteredContentScriptSpec,
    type ScriptingRuntime,
} from '../../../../src/background/runtime/scripting';
import {
    installContentRuntime,
    type ContentRuntimeHandle,
} from '../../../../src/content-script/runtime';
import { FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE } from
    '../../../../src/shared/extension-files';
import {
    DOCUMENT_POLICY_RECONCILED_MESSAGE,
    RECONCILE_DOCUMENT_POLICY_MESSAGE,
} from '../../../../src/shared/messaging/document-messages';
import { STATE_AVAILABILITY } from '../../../../src/shared/messaging/view-state-values';
import { SITE_SCOPE_MODE } from '../../../../src/shared/settings/site-scope';

import type { RuntimeFrame } from '../../../../src/background/runtime/tabs';

/**
 * Creates an independently dispatchable content-runtime message source.
 *
 * @returns - Message source and dispatch function for one document frame.
 */
function frameMessages() {
    let listener: ((message: unknown) => unknown) | undefined;
    return {
        onMessage: {
            addListener: vi.fn((next: (message: unknown) => unknown) => {
                listener = next;
            }),
        },
        dispatch(message: unknown): unknown {
            return listener?.(message);
        },
    };
}

/**
 * Installs a timestamp-processing runtime in an isolated frame document.
 *
 * @param readPolicy - Reads the current top-level site policy and revision.
 *
 * @returns - Frame document, message source, and runtime handle.
 */
function installedFrame(readPolicy: () => {
    readonly enabled: boolean;
    readonly revision: number;
}): {
    readonly document: Document;
    readonly element: HTMLIFrameElement;
    readonly messages: ReturnType<typeof frameMessages>;
    readonly handle: ContentRuntimeHandle;
} {
    const element = document.createElement('iframe');
    document.body.append(element);
    const frameDocument = element.contentDocument;
    if (!frameDocument) {
        throw new Error('Expected frame document');
    }
    frameDocument.body.innerHTML = '<time datetime="2026-08-23T10:15:00Z">2 hours ago</time>';
    const messages = frameMessages();
    const handle = installContentRuntime({
        document: frameDocument,
        url: new URL('https://example.test/page'),
        locales: ['en-US'],
        loadDocumentState: async () => {
            const policy = readPolicy();
            return {
                availability: STATE_AVAILABILITY.READY,
                revision: policy.revision,
                enabled: policy.enabled,
                display: { formatMode: 'system' as const, timeZone: { mode: 'utc' as const } },
                debugEnabled: false,
            };
        },
        messages,
    });
    return {
        document: frameDocument, element, messages, handle,
    };
}

/**
 * Checks whether a frame currently contains generated timestamp output.
 *
 * @param frame - Installed frame under inspection.
 *
 * @returns - Whether the frame has generated output.
 */
function hasOutput(frame: ReturnType<typeof installedFrame>): boolean {
    return frame.document.querySelector('[data-no-more-ago-output]') !== null;
}

/**
 * Acknowledges the revision carried by one document-policy command.
 *
 * @param message - Policy command delivered to a content runtime.
 *
 * @returns - Exact policy acknowledgement.
 */
function acknowledgePolicy(message: unknown) {
    const revision = (message as { readonly revision?: number | null }).revision ?? null;
    return { type: DOCUMENT_POLICY_RECONCILED_MESSAGE, revision };
}

/**
 * Creates browser API doubles for the requested tab URLs.
 *
 * @param urls - Top-level tab URLs returned by the query.
 * @param framesByTab - Reachable frames returned for each one-based fixture tab.
 *
 * @returns - Scripting and tabs doubles.
 */
function fakes(
    urls: readonly string[],
    framesByTab: readonly (readonly RuntimeFrame[])[] = urls.map((url) => [
        { frameId: 0, url },
        { frameId: 1 },
    ]),
) {
    const registered = new Map<string, RegisteredContentScriptSpec>([
        [DOCUMENT_RUNTIME_REGISTRATION_ID, { ...DOCUMENT_RUNTIME_REGISTRATION }],
        [
            FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID,
            { ...FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION },
        ],
    ]);
    const scripting = {
        getRegisteredContentScripts: vi.fn(async () => [...registered.values()]),
        registerContentScripts: vi.fn(async (scripts: RegisteredContentScriptSpec[]) => {
            for (const script of scripts) {
                registered.set(script.id, script);
            }
        }),
        updateContentScripts: vi.fn(async (scripts: RegisteredContentScriptSpec[]) => {
            for (const script of scripts) {
                registered.set(script.id, script);
            }
        }),
        unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => {
            for (const id of ids) {
                registered.delete(id);
            }
        }),
        executeScript: vi.fn(async (
            input: Parameters<ScriptingRuntime['executeScript']>[0],
        ) => ('frameIds' in input.target
            ? input.target.frameIds.map((frameId) => ({ frameId }))
            : [{ frameId: 0 }, { frameId: 1 }])),
    };
    const tabs = {
        query: vi.fn(async () => urls.map((url, index) => ({ id: index + 1, url }))),
        getAllFrames: vi.fn(async (tabId: number) => framesByTab[tabId - 1] ?? []),
        sendMessage: vi.fn(async (
            ...args: [number, unknown, { readonly frameId: number }?]
        ) => {
            return acknowledgePolicy(args[1]);
        }),
    };
    return { scripting, tabs, registered };
}

describe('DocumentActivationCoordinator', () => {
    it('registers universally and targets every frame before all-frame ensure', async () => {
        const fake = fakes(['https://example.test/page']);
        fake.scripting.getRegisteredContentScripts.mockResolvedValue([]);
        const coordinator = new DocumentActivationCoordinator(fake);
        const result = await coordinator.reconcile({
            revision: 1,
            policy: ACTIVATION_POLICY.ENABLED,
        });

        expect(result.registration).toBe(REGISTRATION_OUTCOME.REGISTERED);
        expect(result.registrations).toEqual([
            {
                id: DOCUMENT_RUNTIME_REGISTRATION_ID,
                outcome: REGISTRATION_OUTCOME.REGISTERED,
            },
            {
                id: FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID,
                outcome: REGISTRATION_OUTCOME.REGISTERED,
            },
        ]);
        expect(fake.scripting.registerContentScripts).toHaveBeenNthCalledWith(
            1,
            [DOCUMENT_RUNTIME_REGISTRATION],
        );
        expect(fake.scripting.registerContentScripts).toHaveBeenNthCalledWith(
            2,
            [FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION],
        );
        expect(fake.tabs.sendMessage).toHaveBeenCalledWith(
            1,
            {
                type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
                revision: 1,
                enabled: true,
            },
            { frameId: 0 },
        );
        expect(fake.tabs.sendMessage).toHaveBeenCalledWith(
            1,
            {
                type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
                revision: 1,
                enabled: true,
            },
            { frameId: 1 },
        );
        expect(fake.scripting.executeScript).toHaveBeenCalledWith({
            target: { tabId: 1, allFrames: true },
            files: ['content.js'],
        });
    });

    it(
        'keeps the core runtime registered when the Facebook bridge registration fails',
        async () => {
            const fake = fakes([]);
            fake.registered.clear();
            fake.scripting.registerContentScripts.mockImplementation(async (scripts) => {
                const registration = scripts[0];
                if (!registration) {
                    throw new Error('Expected one registration');
                }
                if (registration.id === FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID) {
                    throw new Error('MAIN-world registration is unavailable');
                }
                fake.registered.set(registration.id, registration);
            });
            const coordinator = new DocumentActivationCoordinator(fake);

            const result = await coordinator.reconcile({
                revision: 1,
                policy: ACTIVATION_POLICY.ENABLED,
            });

            expect(result.registration).toBe(REGISTRATION_OUTCOME.FAILED);
            expect(result.registrations).toEqual([
                {
                    id: DOCUMENT_RUNTIME_REGISTRATION_ID,
                    outcome: REGISTRATION_OUTCOME.REGISTERED,
                },
                {
                    id: FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID,
                    outcome: REGISTRATION_OUTCOME.FAILED,
                },
            ]);
            expect(fake.registered.has(DOCUMENT_RUNTIME_REGISTRATION_ID)).toBe(true);
            expect(result.failures).toContainEqual({
                scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
                operation: REGISTRATION_OPERATION.REGISTER,
                registrationId: FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID,
            });
        },
    );

    it('ensures the Facebook main-world bridge only for an enabled Facebook site', async () => {
        const fake = fakes(['https://www.facebook.com/Meta']);
        const coordinator = new DocumentActivationCoordinator(fake);

        const result = await coordinator.reconcile({
            revision: 2,
            policy: ACTIVATION_POLICY.ENABLED,
        });

        expect(result.tabs).toEqual([{
            tabId: 1,
            hostname: 'www.facebook.com',
            action: TAB_ACTION.INJECT,
            ok: true,
        }]);
        expect(fake.scripting.executeScript).toHaveBeenNthCalledWith(1, {
            target: { tabId: 1, allFrames: true },
            files: ['content.js'],
        });
        expect(fake.scripting.executeScript).toHaveBeenNthCalledWith(2, {
            target: { tabId: 1, frameIds: [0] },
            files: [FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE],
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        });
    });

    it('injects the bridge into Facebook child frames of another top-level site', async () => {
        const fake = fakes([
            'https://example.test/page',
        ], [[
            { frameId: 0, url: 'https://example.test/page' },
            { frameId: 2, url: 'https://www.facebook.com/plugins/post.php' },
            { frameId: 3, url: 'https://other.test/frame' },
        ]]);
        const coordinator = new DocumentActivationCoordinator(fake);

        const result = await coordinator.reconcile({
            revision: 2,
            policy: ACTIVATION_POLICY.ENABLED,
        });

        expect(result.tabs).toEqual([{
            tabId: 1,
            hostname: 'example.test',
            action: TAB_ACTION.INJECT,
            ok: true,
        }]);
        expect(fake.scripting.executeScript).toHaveBeenNthCalledWith(2, {
            target: { tabId: 1, frameIds: [2] },
            files: [FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE],
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        });
    });

    it('injects one bridge call into every reachable Facebook frame', async () => {
        const fake = fakes([
            'https://www.facebook.com/home',
        ], [[
            { frameId: 0, url: 'https://www.facebook.com/home' },
            { frameId: 2, url: 'https://m.facebook.com/story' },
            { frameId: 4, url: 'https://example.test/frame' },
        ]]);
        const coordinator = new DocumentActivationCoordinator(fake);

        await coordinator.reconcile({
            revision: 2,
            policy: ACTIVATION_POLICY.ENABLED,
        });

        expect(fake.scripting.executeScript).toHaveBeenNthCalledWith(2, {
            target: { tabId: 1, frameIds: [0, 2] },
            files: [FACEBOOK_PAYLOAD_BRIDGE_SCRIPT_FILE],
            world: SCRIPT_EXECUTION_WORLD.MAIN,
        });
    });

    it('does not inject a bridge when no reachable frame is Facebook', async () => {
        const fake = fakes(['https://example.test/page']);
        const coordinator = new DocumentActivationCoordinator(fake);

        await coordinator.reconcile({
            revision: 2,
            policy: ACTIVATION_POLICY.ENABLED,
        });

        expect(fake.scripting.executeScript).toHaveBeenCalledTimes(1);
    });

    it('reports frame enumeration failure without rejecting reconciliation', async () => {
        const fake = fakes(['https://www.facebook.com/home']);
        fake.tabs.getAllFrames.mockRejectedValue(new Error('frames unavailable'));
        const coordinator = new DocumentActivationCoordinator(fake);

        const result = await coordinator.reconcile({
            revision: 2,
            policy: ACTIVATION_POLICY.ENABLED,
        });

        expect(result.tabs).toEqual([{
            tabId: 1,
            hostname: 'www.facebook.com',
            action: TAB_ACTION.INJECT,
            ok: false,
        }]);
        expect(result.failures).toContainEqual({
            scope: RECONCILE_FAILURE_SCOPE.TAB,
            tabId: 1,
            hostname: 'www.facebook.com',
            action: TAB_ACTION.INJECT,
        });
    });

    it('suspends a disabled site and still ensures every reachable frame', async () => {
        const fake = fakes(['https://example.test/page']);
        const coordinator = new DocumentActivationCoordinator(fake);
        await coordinator.reconcile({
            revision: 2,
            policy: ACTIVATION_POLICY.ENABLED,
            siteScope: {
                mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
                excludedSites: ['example.test'],
                allowedSites: [],
            },
        });

        expect(fake.tabs.sendMessage).toHaveBeenCalledWith(
            1,
            {
                type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
                revision: 2,
                enabled: false,
            },
            { frameId: 0 },
        );
        expect(fake.tabs.sendMessage).toHaveBeenCalledWith(
            1,
            {
                type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
                revision: 2,
                enabled: false,
            },
            { frameId: 1 },
        );
        expect(fake.scripting.executeScript).toHaveBeenCalledTimes(1);
    });

    it('unregisters and broadcasts teardown when globally disabled', async () => {
        const fake = fakes(['https://example.test/page']);
        const coordinator = new DocumentActivationCoordinator(fake);
        const result = await coordinator.reconcile({
            revision: 3,
            policy: ACTIVATION_POLICY.DISABLED,
        });

        expect(result.registration).toBe(REGISTRATION_OUTCOME.UNREGISTERED);
        expect(fake.tabs.sendMessage).toHaveBeenCalledWith(
            1,
            {
                type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
                revision: 3,
                enabled: false,
            },
            { frameId: 0 },
        );
        expect(fake.tabs.sendMessage).toHaveBeenCalledWith(
            1,
            {
                type: RECONCILE_DOCUMENT_POLICY_MESSAGE,
                revision: 3,
                enabled: false,
            },
            { frameId: 1 },
        );
        expect(fake.scripting.executeScript).not.toHaveBeenCalled();
    });

    it('reports global teardown failure unless every reachable frame acknowledges', async () => {
        const fake = fakes(['https://example.test/page']);
        fake.tabs.sendMessage.mockImplementation(async (_tabId, message, options) => {
            if (options?.frameId === 1) {
                throw new Error('frame unavailable');
            }
            return acknowledgePolicy(message);
        });
        const coordinator = new DocumentActivationCoordinator(fake);

        const result = await coordinator.reconcile({
            revision: 3,
            policy: ACTIVATION_POLICY.DISABLED,
        });

        expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(2);
        expect(result.tabs).toEqual([
            {
                tabId: 1, hostname: 'example.test', action: TAB_ACTION.TEARDOWN, ok: false,
            },
        ]);
        expect(result.failures).toContainEqual({
            scope: RECONCILE_FAILURE_SCOPE.TAB,
            tabId: 1,
            hostname: 'example.test',
            action: TAB_ACTION.TEARDOWN,
        });
    });

    it('retains sibling recovery when one tab ensure fails', async () => {
        const fake = fakes([
            'https://first.test/page',
            'https://second.test/page',
        ]);
        fake.scripting.executeScript
            .mockRejectedValueOnce(new Error('unreachable'))
            .mockResolvedValueOnce([{ frameId: 0 }]);
        const coordinator = new DocumentActivationCoordinator(fake);
        const result = await coordinator.reconcile({
            revision: 4,
            policy: ACTIVATION_POLICY.ENABLED,
        });

        expect(result.tabs).toEqual([
            {
                tabId: 1, hostname: 'first.test', action: TAB_ACTION.INJECT, ok: false,
            },
            {
                tabId: 2, hostname: 'second.test', action: TAB_ACTION.INJECT, ok: true,
            },
        ]);
        expect(result.failures).toContainEqual({
            scope: RECONCILE_FAILURE_SCOPE.TAB,
            tabId: 1,
            hostname: 'first.test',
            action: TAB_ACTION.INJECT,
        });
    });

    it.each(['message', 'injection'] as const)(
        'does not let a pending tab %s block reconciliation',
        async (pendingOperation) => {
            vi.useFakeTimers();
            try {
                const fake = fakes([
                    'https://pending.test/page',
                    'https://reachable.test/page',
                ]);
                if (pendingOperation === 'message') {
                    let firstPendingMessage = true;
                    fake.tabs.sendMessage.mockImplementation((tabId, message) => {
                        if (tabId === 1 && firstPendingMessage) {
                            firstPendingMessage = false;
                            return new Promise<ReturnType<typeof acknowledgePolicy>>(
                                () => undefined,
                            );
                        }
                        return Promise.resolve(acknowledgePolicy(message));
                    });
                } else {
                    fake.scripting.executeScript
                        .mockImplementationOnce(() => new Promise<never>(() => undefined))
                        .mockResolvedValueOnce([{ frameId: 0 }]);
                }
                const coordinator = new DocumentActivationCoordinator(fake);
                const reconciliation = coordinator.reconcile({
                    revision: 6,
                    policy: ACTIVATION_POLICY.ENABLED,
                });
                const outcome = Promise.race([
                    reconciliation.then((result) => ({ kind: 'resolved' as const, result })),
                    new Promise<{ readonly kind: 'deadline' }>((resolve) => {
                        setTimeout(() => {
                            resolve({ kind: 'deadline' });
                        }, 2_000);
                    }),
                ]);

                await vi.advanceTimersByTimeAsync(2_000);

                await expect(outcome).resolves.toMatchObject({ kind: 'resolved' });
                expect(fake.scripting.executeScript).toHaveBeenCalledTimes(2);
            } finally {
                vi.useRealTimers();
            }
        },
    );

    it.each(['registration-read', 'registration-write', 'tabs-query'] as const)(
        'does not let a pending %s block lifecycle reconciliation',
        async (pendingOperation) => {
            vi.useFakeTimers();
            try {
                const fake = fakes(['https://example.test/page']);
                if (pendingOperation === 'registration-read') {
                    fake.scripting.getRegisteredContentScripts.mockImplementation(
                        () => new Promise<never>(() => undefined),
                    );
                } else if (pendingOperation === 'registration-write') {
                    fake.scripting.getRegisteredContentScripts.mockResolvedValue([]);
                    fake.scripting.registerContentScripts.mockImplementation(
                        () => new Promise<never>(() => undefined),
                    );
                } else {
                    fake.tabs.query.mockImplementation(
                        () => new Promise<never>(() => undefined),
                    );
                }
                const coordinator = new DocumentActivationCoordinator(fake);
                const reconciliation = coordinator.reconcile({
                    revision: 7,
                    policy: ACTIVATION_POLICY.ENABLED,
                });

                await vi.advanceTimersByTimeAsync(1_000);

                const result = await reconciliation;
                expect(result.revision).toBe(7);
                expect(result.failures.length).toBeGreaterThan(0);
            } finally {
                vi.useRealTimers();
            }
        },
    );

    it('repairs a registration write that succeeds after a newer disable intent', async () => {
        vi.useFakeTimers();
        try {
            const fake = fakes([]);
            fake.registered.clear();
            const completeRegisters: (() => void)[] = [];
            fake.scripting.registerContentScripts.mockImplementation((scripts) => new Promise<void>((resolve) => {
                completeRegisters.push(() => {
                    for (const script of scripts) {
                        fake.registered.set(script.id, script);
                    }
                    resolve();
                });
            }));
            const coordinator = new DocumentActivationCoordinator(fake);
            const enabling = coordinator.reconcile({
                revision: 8,
                policy: ACTIVATION_POLICY.ENABLED,
            });
            await vi.advanceTimersByTimeAsync(1_000);
            await enabling;

            await coordinator.reconcile({
                revision: 9,
                policy: ACTIVATION_POLICY.DISABLED,
            });
            expect(fake.registered.size).toBe(0);

            for (const completeRegister of completeRegisters) {
                completeRegister();
            }
            for (let index = 0; index < 10; index += 1) {
                await Promise.resolve();
            }

            expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({
                ids: [DOCUMENT_RUNTIME_REGISTRATION_ID],
            });
            expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({
                ids: [FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID],
            });
            expect(fake.registered.size).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('contains synchronous browser API failures and still reconciles siblings', async () => {
        const fake = fakes([
            'https://first.test/page',
            'https://second.test/page',
        ]);
        fake.tabs.sendMessage
            .mockImplementationOnce(() => {
                throw new Error('synchronous message failure');
            })
            .mockImplementationOnce((_tabId, message) => Promise.resolve(acknowledgePolicy(message)));
        fake.scripting.executeScript
            .mockImplementationOnce(() => {
                throw new Error('synchronous injection failure');
            })
            .mockResolvedValueOnce([{ frameId: 0 }]);
        const coordinator = new DocumentActivationCoordinator(fake);

        const result = await coordinator.reconcile({
            revision: 5,
            policy: ACTIVATION_POLICY.ENABLED,
        });

        expect(result.tabs).toEqual([
            {
                tabId: 1, hostname: 'first.test', action: TAB_ACTION.INJECT, ok: false,
            },
            {
                tabId: 2, hostname: 'second.test', action: TAB_ACTION.INJECT, ok: true,
            },
        ]);
    });

    it("continues reconciliation when one tab's browser operations never settle", async () => {
        vi.useFakeTimers();
        try {
            const fake = fakes([
                'https://stalled.test/page',
                'https://ready.test/page',
            ]);
            fake.tabs.sendMessage.mockImplementation((tabId, message) => (tabId === 1
                ? new Promise(() => undefined)
                : Promise.resolve(acknowledgePolicy(message))));
            fake.scripting.executeScript.mockImplementation((input) => (input.target.tabId === 1
                ? new Promise(() => undefined)
                : Promise.resolve([{ frameId: 0 }])));
            const coordinator = new DocumentActivationCoordinator(fake);

            const reconciliation = coordinator.reconcile({
                revision: 6,
                policy: ACTIVATION_POLICY.ENABLED,
            });
            await vi.runAllTimersAsync();

            const result = await reconciliation;

            expect(result.tabs).toContainEqual({
                tabId: 1,
                hostname: 'stalled.test',
                action: TAB_ACTION.INJECT,
                ok: false,
            });
            expect(result.tabs).toContainEqual({
                tabId: 2,
                hostname: 'ready.test',
                action: TAB_ACTION.INJECT,
                ok: true,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports registration failure when registration lookup never settles', async () => {
        vi.useFakeTimers();
        try {
            const fake = fakes(['https://example.test/page']);
            fake.scripting.getRegisteredContentScripts.mockImplementation(
                () => new Promise<never>(() => undefined),
            );
            const coordinator = new DocumentActivationCoordinator(fake);

            const reconciliation = coordinator.reconcile({
                revision: 7,
                policy: ACTIVATION_POLICY.ENABLED,
            });
            await vi.runAllTimersAsync();

            const result = await reconciliation;

            expect(result.registration).toBe(REGISTRATION_OUTCOME.FAILED);
            expect(result.failures).toContainEqual({
                scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
                operation: REGISTRATION_OPERATION.GET,
                registrationId: DOCUMENT_RUNTIME_REGISTRATION_ID,
            });
            expect(result.failures).toContainEqual({
                scope: RECONCILE_FAILURE_SCOPE.REGISTRATION,
                operation: REGISTRATION_OPERATION.GET,
                registrationId: FACEBOOK_PAYLOAD_BRIDGE_REGISTRATION_ID,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports tab-query failure when the matching query never settles', async () => {
        vi.useFakeTimers();
        try {
            const fake = fakes(['https://example.test/page']);
            fake.tabs.query.mockImplementation(() => new Promise<never>(() => undefined));
            const coordinator = new DocumentActivationCoordinator(fake);

            const reconciliation = coordinator.reconcile({
                revision: 8,
                policy: ACTIVATION_POLICY.ENABLED,
            });
            await vi.runAllTimersAsync();

            const result = await reconciliation;

            expect(result.tabs).toEqual([]);
            expect(result.failures).toContainEqual({
                scope: RECONCILE_FAILURE_SCOPE.MATCHING_TABS_QUERY,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports injection failure when frame enumeration never settles', async () => {
        vi.useFakeTimers();
        try {
            const fake = fakes(['https://www.facebook.com/home']);
            fake.tabs.getAllFrames.mockImplementation(
                () => new Promise<never>(() => undefined),
            );
            const coordinator = new DocumentActivationCoordinator(fake);

            const reconciliation = coordinator.reconcile({
                revision: 9,
                policy: ACTIVATION_POLICY.ENABLED,
            });
            await vi.runAllTimersAsync();

            await expect(reconciliation).resolves.toMatchObject({
                tabs: [{
                    tabId: 1,
                    hostname: 'www.facebook.com',
                    action: TAB_ACTION.INJECT,
                    ok: false,
                }],
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports injection failure when the Facebook bridge never settles', async () => {
        vi.useFakeTimers();
        try {
            const fake = fakes(['https://www.facebook.com/home']);
            fake.scripting.executeScript.mockImplementation((input) => ('frameIds' in input.target
                ? new Promise<never>(() => undefined)
                : Promise.resolve([{ frameId: 0 }])));
            const coordinator = new DocumentActivationCoordinator(fake);

            const reconciliation = coordinator.reconcile({
                revision: 10,
                policy: ACTIVATION_POLICY.ENABLED,
            });
            await vi.runAllTimersAsync();

            await expect(reconciliation).resolves.toMatchObject({
                tabs: [{
                    tabId: 1,
                    hostname: 'www.facebook.com',
                    action: TAB_ACTION.INJECT,
                    ok: false,
                }],
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it(
        'restores and reprocesses every reachable frame across site and global policy changes',
        async () => {
            let siteEnabled = true;
            let revision = 1;
            const first = installedFrame(() => ({ enabled: siteEnabled, revision }));
            const second = installedFrame(() => ({ enabled: siteEnabled, revision }));
            const frames = [first, second];
            const fake = fakes(['https://example.test/page']);
            let rejectedBroadcasts = 1;
            fake.tabs.sendMessage.mockImplementation(async (_tabId, message, options) => {
                const frame = frames[options?.frameId ?? -1];
                const response = frame?.messages.dispatch(message);
                if (rejectedBroadcasts > 0) {
                    rejectedBroadcasts -= 1;
                    throw new Error('nondeterministic broadcast response');
                }
                return response as ReturnType<typeof acknowledgePolicy>;
            });
            fake.scripting.executeScript.mockResolvedValue([
                { frameId: 0 },
                { frameId: 1 },
            ]);
            const coordinator = new DocumentActivationCoordinator(fake);
            try {
                await Promise.resolve();
                await Promise.resolve();
                expect(frames.map(hasOutput)).toEqual([true, true]);

                siteEnabled = false;
                revision = 3;
                const siteDisabled = await coordinator.reconcile({
                    revision,
                    policy: ACTIVATION_POLICY.ENABLED,
                    siteScope: {
                        mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
                        excludedSites: ['example.test'],
                        allowedSites: [],
                    },
                });
                await Promise.resolve();
                await Promise.resolve();
                expect(frames.map(hasOutput)).toEqual([false, false]);
                expect(siteDisabled.failures).toEqual([]);
                expect(siteDisabled.tabs).toEqual([
                    {
                        tabId: 1, hostname: 'example.test', action: TAB_ACTION.INJECT, ok: true,
                    },
                ]);

                siteEnabled = true;
                revision = 4;
                const siteEnabledResult = await coordinator.reconcile({
                    revision,
                    policy: ACTIVATION_POLICY.ENABLED,
                });
                await Promise.resolve();
                await Promise.resolve();
                expect(frames.map(hasOutput)).toEqual([true, true]);
                expect(siteEnabledResult.tabs).toEqual([
                    {
                        tabId: 1, hostname: 'example.test', action: TAB_ACTION.INJECT, ok: true,
                    },
                ]);

                revision = 5;
                const globallyDisabled = await coordinator.reconcile({
                    revision,
                    policy: ACTIVATION_POLICY.DISABLED,
                });
                expect(frames.map(hasOutput)).toEqual([false, false]);
                expect(globallyDisabled.tabs).toEqual([
                    {
                        tabId: 1, hostname: 'example.test', action: TAB_ACTION.TEARDOWN, ok: true,
                    },
                ]);
            } finally {
                first.handle.teardown();
                second.handle.teardown();
                first.element.remove();
                second.element.remove();
            }
        },
    );
});
