/**
 * @file Exercises background application lifecycle, settings, and tab coordination.
 */

/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { describe, expect, it, vi } from "vitest";
import {
    BackgroundApplication,
    type BackgroundApplicationOptions,
    type SetDisplaySettingsResponse,
} from "../../src/background/application";
import { DIAGNOSTICS_STORAGE_KEY, DiagnosticJournal } from "../../src/diagnostics/journal";
import { SettingsService } from "../../src/settings/settings-service";
import {
    DEFAULT_SETTINGS_SNAPSHOT,
    SETTINGS_PREVIOUS_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    type DisplaySettings,
} from "../../src/settings/snapshot";
import type { RuntimeAdapterDefinition } from "../../src/runtime/adapter-activation";
import { AdapterActivationCoordinator } from "../../src/runtime/adapter-activation";
import {
    DEBUG_POLICY_UPDATED_MESSAGE,
    DOCUMENT_STATUS_MESSAGE,
    PRESENTATION_UPDATED_MESSAGE,
    TEARDOWN_DOCUMENT_MESSAGE,
    UPDATE_DEBUG_POLICY_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
    type DocumentPhase,
} from "../../src/runtime/messages";

const settingsV5 = (
    revision: number,
    globalEnabled: boolean,
    sitePreferences: Record<string, boolean> = {},
    display: DisplaySettings = { formatMode: "system", timeZone: { mode: "system" } },
    debugEnabled = false,
) => ({
    schemaVersion: 5 as const,
    revision,
    globalEnabled,
    sitePreferences,
    display,
    debugEnabled,
});

const adapter: RuntimeAdapterDefinition = {
    id: "github",
    hostname: "github.com",
    registration: {
        id: "github",
        matches: ["https://github.com/*"],
        js: ["content.js"],
        runAt: "document_start",
        allFrames: false,
        persistAcrossSessions: true,
    },
    matches: (url) => url.hostname === "github.com",
};

/**
 * Creates a background application fixture with injectable activation reconciliation.
 *
 * @param reconcile - Activation reconciliation implementation used by the fixture.
 * @returns - Application, storage, tab, and coordinator test doubles.
 */
function appWith(
    reconcile: (input: {
        revision: number | null;
        mode: string;
        policy: string;
    }) => Promise<unknown> | unknown = async (input) => ({
        ...input,
        failures: [],
        registration: {},
        tabs: [],
    }),
) {
    let stored: unknown;
    let previous: unknown;
    const storage = {
        get: vi.fn(async () =>
            stored === undefined && previous === undefined
                ? {}
                : { [SETTINGS_STORAGE_KEY]: stored, [SETTINGS_PREVIOUS_STORAGE_KEY]: previous },
        ),
        set: vi.fn(async (items: Record<string, unknown>) => {
            stored = items[SETTINGS_STORAGE_KEY];
            previous = items[SETTINGS_PREVIOUS_STORAGE_KEY];
        }),
        read: () => stored,
    };
    const tabs = {
        query: vi.fn(
            async (query: {
                active?: boolean;
            }): Promise<readonly { id: number; url?: string }[]> =>
                query.active
                    ? [{ id: 5, url: "https://github.com/example" }]
                    : [{ id: 5, url: "https://github.com/example" }],
        ),
        sendMessage: vi.fn(async (_tabId: number, message?: unknown) => {
            if (
                message &&
                typeof message === "object" &&
                "type" in message &&
                message.type === UPDATE_PRESENTATION_MESSAGE &&
                "revision" in message
            ) {
                return { type: PRESENTATION_UPDATED_MESSAGE, revision: message.revision };
            }
            return { type: DOCUMENT_STATUS_MESSAGE, phase: "active" };
        }),
    };
    const coordinator = {
        reconcile: vi.fn(
            async (input: { revision: number | null; mode: string; policy: string }) =>
                reconcile(input) as never,
        ),
    };
    return {
        app: new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator: coordinator as never,
            tabs,
            adapters: [adapter],
        }),
        storage,
        tabs,
        coordinator,
    };
}

/**
 * Creates a background application fixture backed by real settings and diagnostic services.
 *
 * @param initial - Initial persisted settings value.
 * @param diagnosticEnvironment - Trusted extension and browser metadata.
 * @returns - Application and controllable storage, tab, and diagnostics doubles.
 */
function realAppWith(
    initial?: unknown,
    diagnosticEnvironment: NonNullable<BackgroundApplicationOptions["diagnosticEnvironment"]> = {
        extensionVersion: "9.8.7",
        browserFamily: "firefox",
    },
) {
    let stored = initial;
    let previous: unknown;
    let diagnostics: unknown;
    let failDiagnostics = false;
    const storage = {
        get: vi.fn(async (keys?: string | readonly string[] | Record<string, unknown>) => {
            if (keys === DIAGNOSTICS_STORAGE_KEY) {
                return diagnostics === undefined ? {} : { [DIAGNOSTICS_STORAGE_KEY]: diagnostics };
            }
            return stored === undefined && previous === undefined
                ? {}
                : { [SETTINGS_STORAGE_KEY]: stored, [SETTINGS_PREVIOUS_STORAGE_KEY]: previous };
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
            if (Object.hasOwn(items, DIAGNOSTICS_STORAGE_KEY)) {
                if (failDiagnostics) {
                    throw new Error("diagnostics unavailable");
                }
                diagnostics = items[DIAGNOSTICS_STORAGE_KEY];
                return;
            }
            stored = items[SETTINGS_STORAGE_KEY];
            previous = items[SETTINGS_PREVIOUS_STORAGE_KEY];
        }),
        remove: vi.fn(async (key: string | readonly string[]) => {
            if (
                key === DIAGNOSTICS_STORAGE_KEY ||
                (Array.isArray(key) && key.includes(DIAGNOSTICS_STORAGE_KEY))
            ) {
                diagnostics = undefined;
            }
        }),
    };
    const registered = new Map<string, typeof adapter.registration>();
    const phases = new Map<number, DocumentPhase>([
        [5, "active"],
        [6, "active"],
    ]);
    const failTeardown = new Set<number>();
    const scripting = {
        getRegisteredContentScripts: vi.fn(async ({ ids }: { ids: string[] }) =>
            ids.flatMap((id) => (registered.has(id) ? [{ ...registered.get(id)! }] : [])),
        ),
        registerContentScripts: vi.fn(async (scripts: (typeof adapter.registration)[]) => {
            for (const script of scripts) {
                registered.set(script.id, script);
            }
        }),
        updateContentScripts: vi.fn(async (scripts: (typeof adapter.registration)[]) => {
            for (const script of scripts) {
                registered.set(script.id, script);
            }
        }),
        unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => {
            for (const id of ids) {
                registered.delete(id);
            }
        }),
        executeScript: vi.fn(
            async ({ target }: { target: { tabId: number; allFrames: false } }) => {
                phases.set(target.tabId, "active");
            },
        ),
    };
    const tabs = {
        query: vi.fn(async (query: { active?: boolean; url?: readonly string[] }) => {
            if (query.active) {
                return [{ id: 5, url: "https://github.com/one" }];
            }
            if (query.url?.some((pattern) => pattern.includes("github.com"))) {
                return [
                    { id: 5, url: "https://github.com/one" },
                    { id: 6, url: "https://github.com/two" },
                ];
            }
            return [];
        }),
        sendMessage: vi.fn(
            async (tabId: number, message: unknown, options?: { readonly frameId: 0 }) => {
                void options;
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === DOCUMENT_STATUS_MESSAGE
                ) {
                    return { type: DOCUMENT_STATUS_MESSAGE, phase: phases.get(tabId) ?? "stopped" };
                }
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === UPDATE_PRESENTATION_MESSAGE &&
                    "revision" in message
                ) {
                    return { type: PRESENTATION_UPDATED_MESSAGE, revision: message.revision };
                }
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === UPDATE_DEBUG_POLICY_MESSAGE &&
                    "revision" in message
                ) {
                    return { type: DEBUG_POLICY_UPDATED_MESSAGE, revision: message.revision };
                }
                if (failTeardown.has(tabId)) {
                    throw new Error("teardown failed");
                }
                phases.set(tabId, "stopped");
                return { type: DOCUMENT_STATUS_MESSAGE, phase: "stopped" };
            },
        ),
    };
    const runtime = new AdapterActivationCoordinator({ adapters: [adapter], scripting, tabs });
    const coordinator = {
        reconcile: vi.fn(async (input: Parameters<typeof runtime.reconcile>[0]) =>
            runtime.reconcile(input),
        ),
    };
    const app = new BackgroundApplication({
        settings: new SettingsService(storage),
        coordinator,
        tabs,
        adapters: [adapter],
        journal: new DiagnosticJournal(storage),
        diagnosticEnvironment,
    });
    return {
        app,
        storage,
        tabs,
        scripting,
        registered,
        phases,
        failTeardown,
        coordinator,
        runtime,
        get stored() {
            return stored;
        },
        get previous() {
            return previous;
        },
        get diagnostics() {
            return diagnostics;
        },
        failDiagnostics: (value: boolean) => {
            failDiagnostics = value;
        },
        poisonDiagnostics: (value: unknown) => {
            diagnostics = value;
        },
    };
}

