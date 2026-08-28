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
} from "../../../src/shared/messages";
import {
    createSettingsSnapshot,
    SETTINGS_STORAGE_KEY,
} from "../../../src/shared/settings/snapshot";

/**
 * Creates an application with an in-memory settings store.
 *
 * @param initial - Values returned by the settings store.
 * @returns - Configured application facade.
 */
function application(initial: Record<string, unknown> = {}): BackgroundApplication {
    const storage = {
        get: vi.fn(async () => initial),
        set: vi.fn(async () => undefined),
    };
    const tabs: TabsRuntime = {
        query: vi.fn(async () => []),
        getAllFrames: vi.fn(async () => []),
        sendMessage: vi.fn(async () => undefined),
    };
    const result: ActivationReconcileResult = {
        revision: 0,
        policy: ACTIVATION_POLICY.ENABLED,
        failures: [],
        registration: REGISTRATION_OUTCOME.UNCHANGED,
        tabs: [],
    };
    const coordinator: BackgroundApplicationOptions["coordinator"] = {
        reconcile: vi.fn(async () => result),
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
            [SETTINGS_STORAGE_KEY]: createSettingsSnapshot(
                4,
                true,
                { "example.test": false },
            ),
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
            [SETTINGS_STORAGE_KEY]: createSettingsSnapshot(2, true, { [hostname]: false }),
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
        let stored: Record<string, unknown> = {};
        const storage = {
            get: vi.fn(() => Promise.resolve(stored)),
            set: vi.fn((items: Record<string, unknown>) => {
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
            sitePreferences: { "example.test": false },
            affectedHostnames: ["example.test"],
        });
    });
});
