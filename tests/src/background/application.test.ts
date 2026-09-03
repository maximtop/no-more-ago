/**
 * @file Verifies background application document-state policy projection.
 */

import { describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/require-await */
import {
    BackgroundApplication,
    type BackgroundApplicationOptions,
} from "../../../src/background/application";
import { SettingsService } from "../../../src/background/settings/service";
import type {
    ActivationReconcileResult,
} from "../../../src/background/runtime/document-activation";
import {
    ACTIVATION_POLICY,
    REGISTRATION_OUTCOME,
} from "../../../src/background/runtime/document-activation";
import type { TabsRuntime } from "../../../src/background/runtime/tabs";
import {
    SITE_SETTINGS_SURFACE,
    STATE_AVAILABILITY,
} from "../../../src/shared/messaging/view-state-values";
import {
    createSettingsSnapshot,
    SETTINGS_STORAGE_KEY,
    type SettingsSnapshotV6,
} from "../../../src/shared/settings/snapshot";
import {
    DEFAULT_SITE_SCOPE,
    SITE_SCOPE_MODE,
    type SiteScopePolicy,
} from "../../../src/shared/settings/site-scope";

const excluding = (...hostnames: readonly string[]): SiteScopePolicy => ({
    mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
    excludedSites: hostnames,
    allowedSites: [],
});

const reconciled: ActivationReconcileResult = {
    revision: 0,
    policy: ACTIVATION_POLICY.ENABLED,
    failures: [],
    registration: REGISTRATION_OUTCOME.UNCHANGED,
    registrations: [],
    tabs: [],
};

/**
 * Creates an application with an in-memory settings store.
 *
 * @param initial - Values returned by the settings store.
 * @returns - Configured application facade.
 */
function application(
    initial: Record<string, SettingsSnapshotV6 | undefined> = {},
): BackgroundApplication {
    const storage = {
        get: vi.fn(async () => initial),
        set: vi.fn(async () => undefined),
    };
    const tabs: TabsRuntime = {
        query: vi.fn(async () => []),
        getAllFrames: vi.fn(async () => []),
        sendMessage: vi.fn(async () => undefined),
    };
    const coordinator: BackgroundApplicationOptions["coordinator"] = {
        reconcile: vi.fn(async () => reconciled),
    };
    return new BackgroundApplication({
        settings: new SettingsService(storage),
        coordinator,
        tabs,
    });
}

describe("BackgroundApplication document state", () => {
    it("uses the top-level tab URL rather than the frame URL for policy", async () => {
        const app = application();
        const state = await app.getDocumentState({
            url: "https://cross-origin.example/frame",
            tab: { url: "https://example.test/page" },
        });

        expect(state.availability).toBe(STATE_AVAILABILITY.READY);
        expect(state.enabled).toBe(true);
    });

    it("rejects a disabled top-level site while accepting a frame URL", async () => {
        const app = application({
            [SETTINGS_STORAGE_KEY]: createSettingsSnapshot({
                revision: 4,
                globalEnabled: true,
                siteScope: excluding("example.test"),
            }),
        });
        const state = await app.getDocumentState({
            url: "https://frame.example/frame",
            tab: { url: "https://example.test/page" },
        });

        expect(state.availability).toBe(STATE_AVAILABILITY.READY);
        expect(state.enabled).toBe(false);
    });

    it.each([
        ["HTTPS://Example.TEST:443/page", "example.test"],
        ["https://例え.テスト/page", "xn--r8jz45g.xn--zckzah"],
        ["https://192.0.2.1:8443/page", "192.0.2.1"],
        ["https://[2001:db8::1]/page", "[2001:db8::1]"],
        ["https://example.test./page", "example.test."],
    ])("applies policy through the canonical top-level URL %s", async (url, hostname) => {
        const app = application({
            [SETTINGS_STORAGE_KEY]: createSettingsSnapshot({
                revision: 2,
                globalEnabled: true,
                siteScope: excluding(hostname),
            }),
        });
        const state = await app.getDocumentState({ tab: { url } });

        expect(state.availability).toBe(STATE_AVAILABILITY.READY);
        expect(state.enabled).toBe(false);
    });

    it.each(["ftp://example.test/page", "not-a-url"])(
        "fails closed for unsupported top-level URL %s",
        async (url) => {
            const app = application();
            const state = await app.getDocumentState({ tab: { url } });

            expect(state.availability).toBe(STATE_AVAILABILITY.READY);
            expect(state.enabled).toBe(false);
        },
    );

    it("routes a site disable through affected-host document reconciliation", async () => {
        let stored: Record<string, SettingsSnapshotV6 | undefined> = {};
        const storage = {
            get: vi.fn(() => Promise.resolve(stored)),
            set: vi.fn((items: Readonly<Record<string, SettingsSnapshotV6>>) => {
                stored = { ...stored, ...items };
                return Promise.resolve();
            }),
        };
        const tabs: TabsRuntime = {
            query: vi.fn(() => Promise.resolve([])),
            getAllFrames: vi.fn(() => Promise.resolve([])),
            sendMessage: vi.fn(() => Promise.resolve(undefined)),
        };
        const reconcile = vi.fn((input: Parameters<
            BackgroundApplicationOptions["coordinator"]["reconcile"]
        >[0]) => Promise.resolve({
            revision: input.revision,
            policy: input.policy,
            failures: [],
            registration: REGISTRATION_OUTCOME.UNCHANGED,
            registrations: [],
            tabs: [],
        }));
        const app = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator: { reconcile },
            tabs,
        });

        const response = await app.setSiteEnabled(
            "example.test",
            false,
            SITE_SETTINGS_SURFACE.SITES,
        );

        expect(response.ok).toBe(true);
        expect(reconcile).toHaveBeenLastCalledWith({
            revision: 1,
            policy: ACTIVATION_POLICY.ENABLED,
            siteScope: excluding("example.test"),
            affectedHostnames: ["example.test"],
        });
    });

    it("reconciles reset defaults at a revision newer than the active documents", async () => {
        let stored: Record<string, SettingsSnapshotV6 | undefined> = {
            [SETTINGS_STORAGE_KEY]: createSettingsSnapshot({
                revision: 7,
                globalEnabled: true,
                siteScope: excluding("example.test"),
                display: { formatMode: "system", timeZone: { mode: "utc" } },
                debugEnabled: true,
            }),
        };
        const storage = {
            get: vi.fn(() => Promise.resolve(stored)),
            set: vi.fn((items: Readonly<Record<string, SettingsSnapshotV6>>) => {
                stored = { ...stored, ...items };
                return Promise.resolve();
            }),
        };
        const tabs: TabsRuntime = {
            query: vi.fn(() => Promise.resolve([])),
            getAllFrames: vi.fn(() => Promise.resolve([])),
            sendMessage: vi.fn(() => Promise.resolve(undefined)),
        };
        const reconcile = vi.fn((input: Parameters<
            BackgroundApplicationOptions["coordinator"]["reconcile"]
        >[0]) => Promise.resolve({
            revision: input.revision,
            policy: input.policy,
            failures: [],
            registration: REGISTRATION_OUTCOME.UNCHANGED,
            registrations: [],
            tabs: [],
        }));
        const app = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator: { reconcile },
            tabs,
        });

        const response = await app.resetAllSettings();

        expect(response).toMatchObject({ ok: true, acceptedRevision: 8 });
        expect(stored[SETTINGS_STORAGE_KEY]).toMatchObject({
            revision: 8,
            globalEnabled: true,
            siteScope: DEFAULT_SITE_SCOPE,
            debugEnabled: false,
        });
        expect(reconcile.mock.calls.map(([input]) => ({
            revision: input.revision,
            policy: input.policy,
        }))).toEqual([
            { revision: 7, policy: ACTIVATION_POLICY.ENABLED },
            { revision: 8, policy: ACTIVATION_POLICY.DISABLED },
            { revision: 8, policy: ACTIVATION_POLICY.ENABLED },
        ]);
    });
});