describe("BackgroundApplication", () => {
    it("derives an active GitHub model from the default state", async () => {
        const { app } = appWith();
        await expect(app.getPopupState()).resolves.toMatchObject({
            availability: "ready",
            revision: 0,
            globalEnabled: true,
            hostname: "github.com",
            status: "active",
        });
    });

    it("keeps diagnostic collection completely off until an authoritative opt-in", async () => {
        const fixture = realAppWith();
        await expect(fixture.app.getDebugState()).resolves.toEqual({
            availability: "ready",
            revision: 0,
            enabled: false,
        });
        await expect(
            fixture.app.recordDocumentEvent(
                { category: "adapter", reason: "adapter-matched" },
                {
                    url: "https://github.com/example/repository",
                    frameId: 0,
                    tab: { incognito: true },
                },
            ),
        ).resolves.toBe(false);
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.storage.set).not.toHaveBeenCalled();
        expect(fixture.storage.remove).not.toHaveBeenCalled();
        expect(
            fixture.storage.get.mock.calls.some(([keys]) => keys === DIAGNOSTICS_STORAGE_KEY),
        ).toBe(false);
        expect(
            fixture.tabs.sendMessage.mock.calls.some(
                ([, message]) =>
                    typeof message === "object" &&
                    message !== null &&
                    "type" in message &&
                    message.type === UPDATE_DEBUG_POLICY_MESSAGE,
            ),
        ).toBe(false);
    });

    it("exports every safe journal entry with authoritative background environment", async () => {
        const fixture = realAppWith();
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({
            ok: false,
            error: "disabled",
        });
        await expect(fixture.app.clearDiagnostics()).resolves.toEqual({
            ok: false,
            error: "disabled",
        });
        expect(
            fixture.storage.get.mock.calls.some(([key]) => key === DIAGNOSTICS_STORAGE_KEY),
        ).toBe(false);
        await fixture.app.setDebugEnabled(true);
        await fixture.app.recordDocumentEvent(
            {
                category: "mutation",
                count: 2,
                extensionVersion: "forged",
                browserFamily: "chromium",
            },
            {
                url: "https://github.com/example/repository/issues/5?token=private#fragment",
                frameId: 0,
                tab: { incognito: true },
            },
        );
        const result = await fixture.app.getDiagnosticsSnapshot();
        if (!result.ok) {
            throw new Error(`Expected complete diagnostics, received ${result.error}`);
        }
        expect(result.snapshot.environment).toEqual({
            extensionVersion: "9.8.7",
            browserFamily: "firefox",
        });
        expect(
            result.snapshot.entries.some(
                (entry) =>
                    entry.category === "settings" &&
                    entry.extensionVersion === "9.8.7" &&
                    entry.browserFamily === "firefox",
            ),
        ).toBe(true);
        expect(
            result.snapshot.entries.some(
                (entry) =>
                    entry.category === "mutation" &&
                    entry.incognito &&
                    entry.pageCategory === "issue" &&
                    entry.extensionVersion === "9.8.7" &&
                    entry.browserFamily === "firefox",
            ),
        ).toBe(true);
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
        expect(JSON.stringify(result)).not.toMatch(/token|private|fragment|forged/u);
        expect((fixture.stored as { revision: number }).revision).toBe(1);
    });

    it("clears only opted-in entries and preserves settings and later recording", async () => {
        const fixture = realAppWith();
        await fixture.app.setDebugEnabled(true);
        expect(fixture.diagnostics).toBeDefined();
        const stored = fixture.stored;
        const writes = fixture.storage.set.mock.calls.filter(([items]) =>
            Object.hasOwn(items, SETTINGS_STORAGE_KEY),
        ).length;
        await expect(fixture.app.clearDiagnostics()).resolves.toEqual({ ok: true });
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.stored).toBe(stored);
        expect(
            fixture.storage.set.mock.calls.filter(([items]) =>
                Object.hasOwn(items, SETTINGS_STORAGE_KEY),
            ),
        ).toHaveLength(writes);
        await expect(fixture.app.getDebugState()).resolves.toEqual({
            availability: "ready",
            revision: 1,
            enabled: true,
        });
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({
            ok: false,
            error: "empty",
        });
        await fixture.app.recordDocumentEvent(
            { category: "adapter", reason: "adapter-matched" },
            { url: "https://github.com/example/repository", frameId: 0 },
        );
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toMatchObject({
            ok: true,
            snapshot: { entries: [{ category: "adapter" }] },
        });
    });

    it("returns unavailable without a background-owned diagnostics journal", async () => {
        const fixture = appWith();
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({
            ok: false,
            error: "unavailable",
        });
        await expect(fixture.app.clearDiagnostics()).resolves.toEqual({
            ok: false,
            error: "unavailable",
        });
    });

    it("reports journal failures without disabling debug collection", async () => {
        const fixture = realAppWith();
        await fixture.app.setDebugEnabled(true);
        fixture.poisonDiagnostics({
            entries: [
                {
                    category: "mutation",
                    timestamp: 1,
                    hostname: "github.com",
                    pageCategory: "repository",
                    incognito: false,
                    url: "https://github.com/private",
                },
            ],
        });
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({
            ok: false,
            error: "invalid-journal",
        });
        fixture.storage.get.mockRejectedValueOnce(new Error("storage unreadable"));
        await expect(fixture.app.getDiagnosticsSnapshot()).resolves.toEqual({
            ok: false,
            error: "storage-failed",
        });
        fixture.storage.remove.mockRejectedValueOnce(new Error("storage locked"));
        await expect(fixture.app.clearDiagnostics()).resolves.toEqual({
            ok: false,
            error: "storage-failed",
        });
        await expect(fixture.app.getDebugState()).resolves.toEqual({
            availability: "ready",
            revision: 1,
            enabled: true,
        });
    });

    it("serializes clear and disable without restoring journal entries", async () => {
        const fixture = realAppWith();
        await fixture.app.setDebugEnabled(true);
        await Promise.all([fixture.app.clearDiagnostics(), fixture.app.setDebugEnabled(false)]);
        expect(fixture.diagnostics).toBeUndefined();
        await expect(fixture.app.getDebugState()).resolves.toMatchObject({
            availability: "ready",
            enabled: false,
        });
    });

    it("broadcasts debug revision and persists trusted top-frame GitHub context", async () => {
        const fixture = realAppWith();
        await expect(fixture.app.setDebugEnabled(true)).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 1,
            state: { availability: "ready", revision: 1, enabled: true },
        });
        const broadcasts = fixture.tabs.sendMessage.mock.calls.filter(
            ([, message]) =>
                typeof message === "object" &&
                message !== null &&
                "type" in message &&
                message.type === UPDATE_DEBUG_POLICY_MESSAGE,
        );
        expect(broadcasts.map(([tabId]) => tabId)).toEqual([5, 6]);
        for (const [, message, options] of broadcasts) {
            expect(message).toEqual({
                type: UPDATE_DEBUG_POLICY_MESSAGE,
                revision: 1,
                enabled: true,
            });
            expect(options).toEqual({ frameId: 0 });
        }

        await expect(
            fixture.app.recordDocumentEvent(
                { category: "adapter", reason: "adapter-matched", count: 1 },
                {
                    url: "https://github.com/example/repository/issues/42?"
                        + "token=very-secret#private-fragment",
                    frameId: 0,
                    tab: { incognito: true },
                },
            ),
        ).resolves.toBe(true);
        const envelope = fixture.diagnostics as {
            entries: readonly {
                category: string;
                hostname: string;
                pageCategory: string;
                incognito: boolean;
            }[];
        };
        expect(envelope.entries).toContainEqual(
            expect.objectContaining({
                category: "adapter",
                hostname: "github.com",
                pageCategory: "issue",
                incognito: true,
            }),
        );
        expect(JSON.stringify(envelope)).not.toContain("very-secret");
        expect(JSON.stringify(envelope)).not.toContain("private-fragment");
        await expect(
            fixture.app.recordDocumentEvent(
                {
                    category: "adapter",
                    reason: "adapter-matched",
                    extensionVersion: "attacker-version",
                    browserFamily: "chromium",
                    adapterVersion: "attacker-adapter",
                },
                {
                    url: "https://github.com/example/repository",
                    frameId: 0,
                    tab: { incognito: false },
                },
            ),
        ).resolves.toBe(true);
        const enriched = fixture.diagnostics as { entries: readonly Record<string, unknown>[] };
        expect(enriched.entries.at(-1)).toMatchObject({
            extensionVersion: "9.8.7",
            browserFamily: "firefox",
        });
        expect(enriched.entries.at(-1)).not.toMatchObject({
            extensionVersion: "attacker-version",
            browserFamily: "chromium",
            adapterVersion: "attacker-adapter",
        });
        expect(enriched.entries.at(-1)).not.toHaveProperty("adapterVersion");

        const writes = fixture.storage.set.mock.calls.length;
        await expect(
            fixture.app.recordDocumentEvent(
                { category: "adapter" },
                { url: "https://evil.example/repository", frameId: 0 },
            ),
        ).resolves.toBe(false);
        await expect(
            fixture.app.recordDocumentEvent(
                { category: "adapter" },
                { url: "https://github.com/example/repository", frameId: 1 },
            ),
        ).resolves.toBe(false);
        await expect(
            fixture.app.recordDocumentEvent(
                { category: "adapter", hostname: "github.com" },
                { url: "https://github.com/example/repository", frameId: 0 },
            ),
        ).resolves.toBe(false);
        expect(fixture.storage.set).toHaveBeenCalledTimes(writes);

        await expect(fixture.app.setDebugEnabled(false)).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: { availability: "ready", revision: 2, enabled: false },
        });
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.storage.remove).toHaveBeenCalledWith(DIAGNOSTICS_STORAGE_KEY);
        const afterDisable = fixture.storage.set.mock.calls.length;
        await expect(
            fixture.app.recordDocumentEvent(
                { category: "mutation", count: 1 },
                { url: "https://github.com/example/repository", frameId: 0 },
            ),
        ).resolves.toBe(false);
        expect(fixture.storage.set).toHaveBeenCalledTimes(afterDisable);
    });

    it.each(["global", "site"] as const)(
        "rejects diagnostics from a %s-disabled trusted document",
        async (policy) => {
            const initial = settingsV5(
                3,
                policy !== "global",
                policy === "site" ? { "github.com": false } : {},
                undefined,
                true,
            );
            const fixture = realAppWith(initial);
            await fixture.app.ensureReady();
            await expect(
                fixture.app.recordDocumentEvent(
                    { category: "mutation", count: 1 },
                    {
                        url: "https://github.com/example/repository",
                        frameId: 0,
                        tab: { incognito: true },
                    },
                ),
            ).resolves.toBe(false);
        },
    );

    it("keeps debug policy when a document acknowledgement is malformed", async () => {
        const fixture = realAppWith();
        await fixture.app.ensureReady();
        fixture.tabs.sendMessage.mockImplementation(async (tabId, message) => {
            if (
                typeof message === "object" &&
                message !== null &&
                "type" in message &&
                message.type === UPDATE_DEBUG_POLICY_MESSAGE
            ) {
                return tabId === 5
                    ? { type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 0 }
                    : { type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 1 };
            }
            return { type: DOCUMENT_STATUS_MESSAGE, phase: "active" as const };
        });
        await expect(fixture.app.setDebugEnabled(true)).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 1,
            state: { availability: "ready", revision: 1, enabled: true },
            refreshFailures: [{ hostname: "github.com", tabId: 5, reason: "tab-update" }],
        });
    });

    it("isolates rejected diagnostic writes and clears the journal during full reset", async () => {
        const fixture = realAppWith();
        fixture.failDiagnostics(true);
        await expect(fixture.app.setDebugEnabled(true)).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 1,
        });
        await expect(
            fixture.app.recordDocumentEvent(
                { category: "timing", count: 1, durationMs: 2 },
                {
                    url: "https://github.com/example/repository",
                    frameId: 0,
                },
            ),
        ).resolves.toBe(true);
        expect(fixture.diagnostics).toBeUndefined();
        fixture.failDiagnostics(false);
        await fixture.app.recordDocumentEvent(
            { category: "adapter", reason: "adapter-matched" },
            {
                url: "https://github.com/example/repository",
                frameId: 0,
            },
        );
        expect(fixture.diagnostics).toBeDefined();
        await expect(fixture.app.resetAllSettings()).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 0,
        });
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.storage.remove).toHaveBeenCalledWith(DIAGNOSTICS_STORAGE_KEY);
        await expect(fixture.app.getDebugState()).resolves.toEqual({
            availability: "ready",
            revision: 0,
            enabled: false,
        });
    });

    it("resets custom settings and closes the diagnostic sink", async () => {
        const initial = settingsV5(
            7,
            true,
            {},
            { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm", timeZone: { mode: "utc" } },
            true,
        );
        const fixture = realAppWith(initial, {
            extensionVersion: "2.4.6",
            browserFamily: "chromium",
        });
        await expect(fixture.app.getPopupState()).resolves.toMatchObject({
            availability: "ready",
            revision: 7,
            status: "active",
        });
        await expect(
            fixture.app.recordDocumentEvent(
                { category: "mutation", count: 2 },
                { url: "https://github.com/example/repository", frameId: 0 },
            ),
        ).resolves.toBe(true);
        expect(fixture.diagnostics).toBeDefined();
        const beforeResetMessages = fixture.tabs.sendMessage.mock.calls.length;
        await expect(fixture.app.resetAllSettings()).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 0,
            state: { availability: "ready", revision: 0 },
        });
        expect(fixture.app.currentSnapshot).toEqual(settingsV5(0, true));
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.coordinator.reconcile.mock.calls.at(-1)?.[0]).toMatchObject({
            revision: 0,
            mode: "activation-sweep",
            policy: "enabled",
        });
        await expect(
            fixture.app.recordDocumentEvent(
                { category: "mutation", count: 1 },
                { url: "https://github.com/example/repository", frameId: 0 },
            ),
        ).resolves.toBe(false);
        expect(fixture.tabs.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(
            beforeResetMessages,
        );
    });

    it.each(["global", "site"] as const)(
        "restores the complete defaults and both active tabs from a %s-disabled policy",
        async (policy) => {
            const display: DisplaySettings = {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm XXX",
                timeZone: { mode: "iana", identifier: "America/New_York" },
            };
            const preferences = {
                "github.com": policy === "global",
                "managed-enabled.test": true,
                "managed-disabled.test": false,
            };
            const fixture = realAppWith(
                settingsV5(11, policy !== "global", preferences, display, true),
            );
            await fixture.app.ensureReady();
            expect([...fixture.phases.values()]).toEqual(["stopped", "stopped"]);
            fixture.poisonDiagnostics({
                entries: [
                    {
                        category: "mutation",
                        timestamp: 1,
                        hostname: "github.com",
                        pageCategory: "repository",
                        incognito: false,
                    },
                ],
            });
            const beforeSettingsWrites = fixture.storage.set.mock.calls.filter(([items]) =>
                Object.hasOwn(items, SETTINGS_STORAGE_KEY),
            ).length;

            await expect(fixture.app.resetAllSettings()).resolves.toEqual({
                ok: true,
                acceptedRevision: 0,
                state: {
                    availability: "ready",
                    revision: 0,
                    globalEnabled: true,
                    sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }],
                },
            });
            const settingsWrites = fixture.storage.set.mock.calls.filter(([items]) =>
                Object.hasOwn(items, SETTINGS_STORAGE_KEY),
            );
            expect(settingsWrites).toHaveLength(beforeSettingsWrites + 1);
            expect(settingsWrites.at(-1)?.[0]).toEqual({
                [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT,
                [SETTINGS_PREVIOUS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT,
            });
            expect(fixture.stored).toEqual(DEFAULT_SETTINGS_SNAPSHOT);
            expect(fixture.previous).toEqual(DEFAULT_SETTINGS_SNAPSHOT);
            expect(fixture.diagnostics).toBeUndefined();
            expect(fixture.storage.remove).toHaveBeenLastCalledWith(DIAGNOSTICS_STORAGE_KEY);
            expect(fixture.storage.remove.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
                fixture.storage.set.mock.invocationCallOrder.at(-1) ?? 0,
            );
            expect(fixture.registered.has(adapter.registration.id)).toBe(true);
            expect([...fixture.phases.values()]).toEqual(["active", "active"]);
            await expect(fixture.app.getDisplayState()).resolves.toEqual({
                availability: "ready",
                revision: 0,
                display: { formatMode: "system", timeZone: { mode: "system" } },
                debugEnabled: false,
            });
            await expect(fixture.app.getDebugState()).resolves.toEqual({
                availability: "ready",
                revision: 0,
                enabled: false,
            });
            await expect(fixture.app.getPopupState()).resolves.toMatchObject({
                availability: "ready",
                revision: 0,
                globalEnabled: true,
                hostname: "github.com",
                siteEnabled: true,
                hasAdapter: true,
                status: "active",
            });
        },
    );

    it("preserves settings, diagnostics, and tabs after a rejected reset", async () => {
        const display: DisplaySettings = {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm",
            timeZone: { mode: "iana", identifier: "America/New_York" },
        };
        const initial = settingsV5(
            13,
            true,
            { "github.com": true, "managed.test": false },
            display,
            true,
        );
        const fixture = realAppWith(initial);
        await fixture.app.ensureReady();
        fixture.poisonDiagnostics({
            entries: [
                {
                    category: "mutation",
                    timestamp: 3,
                    hostname: "github.com",
                    pageCategory: "repository",
                    incognito: false,
                },
            ],
        });
        const beforeDiagnostics = fixture.diagnostics;
        const beforePrevious = fixture.previous;
        const beforeRemovals = fixture.storage.remove.mock.calls.length;
        const beforeReconciles = fixture.coordinator.reconcile.mock.calls.length;
        fixture.storage.set.mockRejectedValueOnce(new Error("disk full"));

        await expect(fixture.app.resetAllSettings()).resolves.toMatchObject({
            ok: false,
            error: "save-failed",
            state: { availability: "ready", revision: 13, globalEnabled: true },
        });
        expect(fixture.stored).toBe(initial);
        expect(fixture.previous).toBe(beforePrevious);
        expect(fixture.diagnostics).toBe(beforeDiagnostics);
        expect(fixture.storage.remove).toHaveBeenCalledTimes(beforeRemovals);
        expect(fixture.coordinator.reconcile).toHaveBeenCalledTimes(beforeReconciles);
        expect([...fixture.phases.values()]).toEqual(["active", "active"]);
        await expect(fixture.app.getDebugState()).resolves.toEqual({
            availability: "ready",
            revision: 13,
            enabled: true,
        });
        await expect(fixture.app.getDisplayState()).resolves.toEqual({
            availability: "ready",
            revision: 13,
            display,
            debugEnabled: true,
        });
    });

    it("does not broadcast debug policy after rejected persistence", async () => {
        const fixture = realAppWith();
        await fixture.app.ensureReady();
        fixture.tabs.sendMessage.mockClear();
        fixture.storage.set.mockRejectedValueOnce(new Error("settings unavailable"));
        await expect(fixture.app.setDebugEnabled(true)).resolves.toMatchObject({
            ok: false,
            error: "save-failed",
            state: { availability: "ready", revision: 0, enabled: false },
        });
        expect(fixture.diagnostics).toBeUndefined();
        expect(fixture.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it("commits display settings and requires an exact top-frame acknowledgement", async () => {
        const { app, tabs, storage } = appWith();
        await app.getPopupState();
        const result = await app.setDisplaySettings({
            formatMode: "system",
            timeZone: { mode: "utc" },
        });
        expect(result).toMatchObject({
            ok: true,
            acceptedRevision: 1,
            state: { revision: 1, display: { timeZone: { mode: "utc" } } },
            refreshFailures: [],
        });
        expect(tabs.sendMessage).toHaveBeenCalledWith(
            5,
            {
                type: UPDATE_PRESENTATION_MESSAGE,
                revision: 1,
                display: { formatMode: "system", timeZone: { mode: "utc" } },
            },
            { frameId: 0 },
        );
        expect(storage.set).toHaveBeenCalledTimes(1);
    });

    it("keeps display commit when tab acknowledgements are malformed", async () => {
        const { app, tabs } = appWith();
        await app.getPopupState();
        tabs.sendMessage.mockImplementation(async (_tabId: number, message?: unknown) => {
            if (
                message &&
                typeof message === "object" &&
                "type" in message &&
                message.type === UPDATE_PRESENTATION_MESSAGE
            ) {
                return { type: "wrong", revision: 1 };
            }
            return { type: DOCUMENT_STATUS_MESSAGE, phase: "active" };
        });
        await expect(
            app.setDisplaySettings({ formatMode: "system", timeZone: { mode: "utc" } }),
        ).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 1,
            refreshFailures: [{ hostname: "github.com", tabId: 5, reason: "tab-update" }],
        });
    });

    it("rejects invalid or unsupported display drafts without fanout", async () => {
        const { app, tabs, storage } = appWith();
        await app.getPopupState();
        await expect(
            app.setDisplaySettings({
                formatMode: "system",
                timeZone: { mode: "iana", identifier: "../UTC" },
            }),
        ).resolves.toMatchObject({
            ok: false,
            error: "invalid-display-settings",
            state: { revision: 0 },
        });
        expect(storage.set).not.toHaveBeenCalled();
        expect(
            tabs.sendMessage.mock.calls.some(
                ([, message]) =>
                    typeof message === "object" &&
                    message !== null &&
                    "type" in message &&
                    message.type === UPDATE_PRESENTATION_MESSAGE,
            ),
        ).toBe(false);
    });

    it("keeps a successful display commit when matching-tab enumeration fails", async () => {
        const { app, tabs } = appWith();
        await app.getPopupState();
        tabs.query.mockRejectedValueOnce(new Error("tabs unavailable"));
        await expect(
            app.setDisplaySettings({ formatMode: "system", timeZone: { mode: "utc" } }),
        ).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 1,
            refreshFailures: [{ hostname: "github.com", reason: "matching-tabs-query" }],
        });
    });

    it("persists a display save while global processing is disabled without tab work", async () => {
        const fixture = realAppWith();
        await fixture.app.setGlobalEnabled(false);
        fixture.tabs.query.mockClear();
        fixture.tabs.sendMessage.mockClear();
        fixture.storage.set.mockClear();
        await expect(
            fixture.app.setDisplaySettings({ formatMode: "system", timeZone: { mode: "utc" } }),
        ).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: { revision: 2, display: { timeZone: { mode: "utc" } } },
            refreshFailures: [],
        });
        expect(fixture.tabs.query).not.toHaveBeenCalled();
        expect(fixture.tabs.sendMessage).not.toHaveBeenCalled();
        expect(fixture.stored).toMatchObject({
            revision: 2,
            globalEnabled: false,
            display: { timeZone: { mode: "utc" } },
        });
    });

    it("persists a display save while the exact site is disabled without tab work", async () => {
        const fixture = realAppWith();
        await fixture.app.setSiteEnabled("github.com", false, "popup");
        fixture.tabs.query.mockClear();
        fixture.tabs.sendMessage.mockClear();
        fixture.storage.set.mockClear();
        await expect(
            fixture.app.setDisplaySettings({ formatMode: "system", timeZone: { mode: "utc" } }),
        ).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: { revision: 2, display: { timeZone: { mode: "utc" } } },
            refreshFailures: [],
        });
        expect(fixture.tabs.query).not.toHaveBeenCalled();
        expect(fixture.tabs.sendMessage).not.toHaveBeenCalled();
        expect(fixture.stored).toMatchObject({
            revision: 2,
            globalEnabled: true,
            sitePreferences: { "github.com": false },
            display: { timeZone: { mode: "utc" } },
        });
    });

    it("does not fan out an unchanged display draft", async () => {
        const fixture = realAppWith();
        await fixture.app.getDisplayState();
        fixture.tabs.query.mockClear();
        fixture.tabs.sendMessage.mockClear();
        fixture.storage.set.mockClear();
        await expect(
            fixture.app.setDisplaySettings({ formatMode: "system", timeZone: { mode: "system" } }),
        ).resolves.toMatchObject({ ok: true, acceptedRevision: 0, refreshFailures: [] });
        expect(fixture.storage.set).not.toHaveBeenCalled();
        expect(fixture.tabs.query).not.toHaveBeenCalled();
        expect(fixture.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it("rejects an invalid custom format before persistence or tab work", async () => {
        const fixture = realAppWith();
        await fixture.app.getDisplayState();
        fixture.storage.set.mockClear();
        fixture.tabs.query.mockClear();
        fixture.tabs.sendMessage.mockClear();
        await expect(
            fixture.app.setDisplaySettings({
                formatMode: "custom",
                pattern: "YYYY-MM-dd",
                timeZone: { mode: "utc" },
            }),
        ).resolves.toMatchObject({
            ok: false,
            error: "invalid-format",
            state: {
                availability: "ready",
                revision: 0,
                display: { formatMode: "system", timeZone: { mode: "system" } },
            },
        });
        expect(fixture.storage.set).not.toHaveBeenCalled();
        expect(fixture.tabs.query).not.toHaveBeenCalled();
        expect(fixture.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it("reports a saved unavailable zone without failing closed", async () => {
        const fixture = realAppWith(
            settingsV5(
                4,
                true,
                {},
                { formatMode: "system", timeZone: { mode: "iana", identifier: "Mars/Olympus" } },
            ),
        );
        await expect(fixture.app.getDisplayState()).resolves.toEqual({
            availability: "ready",
            revision: 4,
            display: {
                formatMode: "system",
                timeZone: { mode: "iana", identifier: "Mars/Olympus" },
            },
            debugEnabled: false,
            error: "unavailable-time-zone",
        });
        expect(fixture.app.phase).toBe("ready");
    });

    it("serializes global, site, and display writes without losing V3 fields", async () => {
        const fixture = appWith();
        const [global, site, display] = await Promise.all([
            fixture.app.setGlobalEnabled(false),
            fixture.app.setSiteEnabled("github.com", false, "popup"),
            fixture.app.setDisplaySettings({ formatMode: "system", timeZone: { mode: "utc" } }),
        ]);
        expect(global).toMatchObject({ ok: true, acceptedRevision: 1 });
        expect(site).toMatchObject({ ok: true, acceptedRevision: 2 });
        expect(display as SetDisplaySettingsResponse).toMatchObject({
            ok: true,
            acceptedRevision: 3,
        });
        expect(fixture.storage.read()).toEqual(
            settingsV5(
                3,
                false,
                { "github.com": false },
                { formatMode: "system", timeZone: { mode: "utc" } },
            ),
        );
    });

    it("serializes accepted settings changes and returns a revisioned state", async () => {
        const { app } = appWith();
        const first = await app.setGlobalEnabled(false);
        const second = await app.setGlobalEnabled(true);
        expect(first).toMatchObject({ ok: true, acceptedRevision: 1 });
        expect(second).toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: { revision: 2, globalEnabled: true },
        });
    });

    it("places response barriers after already-reserved commands", async () => {
        let releaseFirst: (() => void) | undefined;
        const firstReconcile = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let calls = 0;
        const { app } = appWith(async (input) => {
            calls += 1;
            if (input.mode === "settings-change" && calls === 2) {
                await firstReconcile;
            }
            return { ...input, failures: [], registration: {}, tabs: [] };
        });
        const off = app.setGlobalEnabled(false);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const on = app.setGlobalEnabled(true);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(calls).toBe(2);
        releaseFirst?.();
        const [offResult, onResult] = await Promise.all([off, on]);
        expect(offResult).toMatchObject({
            ok: true,
            acceptedRevision: 1,
            state: { revision: 2, globalEnabled: true },
        });
        expect(onResult).toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: { revision: 2, globalEnabled: true },
        });
    });

    it("returns save failure without reconciling the rejected command", async () => {
        const { app, storage, coordinator } = appWith();
        await app.getPopupState();
        storage.set.mockRejectedValueOnce(new Error("write failed"));
        const before = coordinator.reconcile.mock.calls.length;
        await expect(app.setGlobalEnabled(false)).resolves.toMatchObject({
            ok: false,
            error: "save-failed",
            state: { globalEnabled: true },
        });
        expect(coordinator.reconcile.mock.calls.length).toBe(before);
    });

    it("keeps tabs and response barriers at the final deferred off/on revision", async () => {
        let stored: unknown;
        let previous: unknown;
        let releaseRevisionOne: (() => void) | undefined;
        const revisionOneGate = new Promise<void>((resolve) => {
            releaseRevisionOne = resolve;
        });
        let revisionOneEntered: (() => void) | undefined;
        const revisionOneStarted = new Promise<void>((resolve) => {
            revisionOneEntered = resolve;
        });
        const phases = new Map<number, "active" | "stopped">([
            [7, "active"],
            [8, "active"],
        ]);
        let rejectSiblingInjection = true;
        const storage = {
            get: vi.fn(async () =>
                stored === undefined && previous === undefined
                    ? {}
                    : { [SETTINGS_STORAGE_KEY]: stored, [SETTINGS_PREVIOUS_STORAGE_KEY]: previous },
            ),
            set: vi.fn(async (items: Record<string, unknown>) => {
                stored = items[SETTINGS_STORAGE_KEY];
                previous = items[SETTINGS_PREVIOUS_STORAGE_KEY];
            }),
        };
        const registered = new Map<string, typeof adapter.registration>();
        const scripting = {
            getRegisteredContentScripts: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.flatMap((id) => (registered.has(id) ? [{ ...registered.get(id)! }] : [])),
            ),
            registerContentScripts: vi.fn(async (scripts: (typeof adapter.registration)[]) => {
                for (const script of scripts) {
                    registered.set(script.id, script);
                }
            }),
            updateContentScripts: vi.fn(async (scripts: (typeof adapter.registration)[]) => {
                for (const script of scripts) {
                    registered.set(script.id, script);
                }
            }),
            unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => {
                for (const id of ids) {
                    registered.delete(id);
                }
            }),
            executeScript: vi.fn(
                async ({ target }: { target: { tabId: number; allFrames: false } }) => {
                    if (target.tabId === 8 && rejectSiblingInjection) {
                        rejectSiblingInjection = false;
                        throw new Error("sibling injection failed once");
                    }
                    phases.set(target.tabId, "active");
                },
            ),
        };
        const tabs = {
            query: vi.fn(async (query: { active?: boolean }) =>
                query.active
                    ? [{ id: 7, url: "https://github.com/example" }]
                    : [
                        { id: 7, url: "https://github.com/example" },
                        { id: 8, url: "https://github.com/other" },
                        { id: 9, url: "https://gist.github.com/other" },
                    ],
            ),
            sendMessage: vi.fn(async (tabId: number, message: unknown, options: { frameId: 0 }) => {
                expect(options).toEqual({ frameId: 0 });
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === DOCUMENT_STATUS_MESSAGE
                ) {
                    return { type: DOCUMENT_STATUS_MESSAGE, phase: phases.get(tabId) ?? "stopped" };
                }
                phases.set(tabId, "stopped");
                return { type: DOCUMENT_STATUS_MESSAGE, phase: "stopped" };
            }),
        };
        const runtime = new AdapterActivationCoordinator({ adapters: [adapter], scripting, tabs });
        const coordinator = {
            reconcile: vi.fn(
                async (input: {
                    revision: number | null;
                    mode: "cold-worker" | "activation-sweep" | "settings-change" | "failed-closed";
                    policy: "enabled" | "disabled" | "unknown";
                }) => {
                    if (input.mode === "settings-change" && input.revision === 1) {
                        revisionOneEntered?.();
                        await revisionOneGate;
                    }
                    return runtime.reconcile(input);
                },
            ),
        };
        const app = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator: coordinator as never,
            tabs,
            adapters: [adapter],
        });
        await app.getPopupState();
        const firstResult = app.reconcileResult;
        expect(firstResult?.failures).toContainEqual({
            scope: "tab",
            adapterId: "github",
            tabId: 8,
            action: "inject",
        });
        expect(firstResult?.tabs).toContainEqual({
            adapterId: "github",
            tabId: 7,
            action: "inject",
            ok: true,
        });
        const off = app.setGlobalEnabled(false);
        await revisionOneStarted;
        const on = app.setGlobalEnabled(true);
        expect(stored).toEqual(settingsV5(1, false));
        expect(
            coordinator.reconcile.mock.calls.filter(([input]) => input.revision === 2),
        ).toHaveLength(0);
        expect(coordinator.reconcile).toHaveBeenCalledWith({
            revision: 1,
            mode: "settings-change",
            policy: "disabled",
            sitePreferences: {},
        });
        releaseRevisionOne?.();
        const [offResult, onResult] = await Promise.all([off, on]);
        expect(stored).toEqual(settingsV5(2, true));
        expect(registered.has(adapter.registration.id)).toBe(true);
        expect(registered.get(adapter.registration.id)).toEqual(adapter.registration);
        expect(phases).toEqual(
            new Map([
                [7, "active"],
                [8, "active"],
            ]),
        );
        const executedTabIds = scripting.executeScript.mock.calls.map(
            ([input]) => (input as { target: { tabId: number } }).target.tabId,
        );
        expect(executedTabIds).toContain(7);
        expect(executedTabIds).toContain(8);
        expect(executedTabIds).not.toContain(9);
        expect(offResult).toMatchObject({
            ok: true,
            acceptedRevision: 1,
            state: { revision: 2, globalEnabled: true },
        });
        expect(onResult).toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: { revision: 2, globalEnabled: true },
        });
        expect(offResult.state).toMatchObject({ revision: 2, globalEnabled: true });
        expect(onResult.state).toMatchObject({ revision: 2, globalEnabled: true });
    });

    it("reconciles an unchanged command to recover runtime failures without writing", async () => {
        const { app, storage, coordinator } = appWith();
        await app.getPopupState();
        const beforeWrites = storage.set.mock.calls.length;
        const beforeReconciles = coordinator.reconcile.mock.calls.length;
        await expect(app.setGlobalEnabled(true)).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 0,
        });
        expect(storage.set.mock.calls.length).toBe(beforeWrites);
        expect(coordinator.reconcile.mock.calls.length).toBeGreaterThan(beforeReconciles);
    });

    it("coalesces lifecycle events before an early readiness read", async () => {
        let releaseLoad: ((value: Record<string, unknown>) => void) | undefined;
        const load = new Promise<Record<string, unknown>>((resolve) => {
            releaseLoad = resolve;
        });
        const storage = {
            get: vi.fn(() => load),
            set: vi.fn(async () => undefined),
        };
        const tabs = {
            query: vi.fn(async () => [{ id: 5, url: "https://github.com/example" }]),
            sendMessage: vi.fn(async () => ({ type: DOCUMENT_STATUS_MESSAGE, phase: "active" })),
        };
        const coordinator = {
            reconcile: vi.fn(
                async (input: {
                    revision: number | null;
                    mode: "cold-worker" | "activation-sweep" | "settings-change" | "failed-closed";
                    policy: "enabled" | "disabled" | "unknown";
                }) => ({ ...input, failures: [], registration: {}, tabs: [] }),
            ),
        };
        const app = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator: coordinator as never,
            tabs,
            adapters: [adapter],
        });
        const cold = app.ensureReady("cold-worker");
        const startup = app.requestLifecycle("startup");
        const installed = app.requestLifecycle("installed");
        const read = app.getPopupState();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(storage.get).toHaveBeenCalledTimes(1);
        releaseLoad?.({});
        await Promise.all([cold, startup, installed, read]);
        expect(coordinator.reconcile).toHaveBeenCalledTimes(1);
        expect(coordinator.reconcile).toHaveBeenCalledWith({
            revision: 0,
            mode: "activation-sweep",
            policy: "enabled",
            sitePreferences: {},
        });
    });

    it("avoids reinjection on restart and cleans disabled runtimes", async () => {
        let stored: unknown = settingsV5(4, true);
        const storage = {
            get: vi.fn(async () => ({ [SETTINGS_STORAGE_KEY]: stored })),
            set: vi.fn(async () => undefined),
        };
        const registered = new Map<string, typeof adapter.registration>([
            [adapter.registration.id, { ...adapter.registration }],
        ]);
        const scripting = {
            getRegisteredContentScripts: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.flatMap((id) => (registered.has(id) ? [{ ...registered.get(id)! }] : [])),
            ),
            registerContentScripts: vi.fn(async () => undefined),
            updateContentScripts: vi.fn(async () => undefined),
            unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => {
                ids.forEach((id) => registered.delete(id));
            }),
            executeScript: vi.fn(async () => undefined),
        };
        const tabs = {
            query: vi.fn(async () => [{ id: 5, url: "https://github.com/example" }]),
            sendMessage: vi.fn(async () => ({ type: DOCUMENT_STATUS_MESSAGE, phase: "active" })),
        };
        const coordinator = new AdapterActivationCoordinator({
            adapters: [adapter],
            scripting,
            tabs,
        });
        const first = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator,
            tabs,
            adapters: [adapter],
        });
        await first.getPopupState();
        const second = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator,
            tabs,
            adapters: [adapter],
        });
        await second.getPopupState();
        expect(scripting.updateContentScripts).not.toHaveBeenCalled();
        expect(scripting.executeScript).not.toHaveBeenCalled();

        stored = settingsV5(5, false);
        const disabled = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator,
            tabs,
            adapters: [adapter],
        });
        await disabled.getPopupState();
        expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({
            ids: [adapter.registration.id],
        });
        expect(tabs.sendMessage).toHaveBeenCalledWith(
            5,
            { type: TEARDOWN_DOCUMENT_MESSAGE },
            { frameId: 0 },
        );
    });

    it("coordinates site disable and reenable across two matching tabs", async () => {
        const fixture = realAppWith();
        await fixture.app.getPopupState();
        expect(fixture.phases).toEqual(
            new Map([
                [5, "active"],
                [6, "active"],
            ]),
        );
        const injectionsBeforeDisable = fixture.scripting.executeScript.mock.calls.length;
        await expect(
            fixture.app.setSiteEnabled("github.com", false, "popup"),
        ).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 1,
            state: { status: "site-disabled", siteEnabled: false, revision: 1 },
        });
        expect(fixture.registered.has(adapter.registration.id)).toBe(false);
        expect(fixture.phases).toEqual(
            new Map([
                [5, "stopped"],
                [6, "stopped"],
            ]),
        );
        expect(fixture.tabs.sendMessage).toHaveBeenCalledWith(
            5,
            { type: TEARDOWN_DOCUMENT_MESSAGE },
            { frameId: 0 },
        );
        expect(fixture.tabs.sendMessage).toHaveBeenCalledWith(
            6,
            { type: TEARDOWN_DOCUMENT_MESSAGE },
            { frameId: 0 },
        );
        await expect(
            fixture.app.setSiteEnabled("github.com", true, "sites"),
        ).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: {
                revision: 2,
                sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }],
            },
        });
        expect(fixture.registered.has(adapter.registration.id)).toBe(true);
        expect(fixture.phases).toEqual(
            new Map([
                [5, "active"],
                [6, "active"],
            ]),
        );
        expect(fixture.scripting.executeScript.mock.calls.length).toBeGreaterThan(
            injectionsBeforeDisable,
        );
        expect(await fixture.app.getPopupState()).toMatchObject({
            revision: 2,
            hostname: "github.com",
            siteEnabled: true,
            status: "active",
        });
    });

    it("refreshes every enabled exact-host GitHub tab without activation work", async () => {
        const fixture = realAppWith();
        await fixture.app.getPopupState();
        const registrationCalls =
            fixture.scripting.registerContentScripts.mock.calls.length +
            fixture.scripting.updateContentScripts.mock.calls.length +
            fixture.scripting.unregisterContentScripts.mock.calls.length;
        const result = await fixture.app.setDisplaySettings({
            formatMode: "system",
            timeZone: { mode: "utc" },
        });
        expect(result).toMatchObject({ ok: true, acceptedRevision: 1, refreshFailures: [] });
        const updates = fixture.tabs.sendMessage.mock.calls.filter(
            ([, message]) =>
                typeof message === "object" &&
                message !== null &&
                "type" in message &&
                message.type === UPDATE_PRESENTATION_MESSAGE,
        );
        expect(updates.map(([tabId]) => tabId)).toEqual([5, 6]);
        expect(updates.every(([, , options]) => options?.frameId === 0)).toBe(true);
        expect(
            fixture.scripting.registerContentScripts.mock.calls.length +
                fixture.scripting.updateContentScripts.mock.calls.length +
                fixture.scripting.unregisterContentScripts.mock.calls.length,
        ).toBe(registrationCalls);
        expect(
            fixture.tabs.sendMessage.mock.calls.some(
                ([tabId, message]) =>
                    tabId === 9 &&
                    typeof message === "object" &&
                    message !== null &&
                    "type" in message &&
                    message.type === UPDATE_PRESENTATION_MESSAGE,
            ),
        ).toBe(false);
    });

    it("records one tab-update failure but continues delivery to the sibling", async () => {
        const fixture = realAppWith();
        await fixture.app.getPopupState();
        fixture.tabs.sendMessage.mockImplementation(async (tabId: number, message: unknown) => {
            if (
                message &&
                typeof message === "object" &&
                "type" in message &&
                message.type === UPDATE_PRESENTATION_MESSAGE &&
                "revision" in message
            ) {
                return tabId === 5
                    ? { type: PRESENTATION_UPDATED_MESSAGE, revision: 0 }
                    : { type: PRESENTATION_UPDATED_MESSAGE, revision: 1 };
            }
            if (
                message &&
                typeof message === "object" &&
                "type" in message &&
                message.type === DOCUMENT_STATUS_MESSAGE
            ) {
                return {
                    type: DOCUMENT_STATUS_MESSAGE,
                    phase: fixture.phases.get(tabId) ?? "stopped",
                };
            }
            return { type: DOCUMENT_STATUS_MESSAGE, phase: "stopped" };
        });
        await expect(
            fixture.app.setDisplaySettings({ formatMode: "system", timeZone: { mode: "utc" } }),
        ).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 1,
            refreshFailures: [{ hostname: "github.com", tabId: 5, reason: "tab-update" }],
        });
        const updates = fixture.tabs.sendMessage.mock.calls.filter(
            ([, message]) =>
                typeof message === "object" &&
                message !== null &&
                "type" in message &&
                message.type === UPDATE_PRESENTATION_MESSAGE,
        );
        expect(updates.map(([tabId]) => tabId)).toEqual([5, 6]);
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["malformed", {}],
        ["wrong type", { type: "wrong", revision: 1 }],
        ["stale revision", { type: PRESENTATION_UPDATED_MESSAGE, revision: 0 }],
        ["future revision", { type: PRESENTATION_UPDATED_MESSAGE, revision: 2 }],
        ["extra keys", { type: PRESENTATION_UPDATED_MESSAGE, revision: 1, extra: true }],
        ["rejected", "reject"],
    ] as const)(
        "treats %s acknowledgement as a committed partial refresh",
        async (_name, acknowledgement) => {
            const fixture = realAppWith();
            await fixture.app.getPopupState();
            fixture.tabs.sendMessage.mockImplementation(async (tabId: number, message: unknown) => {
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === UPDATE_PRESENTATION_MESSAGE &&
                    "revision" in message
                ) {
                    if (tabId === 5) {
                        if (acknowledgement === "reject") {
                            throw new Error("document stopped");
                        }
                        return acknowledgement as never;
                    }
                    return { type: PRESENTATION_UPDATED_MESSAGE, revision: 1 };
                }
                if (
                    message &&
                    typeof message === "object" &&
                    "type" in message &&
                    message.type === DOCUMENT_STATUS_MESSAGE
                ) {
                    return {
                        type: DOCUMENT_STATUS_MESSAGE,
                        phase: fixture.phases.get(tabId) ?? "stopped",
                    };
                }
                return { type: DOCUMENT_STATUS_MESSAGE, phase: "stopped" };
            });
            await expect(
                fixture.app.setDisplaySettings({ formatMode: "system", timeZone: { mode: "utc" } }),
            ).resolves.toMatchObject({
                ok: true,
                acceptedRevision: 1,
                state: { revision: 1, display: { timeZone: { mode: "utc" } } },
                refreshFailures: [{ hostname: "github.com", tabId: 5, reason: "tab-update" }],
            });
            const updates = fixture.tabs.sendMessage.mock.calls.filter(
                ([, message]) =>
                    typeof message === "object" &&
                    message !== null &&
                    "type" in message &&
                    message.type === UPDATE_PRESENTATION_MESSAGE,
            );
            expect(updates.map(([tabId]) => tabId)).toEqual([5, 6]);
        },
    );

    it("keeps a disabled site across a cold-worker restart without activation", async () => {
        const fixture = realAppWith();
        await fixture.app.setSiteEnabled("github.com", false, "popup");
        const registerCalls = fixture.scripting.registerContentScripts.mock.calls.length;
        const updateCalls = fixture.scripting.updateContentScripts.mock.calls.length;
        const executeCalls = fixture.scripting.executeScript.mock.calls.length;
        const restarted = new BackgroundApplication({
            settings: new SettingsService(fixture.storage),
            coordinator: fixture.coordinator,
            tabs: fixture.tabs,
            adapters: [adapter],
        });
        await expect(restarted.getSitesState()).resolves.toEqual({
            availability: "ready",
            revision: 1,
            globalEnabled: true,
            sites: [{ hostname: "github.com", enabled: false, hasAdapter: true }],
        });
        expect(fixture.registered.has(adapter.registration.id)).toBe(false);
        expect(fixture.scripting.registerContentScripts.mock.calls.length).toBe(registerCalls);
        expect(fixture.scripting.updateContentScripts.mock.calls.length).toBe(updateCalls);
        expect(fixture.scripting.executeScript.mock.calls.length).toBe(executeCalls);
    });

    it("serializes global and site transactions at accepted revisions", async () => {
        const fixture = realAppWith();
        let releaseGlobal: (() => void) | undefined;
        let globalStarted: (() => void) | undefined;
        const globalGate = new Promise<void>((resolve) => {
            releaseGlobal = resolve;
        });
        const globalEntered = new Promise<void>((resolve) => {
            globalStarted = resolve;
        });
        fixture.coordinator.reconcile.mockImplementation(async (input) => {
            if (input.mode === "settings-change" && input.revision === 1) {
                globalStarted?.();
                await globalGate;
            }
            return fixture.runtime.reconcile(input);
        });
        const global = fixture.app.setGlobalEnabled(false);
        await globalEntered;
        const popup = fixture.app.setSiteEnabled("github.com", false, "popup");
        const sites = fixture.app.setSiteEnabled("example.test", false, "sites");
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(fixture.storage.set).toHaveBeenCalledTimes(1);
        expect(
            fixture.coordinator.reconcile.mock.calls.filter(
                ([input]) => input.revision === 2 || input.revision === 3,
            ),
        ).toHaveLength(0);
        releaseGlobal?.();
        const [globalResult, popupResult, sitesResult] = await Promise.all([global, popup, sites]);
        expect(globalResult).toMatchObject({
            ok: true,
            acceptedRevision: 1,
            state: { revision: 3, globalEnabled: false },
        });
        expect(popupResult).toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: { revision: 3, globalEnabled: false, siteEnabled: false },
        });
        expect(sitesResult).toMatchObject({
            ok: true,
            acceptedRevision: 3,
            state: { revision: 3, globalEnabled: false },
        });
        expect(fixture.stored).toEqual(
            settingsV5(3, false, { "github.com": false, "example.test": false }),
        );
    });

    it("preserves scoped cleanup failure when global-off edits do no runtime work", async () => {
        const fixture = realAppWith();
        await fixture.app.getPopupState();
        fixture.failTeardown.add(5);
        const globalOff = await fixture.app.setGlobalEnabled(false);
        expect(globalOff).toMatchObject({
            ok: true,
            state: { status: "runtime-failed", failure: "current-tab-teardown" },
        });
        const failure = { scope: "tab", adapterId: "github", tabId: 5, action: "teardown" };
        expect(fixture.app.reconcileResult?.failures).toContainEqual(failure);
        const reconciles = fixture.coordinator.reconcile.mock.calls.length;
        const tabCalls =
            fixture.tabs.query.mock.calls.length + fixture.tabs.sendMessage.mock.calls.length;
        await expect(
            fixture.app.setSiteEnabled("example.test", false, "sites"),
        ).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: { revision: 2, globalEnabled: false },
        });
        expect(fixture.coordinator.reconcile.mock.calls.length).toBe(reconciles);
        expect(fixture.app.reconcileResult?.failures).toContainEqual(failure);
        await expect(
            fixture.app.setSiteEnabled("EXAMPLE.TEST", true, "popup"),
        ).resolves.toMatchObject({
            ok: false,
            error: "invalid-hostname",
            state: {
                revision: 2,
                globalEnabled: false,
                hostname: "github.com",
                status: "runtime-failed",
                failure: "current-tab-teardown",
            },
        });
        expect(
            fixture.tabs.query.mock.calls.length + fixture.tabs.sendMessage.mock.calls.length,
        ).toBe(tabCalls);
    });

    it("fails closed on invalid storage without adopting a retry default", async () => {
        let value: unknown = { schemaVersion: 99, revision: 1, globalEnabled: true };
        const storage = {
            get: vi.fn(async () => (value === undefined ? {} : { [SETTINGS_STORAGE_KEY]: value })),
            set: vi.fn(async () => undefined),
        };
        const tabs = {
            query: vi.fn(async () => [{ id: 5, url: "https://github.com/example" }]),
            sendMessage: vi.fn(async () => ({ type: DOCUMENT_STATUS_MESSAGE, phase: "active" })),
        };
        const coordinator = {
            reconcile: vi.fn(
                async (input: {
                    revision: number | null;
                    mode: "cold-worker" | "activation-sweep" | "settings-change" | "failed-closed";
                    policy: "enabled" | "disabled" | "unknown";
                }) => ({
                    ...input,
                    failures:
                        input.mode === "failed-closed"
                            ? [
                                {
                                    scope: "tab",
                                    adapterId: "github",
                                    tabId: 5,
                                    action: "teardown" as const,
                                },
                            ]
                            : [],
                    registration: {},
                    tabs: [],
                }),
            ),
        };
        const app = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator: coordinator as never,
            tabs,
            adapters: [adapter],
        });
        const unavailable = await app.getPopupState();
        expect(unavailable).toMatchObject({
            availability: "unavailable",
            status: "runtime-failed",
            failure: "fail-closed-cleanup",
        });
        value = undefined;
        await app.requestLifecycle("startup");
        expect(app.phase).toBe("failed-closed");
        expect(coordinator.reconcile).toHaveBeenCalledTimes(2);
        expect(
            coordinator.reconcile.mock.calls.every(([input]) => input.mode === "failed-closed"),
        ).toBe(true);
    });

    it("resets a failed-closed pair once and reactivates the default policy", async () => {
        let current: unknown = { schemaVersion: 99, revision: 1, globalEnabled: true };
        let previous: unknown = { broken: true };
        const storage = {
            get: vi.fn(async () => ({
                [SETTINGS_STORAGE_KEY]: current,
                [SETTINGS_PREVIOUS_STORAGE_KEY]: previous,
            })),
            set: vi.fn(async (items: Record<string, unknown>) => {
                current = items[SETTINGS_STORAGE_KEY];
                previous = items[SETTINGS_PREVIOUS_STORAGE_KEY];
            }),
        };
        const tabs = {
            query: vi.fn(async () => [{ id: 5, url: "https://github.com/example" }]),
            sendMessage: vi.fn(async () => ({ type: DOCUMENT_STATUS_MESSAGE, phase: "active" })),
        };
        const coordinator = {
            reconcile: vi.fn(
                async (input: { revision: number | null; mode: string; policy: string }) => ({
                    ...input,
                    failures: [],
                    registration: {},
                    tabs: [],
                }),
            ),
        };
        const app = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator: coordinator as never,
            tabs,
            adapters: [adapter],
        });
        await expect(app.getSitesState()).resolves.toMatchObject({ availability: "unavailable" });
        const result = await app.resetAllSettings();
        expect(result).toMatchObject({
            ok: true,
            acceptedRevision: 0,
            state: {
                availability: "ready",
                revision: 0,
                globalEnabled: true,
                sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }],
            },
        });
        expect(storage.set).toHaveBeenCalledTimes(1);
        expect(current).toEqual(settingsV5(0, true));
        expect(previous).toEqual(settingsV5(0, true));
        expect(app.phase).toBe("ready");
    });

    it("reports a reset persistence failure without retrying or enabling defaults", async () => {
        const current: unknown = { schemaVersion: 99, revision: 1, globalEnabled: true };
        const previous: unknown = { broken: true };
        const storage = {
            get: vi.fn(async () => ({
                [SETTINGS_STORAGE_KEY]: current,
                [SETTINGS_PREVIOUS_STORAGE_KEY]: previous,
            })),
            set: vi.fn(async () => {
                throw new Error("write failed");
            }),
        };
        const tabs = {
            query: vi.fn(async () => [{ id: 5, url: "https://github.com/example" }]),
            sendMessage: vi.fn(async () => ({ type: DOCUMENT_STATUS_MESSAGE, phase: "active" })),
        };
        const coordinator = {
            reconcile: vi.fn(
                async (input: { revision: number | null; mode: string; policy: string }) => ({
                    ...input,
                    failures: [],
                    registration: {},
                    tabs: [],
                }),
            ),
        };
        const app = new BackgroundApplication({
            settings: new SettingsService(storage),
            coordinator: coordinator as never,
            tabs,
            adapters: [adapter],
        });
        await app.getSitesState();
        const cleanupCalls = coordinator.reconcile.mock.calls.length;
        const result = await app.resetAllSettings();
        expect(result).toMatchObject({
            ok: false,
            error: "save-failed",
            state: { availability: "unavailable" },
        });
        expect(storage.set).toHaveBeenCalledTimes(1);
        expect(current).toMatchObject({ schemaVersion: 99 });
        expect(previous).toEqual({ broken: true });
        expect(coordinator.reconcile.mock.calls.length).toBeGreaterThan(cleanupCalls);
        expect(app.phase).toBe("failed-closed");
    });

    it("preserves a healthy application when a direct reset write fails", async () => {
        const { app, storage, coordinator } = appWith();
        await app.getSitesState();
        const before = coordinator.reconcile.mock.calls.length;
        storage.set.mockRejectedValueOnce(new Error("write failed"));
        await expect(app.resetAllSettings()).resolves.toMatchObject({
            ok: false,
            error: "save-failed",
            state: { availability: "ready", revision: 0 },
        });
        expect(app.phase).toBe("ready");
        expect(coordinator.reconcile.mock.calls.length).toBe(before);
    });

    it.each([
        ["active-tab-query", undefined, "runtime-failed", "current-tab-query"],
        ["restricted", { id: 5 }, "inaccessible", undefined],
        ["no-rules", { id: 5, url: "https://example.test/" }, "no-rules", undefined],
        [
            "registration",
            { id: 5, url: "https://github.com/example" },
            "runtime-failed",
            "registration",
        ],
        [
            "matching-query",
            { id: 5, url: "https://github.com/example" },
            "runtime-failed",
            "matching-tabs-query",
        ],
        [
            "current-tab-inject",
            { id: 5, url: "https://github.com/example" },
            "runtime-failed",
            "current-tab-inject",
        ],
        [
            "current-tab-teardown",
            { id: 5, url: "https://github.com/example" },
            "runtime-failed",
            "current-tab-teardown",
        ],
        [
            "document-phase",
            { id: 5, url: "https://github.com/example" },
            "runtime-failed",
            "document-status",
        ],
    ] as const)(
        "applies status precedence for %s",
        async (kind, tab, expectedStatus, expectedFailure) => {
            const { app, tabs, coordinator } = appWith(async (input) => ({
                ...input,
                failures:
                    expectedFailure === undefined ||
                    ["current-tab-query", "document-status"].includes(expectedFailure)
                        ? []
                        : ([
                            {
                                scope:
                                      expectedFailure === "registration"
                                          ? "registration"
                                          : expectedFailure === "matching-tabs-query"
                                              ? "matching-tabs-query"
                                              : "tab",
                                ...(expectedFailure === "registration"
                                    ? { adapterId: "github", operation: "register" as const }
                                    : expectedFailure === "matching-tabs-query"
                                        ? { adapterId: "github" }
                                        : {
                                            adapterId: "github",
                                            tabId: 5,
                                            action:
                                                  expectedFailure === "current-tab-inject"
                                                      ? ("inject" as const)
                                                      : ("teardown" as const),
                                        }),
                            },
                        ] as never),
                registration: {},
                tabs: [],
            }));
            if (kind === "active-tab-query") {
                tabs.query.mockRejectedValue(new Error("query"));
            } else {
                tabs.query.mockResolvedValue([tab ?? { id: 5 }]);
            }
            if (kind === "document-phase") {
                tabs.sendMessage.mockResolvedValue({
                    type: DOCUMENT_STATUS_MESSAGE,
                    phase: "failed",
                });
            }
            await expect(app.getPopupState()).resolves.toMatchObject({
                status: expectedStatus,
                ...(expectedFailure ? { failure: expectedFailure } : {}),
            });
            if (kind === "current-tab-inject" || kind === "current-tab-teardown") {
                expect(coordinator.reconcile).toHaveBeenCalled();
            }
        },
    );

    it("clears current-tab failure after unchanged recovery", async () => {
        let failed = true;
        const { app, storage, coordinator } = appWith(async (input) => ({
            ...input,
            failures: failed
                ? [{ scope: "tab", adapterId: "github", tabId: 5, action: "inject" as const }]
                : [],
            registration: {},
            tabs: [],
        }));
        await expect(app.getPopupState()).resolves.toMatchObject({
            status: "runtime-failed",
            failure: "current-tab-inject",
        });
        const writes = storage.set.mock.calls.length;
        failed = false;
        await expect(app.setGlobalEnabled(true)).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 0,
            state: { revision: 0, status: "active", globalEnabled: true },
        });
        expect(storage.set.mock.calls.length).toBe(writes);
        expect(coordinator.reconcile.mock.calls.at(-1)?.[0]).toMatchObject({
            revision: 0,
            mode: "settings-change",
            policy: "enabled",
        });
    });

    it("persists exact GitHub disable/reenable and projects retained Sites rows", async () => {
        const { app, storage, coordinator, tabs } = appWith();
        await expect(app.getPopupState()).resolves.toMatchObject({
            status: "active",
            siteEnabled: true,
            hasAdapter: true,
        });
        const statusCallsBeforeDisable = tabs.sendMessage.mock.calls.length;
        await expect(app.setSiteEnabled("github.com", false, "popup")).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 1,
            state: { status: "site-disabled", siteEnabled: false, hasAdapter: true },
        });
        expect(storage.set).toHaveBeenCalledWith({
            settings: settingsV5(1, true, { "github.com": false }),
            [SETTINGS_PREVIOUS_STORAGE_KEY]: settingsV5(0, true),
        });
        expect(tabs.sendMessage.mock.calls.length).toBe(statusCallsBeforeDisable);
        await expect(app.setSiteEnabled("github.com", true, "sites")).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 2,
            state: {
                availability: "ready",
                revision: 2,
                sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }],
            },
        });
        expect(coordinator.reconcile.mock.calls.at(-1)?.[0]).toMatchObject({
            affectedHostnames: ["github.com"],
            sitePreferences: { "github.com": true },
        });
        expect(await app.getSitesState()).toEqual({
            availability: "ready",
            revision: 2,
            globalEnabled: true,
            sites: [{ hostname: "github.com", enabled: true, hasAdapter: true }],
        });
    });

    it("allows no-adapter exact host editing without activation or visit persistence", async () => {
        const { app, tabs, coordinator, storage } = appWith();
        tabs.query.mockResolvedValue([{ id: 5, url: "https://example.test:8443/path" }]);
        await expect(app.getPopupState()).resolves.toMatchObject({
            status: "no-rules",
            hostname: "example.test",
            siteEnabled: true,
            hasAdapter: false,
        });
        const reconciles = coordinator.reconcile.mock.calls.length;
        await expect(app.setSiteEnabled("example.test", false, "popup")).resolves.toMatchObject({
            ok: true,
            state: {
                status: "site-disabled",
                hostname: "example.test",
                siteEnabled: false,
                hasAdapter: false,
            },
        });
        expect(coordinator.reconcile.mock.calls.length).toBe(reconciles);
        expect(storage.set).toHaveBeenCalledTimes(1);
        expect(await app.getSitesState()).toMatchObject({
            sites: [
                { hostname: "example.test", enabled: false, hasAdapter: false },
                { hostname: "github.com", enabled: true, hasAdapter: true },
            ],
        });
    });

    it("prioritizes relevant cleanup failure while globally disabled", async () => {
        let failures: readonly unknown[] = [
            { scope: "tab", adapterId: "github", tabId: 5, action: "teardown" },
        ];
        const { app } = appWith(async (input) => ({
            ...input,
            failures: failures as never,
            registration: {},
            tabs: [],
        }));
        await app.getPopupState();
        await app.setGlobalEnabled(false);
        await expect(app.getPopupState()).resolves.toMatchObject({
            status: "runtime-failed",
            failure: "current-tab-teardown",
        });
        failures = [{ scope: "registration", adapterId: "other", operation: "get" }];
        await app.setGlobalEnabled(true);
        await app.setGlobalEnabled(false);
        await expect(app.getPopupState()).resolves.toMatchObject({ status: "global-disabled" });
    });

    it("rejects invalid hostnames without writes, reconciliation, or tab work", async () => {
        const { app, storage, coordinator, tabs } = appWith();
        const authoritative = await app.getPopupState();
        const writes = storage.set.mock.calls.length;
        const reconciles = coordinator.reconcile.mock.calls.length;
        const tabCalls = tabs.query.mock.calls.length + tabs.sendMessage.mock.calls.length;
        await expect(app.setSiteEnabled("EXAMPLE.TEST", false, "popup")).resolves.toEqual({
            ok: false,
            error: "invalid-hostname",
            surface: "popup",
            state: authoritative,
        });
        expect(storage.set.mock.calls.length).toBe(writes);
        expect(coordinator.reconcile.mock.calls.length).toBe(reconciles);
        expect(tabs.query.mock.calls.length + tabs.sendMessage.mock.calls.length).toBe(tabCalls);
    });

    it("rejects invalid popup intent directly from readiness state", async () => {
        const { app, storage, coordinator, tabs } = appWith();
        await app.ensureReady();
        const writes = storage.set.mock.calls.length;
        const reconciles = coordinator.reconcile.mock.calls.length;
        const tabCalls = tabs.query.mock.calls.length + tabs.sendMessage.mock.calls.length;
        await expect(app.setSiteEnabled("EXAMPLE.TEST", false, "popup")).resolves.toMatchObject({
            ok: false,
            error: "invalid-hostname",
            surface: "popup",
            state: {
                availability: "ready",
                revision: 0,
                globalEnabled: true,
                hostname: "github.com",
                siteEnabled: true,
                hasAdapter: true,
                status: "active",
            },
        });
        expect(storage.set.mock.calls.length).toBe(writes);
        expect(coordinator.reconcile.mock.calls.length).toBe(reconciles);
        expect(tabs.query.mock.calls.length + tabs.sendMessage.mock.calls.length).toBe(tabCalls);
    });

    it("refreshes popup cache before rejecting a later invalid intent", async () => {
        const { app, storage, coordinator, tabs } = appWith();
        await app.getPopupState();
        await expect(app.setSiteEnabled("github.com", false, "sites")).resolves.toMatchObject({
            ok: true,
            acceptedRevision: 1,
            surface: "sites",
            state: {
                revision: 1,
                sites: [{ hostname: "github.com", enabled: false, hasAdapter: true }],
            },
        });
        const writes = storage.set.mock.calls.length;
        const reconciles = coordinator.reconcile.mock.calls.length;
        const tabCalls = tabs.query.mock.calls.length + tabs.sendMessage.mock.calls.length;
        await expect(app.setSiteEnabled("EXAMPLE.TEST", true, "popup")).resolves.toEqual({
            ok: false,
            error: "invalid-hostname",
            surface: "popup",
            state: {
                availability: "ready",
                revision: 1,
                globalEnabled: true,
                hostname: "github.com",
                siteEnabled: false,
                hasAdapter: true,
                status: "site-disabled",
            },
        });
        await expect(app.setSiteEnabled("EXAMPLE.TEST", true, "sites")).resolves.toEqual({
            ok: false,
            error: "invalid-hostname",
            surface: "sites",
            state: {
                availability: "ready",
                revision: 1,
                globalEnabled: true,
                sites: [{ hostname: "github.com", enabled: false, hasAdapter: true }],
            },
        });
        expect(storage.set.mock.calls.length).toBe(writes);
        expect(coordinator.reconcile.mock.calls.length).toBe(reconciles);
        expect(tabs.query.mock.calls.length + tabs.sendMessage.mock.calls.length).toBe(tabCalls);
    });
});