describe("BackgroundApplication settings notifications", () => {
    /**
     * Creates an application over in-memory storage with an observable broadcast.
     *
     * @returns - Application facade and the revisions it announced.
     */
    function notifying(): {
        readonly app: BackgroundApplication;
        readonly announced: number[];
    } {
        let stored: Record<string, unknown> = {};
        const storage = {
            get: vi.fn(() => Promise.resolve(stored)),
            set: vi.fn((items: Readonly<Record<string, SettingsSnapshotV6>>) => {
                stored = { ...stored, ...items };
                return Promise.resolve();
            }),
        };
        const tabs: TabsRuntime = {
            query: vi.fn(async () => []),
            getAllFrames: vi.fn(async () => []),
            sendMessage: vi.fn(async () => undefined),
        };
        const announced: number[] = [];
        return {
            announced,
            app: new BackgroundApplication({
                settings: new SettingsService(storage),
                coordinator: { reconcile: vi.fn(async () => reconciled) },
                tabs,
                broadcast: {
                    settingsChanged: (revision: number) => {
                        announced.push(revision);
                    },
                },
            }),
        };
    }

    it("announces the committed revision after each accepted mutation", async () => {
        const { app, announced } = notifying();

        await app.setGlobalEnabled(false);
        await app.setSiteScopeMode(SITE_SCOPE_MODE.SELECTED_ONLY);
        await app.setSiteEnabled("github.com", true, SITE_SETTINGS_SURFACE.SITES);

        expect(announced).toEqual([1, 2, 3]);
    });

    it("keeps a command successful when the broadcast throws", async () => {
        let stored: Record<string, unknown> = {};
        const app = new BackgroundApplication({
            settings: new SettingsService({
                get: vi.fn(() => Promise.resolve(stored)),
                set: vi.fn((items: Readonly<Record<string, SettingsSnapshotV6>>) => {
                    stored = { ...stored, ...items };
                    return Promise.resolve();
                }),
            }),
            coordinator: { reconcile: vi.fn(async () => reconciled) },
            tabs: {
                query: vi.fn(async () => []),
                getAllFrames: vi.fn(async () => []),
                sendMessage: vi.fn(async () => undefined),
            },
            broadcast: {
                settingsChanged: () => {
                    throw new Error("No receiving end");
                },
            },
        });

        await expect(app.setGlobalEnabled(false)).resolves.toMatchObject({ ok: true });
    });

    it("switches the scope mode and reports both retained lists", async () => {
        const { app } = notifying();
        await app.setSiteEnabled("excluded.test", false, SITE_SETTINGS_SURFACE.SITES);
        await app.setSiteScopeMode(SITE_SCOPE_MODE.SELECTED_ONLY);

        const response = await app.setSiteEnabled(
            "allowed.test",
            true,
            SITE_SETTINGS_SURFACE.SITES,
        );

        expect(response.ok).toBe(true);
        expect(response.state).toMatchObject({
            scopeMode: SITE_SCOPE_MODE.SELECTED_ONLY,
            excludedSites: ["excluded.test"],
            allowedSites: ["allowed.test"],
        });
    });
});
