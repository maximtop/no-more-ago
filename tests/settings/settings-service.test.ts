/**
 * @file Exercises versioned settings persistence, recovery, and serialized updates.
 */

/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";
import { SettingsService } from "../../src/settings/settings-service";
import {
    DEFAULT_SETTINGS_SNAPSHOT,
    SETTINGS_PREVIOUS_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    isSettingsSnapshotV5,
    type DisplaySettings
} from "../../src/settings/snapshot";

const v5 = (revision = 0, globalEnabled = true, sitePreferences: Record<string, boolean> = {}, display: DisplaySettings = { formatMode: "system", timeZone: { mode: "system" } }, debugEnabled = false) => ({ schemaVersion: 5 as const, revision, globalEnabled, sitePreferences, display, debugEnabled });

/**
 * Creates observable in-memory storage for settings service tests.
 *
 * @param initial - Initial current snapshot value.
 * @param previous - Initial recovery snapshot value.
 * @returns - Storage double with inspection and replacement helpers.
 */
function storage(initial?: unknown, previous?: unknown) {
    let value = initial;
    let previousValue = previous;
    return {
        get: vi.fn(async () => ({
            ...(value === undefined ? {} : { [SETTINGS_STORAGE_KEY]: value }),
            ...(previousValue === undefined ? {} : { [SETTINGS_PREVIOUS_STORAGE_KEY]: previousValue })
        })),
        set: vi.fn(async (items: Record<string, unknown>) => {
            const current = items[SETTINGS_STORAGE_KEY];
            const backup = items[SETTINGS_PREVIOUS_STORAGE_KEY];
            if (Object.keys(items).length !== 2 || !isSettingsSnapshotV5(current) || !isSettingsSnapshotV5(backup)) {
                throw new Error("Expected one complete validated atomic settings pair");
            }
            value = current;
            previousValue = backup;
        }),
        remove: vi.fn(async () => undefined),
        pair: () => ({ current: value, previous: previousValue }),
        replace: (current: unknown, backup: unknown) => {
            value = current; previousValue = backup;
        }
    };
}

describe("SettingsService V5", () => {
    it("uses the default-off V5 snapshot only when storage is missing", async () => {
        await expect(new SettingsService(storage()).load()).resolves.toEqual({ ok: true, snapshot: DEFAULT_SETTINGS_SNAPSHOT, source: "default" });
    });

    it("stores a complete current/previous pair and serializes debug updates", async () => {
        const backend = storage(v5(2, false, { "github.com": false }, { formatMode: "system", timeZone: { mode: "utc" } }));
        const service = new SettingsService(backend);
        await service.load();
        await expect(service.setDebugEnabled(true)).resolves.toMatchObject({ ok: true, changed: true, snapshot: { schemaVersion: 5, revision: 3, debugEnabled: true, globalEnabled: false, sitePreferences: { "github.com": false } } });
        expect(backend.set).toHaveBeenCalledWith({ [SETTINGS_STORAGE_KEY]: v5(3, false, { "github.com": false }, { formatMode: "system", timeZone: { mode: "utc" } }, true), [SETTINGS_PREVIOUS_STORAGE_KEY]: v5(2, false, { "github.com": false }, { formatMode: "system", timeZone: { mode: "utc" } }) });
        await expect(service.setDebugEnabled(true)).resolves.toMatchObject({ ok: true, changed: false });
    });

    it("preserves debug state through every other mutation", async () => {
        const backend = storage(v5(1, true, {}, { formatMode: "system", timeZone: { mode: "system" } }, true));
        const service = new SettingsService(backend, SETTINGS_STORAGE_KEY, () => true);
        await service.load();
        await service.setGlobalEnabled(false);
        await service.setSiteEnabled("github.com", false);
        await service.setDisplaySettings({ formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } });
        expect(backend.pair().current).toMatchObject({ schemaVersion: 5, debugEnabled: true, globalEnabled: false, sitePreferences: { "github.com": false }, display: { formatMode: "custom" } });
    });

    it("rejects V4 and invalid debug values without storage work", async () => {
        await expect(new SettingsService(storage({ schemaVersion: 4 })).load()).resolves.toEqual({ ok: false, error: "invalid-settings" });
        const backend = storage(v5());
        const service = new SettingsService(backend);
        await expect(service.setDebugEnabled("true" as never)).resolves.toMatchObject({ ok: false });
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it("recovers a valid previous pair and resets to logging off", async () => {
        const previous = v5(8, false, { "github.com": false }, undefined, true);
        const backend = storage({ schemaVersion: 4 }, previous);
        const service = new SettingsService(backend);
        await expect(service.load()).resolves.toMatchObject({ ok: true, source: "recovered", snapshot: { revision: 8, debugEnabled: true } });
        await expect(service.resetAll()).resolves.toMatchObject({ ok: true, snapshot: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.pair()).toEqual({ current: DEFAULT_SETTINGS_SNAPSHOT, previous: DEFAULT_SETTINGS_SNAPSHOT });
    });

    it("fails closed on future schema and preserves the pair on write failure", async () => {
        const future = { schemaVersion: 6, revision: 3 };
        const previous = v5(2);
        const backend = storage(future, previous);
        await expect(new SettingsService(backend).load()).resolves.toEqual({ ok: false, error: "invalid-settings" });
        expect(backend.set).not.toHaveBeenCalled();
        const validBackend = storage(v5(2));
        const service = new SettingsService(validBackend);
        await service.load();
        validBackend.set.mockRejectedValueOnce(new Error("disk full"));
        await expect(service.setDebugEnabled(true)).resolves.toMatchObject({ ok: false, error: "persistence-failed", snapshot: { revision: 2, debugEnabled: false } });
    });
});

describe("SettingsService durable loading and backup recovery", () => {
    it("reads exactly the current/previous local keys and never persists a fresh default", async () => {
        const backend = storage();
        const service = new SettingsService(backend);

        await expect(service.load()).resolves.toEqual({ ok: true, snapshot: DEFAULT_SETTINGS_SNAPSHOT, source: "default" });
        expect(backend.get).toHaveBeenCalledOnce();
        expect(backend.get).toHaveBeenCalledWith([SETTINGS_STORAGE_KEY, SETTINGS_PREVIOUS_STORAGE_KEY]);
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.remove).not.toHaveBeenCalled();
        expect(service.loadedSnapshot).toBe(DEFAULT_SETTINGS_SNAPSHOT);
        expect(service.lastLoadError).toBeUndefined();
    });

    it.each([
        ["absent", undefined],
        ["corrupt", { schemaVersion: 4, revision: 9 }],
        ["future", { schemaVersion: 7, revision: 9 }]
    ])("accepts a valid current snapshot while ignoring its %s backup", async (_label, previous) => {
        const current = v5(6, false, { "github.com": false }, {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm",
            timeZone: { mode: "iana", identifier: "America/New_York" }
        }, true);
        const backend = storage(current, previous);

        await expect(new SettingsService(backend).load()).resolves.toEqual({ ok: true, snapshot: current, source: "stored" });
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it.each([
        ["absent", undefined],
        ["null", null],
        ["older unpublished", { schemaVersion: 4, revision: 7 }],
        ["incomplete current", { schemaVersion: 5, revision: 7 }],
        ["invalid debug", { ...v5(7), debugEnabled: "true" }],
        ["invalid hostname", { ...v5(7), sitePreferences: { "EXAMPLE.TEST": false } }],
        ["invalid display", { ...v5(7), display: { formatMode: "system", timeZone: { mode: "invalid" } } }]
    ])("restores a valid full backup after %s current data in exactly one atomic write", async (_label, current) => {
        const previous = v5(8, false, { "github.com": false, "example.test.": true }, {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm XXX",
            timeZone: { mode: "iana", identifier: "America/New_York" }
        }, true);
        const backend = storage(current, previous);
        const service = new SettingsService(backend);

        await expect(service.load()).resolves.toEqual({ ok: true, snapshot: previous, source: "recovered" });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.set).toHaveBeenCalledWith({ [SETTINGS_STORAGE_KEY]: previous, [SETTINGS_PREVIOUS_STORAGE_KEY]: previous });
        expect(backend.pair()).toEqual({ current: previous, previous });
        expect(service.loadedSnapshot).toEqual(previous);
        expect(service.lastLoadError).toBeUndefined();
    });

    it.each([6, 9, 99, Number.MAX_SAFE_INTEGER])("never downgrades future schema %i even when its backup is valid", async (schemaVersion) => {
        const future = { schemaVersion, revision: 12, globalEnabled: true };
        const previous = v5(5, false, { "github.com": false }, undefined, true);
        const backend = storage(future, previous);
        const service = new SettingsService(backend);

        await expect(service.load()).resolves.toEqual({ ok: false, error: "invalid-settings" });
        expect(backend.pair()).toEqual({ current: future, previous });
        expect(backend.set).not.toHaveBeenCalled();
        expect(service.loadedSnapshot).toBeUndefined();
        expect(service.lastLoadError).toBe("invalid-settings");
    });

    it.each([
        ["invalid current and missing backup", { broken: true }, undefined],
        ["missing current and invalid backup", undefined, { broken: true }],
        ["two corrupt documents", { schemaVersion: 3 }, { schemaVersion: 4 }],
        ["two incomplete V5 documents", { schemaVersion: 5 }, { schemaVersion: 5, revision: 1 }],
        ["current V4 without backup", { schemaVersion: 4, revision: 2 }, undefined],
        ["valid-shaped backup with invalid debug", { schemaVersion: 4 }, { ...v5(3), debugEnabled: "yes" }]
    ])("fails closed for %s without replacing either document", async (_label, current, previous) => {
        const backend = storage(current, previous);
        const before = backend.pair();

        await expect(new SettingsService(backend).load()).resolves.toEqual({ ok: false, error: "invalid-settings" });
        expect(backend.pair()).toEqual(before);
        expect(backend.set).not.toHaveBeenCalled();
    });

    it("preserves both documents when restoring a valid backup cannot be persisted", async () => {
        const current = { schemaVersion: 4, revision: 7 };
        const previous = v5(8, false, { "github.com": false }, undefined, true);
        const backend = storage(current, previous);
        backend.set.mockRejectedValueOnce(new Error("disk full"));
        const service = new SettingsService(backend);

        await expect(service.load()).resolves.toEqual({ ok: false, error: "invalid-settings" });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.pair()).toEqual({ current, previous });
        expect(service.loadedSnapshot).toBeUndefined();
        expect(service.lastLoadError).toBe("invalid-settings");
    });

    it("reports an unreadable pair without adopting defaults or writing storage", async () => {
        const current = v5(4, false);
        const previous = v5(3, true);
        const backend = storage(current, previous);
        backend.get.mockRejectedValueOnce(new Error("storage unavailable"));
        const service = new SettingsService(backend);

        await expect(service.load()).resolves.toEqual({ ok: false, error: "load-failed" });
        expect(service.loadedSnapshot).toBeUndefined();
        expect(service.lastLoadError).toBe("load-failed");
        expect(backend.pair()).toEqual({ current, previous });
        expect(backend.set).not.toHaveBeenCalled();
    });

    it("rereads an externally replaced valid pair and clears a prior read failure", async () => {
        const backend = storage(v5(1));
        const service = new SettingsService(backend);
        backend.get.mockRejectedValueOnce(new Error("temporarily unavailable"));
        await expect(service.load()).resolves.toMatchObject({ ok: false, error: "load-failed" });
        const replacement = v5(9, false, { "github.com": false }, undefined, true);
        backend.replace(replacement, v5(8));

        await expect(service.readLatest()).resolves.toEqual({ ok: true, snapshot: replacement, source: "stored" });
        expect(service.loadedSnapshot).toEqual(replacement);
        expect(service.lastLoadError).toBeUndefined();
    });
});

describe("SettingsService global and exact-host policy", () => {
    it("atomically persists a fresh global change with its untouched default backup", async () => {
        const backend = storage();
        const service = new SettingsService(backend);

        await expect(service.setGlobalEnabled(false)).resolves.toEqual({
            ok: true,
            changed: true,
            snapshot: v5(1, false)
        });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.set).toHaveBeenCalledWith({ [SETTINGS_STORAGE_KEY]: v5(1, false), [SETTINGS_PREVIOUS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.pair()).toEqual({ current: v5(1, false), previous: DEFAULT_SETTINGS_SNAPSHOT });
    });

    it("preserves site, custom display, and debug preference across both global transitions", async () => {
        const custom: DisplaySettings = { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm", timeZone: { mode: "utc" } };
        const initial = v5(4, true, { "github.com": false, "example.test.": true }, custom, true);
        const backend = storage(initial, v5(3));
        const service = new SettingsService(backend);

        await expect(service.setGlobalEnabled(false)).resolves.toMatchObject({ ok: true, changed: true, snapshot: v5(5, false, initial.sitePreferences, custom, true) });
        await expect(service.setGlobalEnabled(true)).resolves.toMatchObject({ ok: true, changed: true, snapshot: v5(6, true, initial.sitePreferences, custom, true) });
        expect(backend.pair()).toEqual({ current: v5(6, true, initial.sitePreferences, custom, true), previous: v5(5, false, initial.sitePreferences, custom, true) });
        expect(backend.set).toHaveBeenCalledTimes(2);
    });

    it.each([true, false])("keeps an unchanged global=%s request entirely write-free", async (enabled) => {
        const current = v5(7, enabled, { "github.com": false }, undefined, true);
        const previous = v5(6, !enabled);
        const backend = storage(current, previous);

        await expect(new SettingsService(backend).setGlobalEnabled(enabled)).resolves.toEqual({ ok: true, changed: false, snapshot: current });
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it.each([undefined, null, 0, 1, "true", {}])("rejects invalid global value %# without reading or writing", async (enabled) => {
        const backend = storage(v5(2));

        await expect(new SettingsService(backend).setGlobalEnabled(enabled as never)).resolves.toMatchObject({ ok: false, error: "persistence-failed" });
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it("keeps parent, subdomain, sibling, and trailing-dot hostname policies independent", async () => {
        const backend = storage(v5(3, true, {}, undefined, true));
        const service = new SettingsService(backend);

        await service.setSiteEnabled("example.test", false);
        await service.setSiteEnabled("sub.example.test", true);
        await service.setSiteEnabled("sibling.example.test", false);
        await service.setSiteEnabled("example.test.", true);

        expect(backend.pair().current).toEqual(v5(7, true, {
            "example.test": false,
            "sub.example.test": true,
            "sibling.example.test": false,
            "example.test.": true
        }, undefined, true));
        expect(backend.set).toHaveBeenCalledTimes(4);
    });

    it("retains an explicit true preference even when the inherited default is enabled", async () => {
        const backend = storage(v5(2));
        const service = new SettingsService(backend);

        await expect(service.setSiteEnabled("github.com", true)).resolves.toEqual({ ok: true, changed: true, snapshot: v5(3, true, { "github.com": true }) });
        await expect(service.setSiteEnabled("github.com", true)).resolves.toEqual({ ok: true, changed: false, snapshot: v5(3, true, { "github.com": true }) });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.pair()).toEqual({ current: v5(3, true, { "github.com": true }), previous: v5(2) });
    });

    it("treats __proto__ and constructor as safe own exact-host keys", async () => {
        const backend = storage(v5(1));
        const service = new SettingsService(backend);

        await service.setSiteEnabled("__proto__", false);
        await service.setSiteEnabled("constructor", true);

        const result = backend.pair().current;
        if (!isSettingsSnapshotV5(result)) {
            throw new Error("Expected a complete V5 snapshot");
        }
        expect(Object.hasOwn(result.sitePreferences, "__proto__")).toBe(true);
        expect(Object.hasOwn(result.sitePreferences, "constructor")).toBe(true);
        expect(result.sitePreferences["__proto__"]).toBe(false);
        expect(result.sitePreferences.constructor).toBe(true);
        expect(Object.getPrototypeOf(result.sitePreferences)).toBe(Object.prototype);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it.each([
        "",
        "EXAMPLE.TEST",
        "bücher.example",
        "example.test:443",
        "https://example.test",
        "user@example.test",
        "example.test/path",
        "example.test?query=secret",
        "example.test#fragment",
        "*.example.test",
        "example.test..",
        " example.test",
        "example.test "
    ])("rejects non-canonical exact hostname %j with zero storage operations", async (hostname) => {
        const backend = storage(v5(2));

        await expect(new SettingsService(backend).setSiteEnabled(hostname, false)).resolves.toMatchObject({ ok: false, error: "invalid-hostname" });
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 0, "false", {}])("rejects invalid exact-host preference value %# before storage access", async (enabled) => {
        const backend = storage(v5(2));

        await expect(new SettingsService(backend).setSiteEnabled("github.com", enabled as never)).resolves.toMatchObject({ ok: false, error: "invalid-hostname" });
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it.each([false, true])("does not rewrite an already-explicit site=%s preference", async (enabled) => {
        const current = v5(4, true, { "github.com": enabled }, undefined, true);
        const previous = v5(3);
        const backend = storage(current, previous);

        await expect(new SettingsService(backend).setSiteEnabled("github.com", enabled)).resolves.toEqual({ ok: true, changed: false, snapshot: current });
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });
});

describe("SettingsService system/custom presentation and diagnostics settings", () => {
    it.each([
        ["system", { mode: "system" as const }],
        ["UTC", { mode: "utc" as const }],
        ["one-component CET", { mode: "iana" as const, identifier: "CET" }],
        ["one-component Japan", { mode: "iana" as const, identifier: "Japan" }],
        ["one-component Iceland", { mode: "iana" as const, identifier: "Iceland" }],
        ["slash-separated America/New_York", { mode: "iana" as const, identifier: "America/New_York" }]
    ])("persists the valid %s time-zone selection without losing policy/debug state", async (_label, timeZone) => {
        const initialDisplay: DisplaySettings = { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } };
        const initial = v5(4, false, { "github.com": false }, initialDisplay, true);
        const backend = storage(initial);
        const available = vi.fn(() => true);
        const service = new SettingsService(backend, SETTINGS_STORAGE_KEY, available);
        const display: DisplaySettings = { formatMode: "system", timeZone };

        await expect(service.setDisplaySettings(display)).resolves.toEqual({ ok: true, changed: true, snapshot: v5(5, false, { "github.com": false }, display, true) });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.pair()).toEqual({ current: v5(5, false, { "github.com": false }, display, true), previous: initial });
        if (timeZone.mode === "iana") {
            expect(available).toHaveBeenCalledWith(timeZone.identifier);
        } else {
            expect(available).not.toHaveBeenCalled();
        }
    });

    it("preserves a valid custom pattern and selected IANA zone in the full atomic pair", async () => {
        const initial = v5(8, false, { "github.com": false, "example.test": true }, undefined, true);
        const custom: DisplaySettings = {
            formatMode: "custom",
            pattern: "EEEE, d MMMM yyyy HH:mm XXX",
            timeZone: { mode: "iana", identifier: "America/New_York" }
        };
        const backend = storage(initial, v5(7));

        await expect(new SettingsService(backend, SETTINGS_STORAGE_KEY, () => true).setDisplaySettings(custom)).resolves.toEqual({
            ok: true,
            changed: true,
            snapshot: v5(9, false, initial.sitePreferences, custom, true)
        });
        expect(backend.pair()).toEqual({ current: v5(9, false, initial.sitePreferences, custom, true), previous: initial });
    });

    it.each([
        "",
        "YYYY-MM-dd",
        "yyyy-DD",
        "yyyy ff",
        "'literal only'",
        "yyyy 'unfinished",
        "yyyy\nMM",
        "y".repeat(257)
    ])("rejects unsafe custom format %# as invalid-format before touching either snapshot", async (pattern) => {
        const current = v5(4, false, { "github.com": false }, undefined, true);
        const previous = v5(3);
        const backend = storage(current, previous);

        await expect(new SettingsService(backend).setDisplaySettings({ formatMode: "custom", pattern, timeZone: { mode: "utc" } }))
            .resolves.toMatchObject({ ok: false, error: "invalid-format" });
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it.each([
        "",
        "../UTC",
        "America/../New_York",
        "America//New_York",
        "America\\New_York",
        " America/New_York",
        "America/New_York ",
        "America/New\nYork"
    ])("rejects structurally unsafe time zone %j without checking availability or storage", async (identifier) => {
        const backend = storage(v5(4));
        const available = vi.fn(() => true);

        await expect(new SettingsService(backend, SETTINGS_STORAGE_KEY, available).setDisplaySettings({
            formatMode: "system",
            timeZone: { mode: "iana", identifier }
        })).resolves.toMatchObject({ ok: false, error: "invalid-display-settings" });
        expect(available).not.toHaveBeenCalled();
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it("returns invalid-time-zone for a structurally valid but unavailable IANA identifier", async () => {
        const backend = storage(v5(5, false, { "github.com": false }, undefined, true));
        const available = vi.fn(() => false);

        await expect(new SettingsService(backend, SETTINGS_STORAGE_KEY, available).setDisplaySettings({
            formatMode: "system",
            timeZone: { mode: "iana", identifier: "Mars/Olympus" }
        })).resolves.toMatchObject({ ok: false, error: "invalid-time-zone" });
        expect(available).toHaveBeenCalledOnce();
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it.each([
        undefined,
        null,
        {},
        { formatMode: "system" },
        { formatMode: "system", timeZone: { mode: "utc" }, extra: true },
        { formatMode: "system", timeZone: { mode: "utc", identifier: "UTC" } },
        { formatMode: "unknown", timeZone: { mode: "utc" } },
        { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "unknown" } }
    ])("rejects malformed complete display candidate %# without persistence", async (display) => {
        const backend = storage(v5(2));

        await expect(new SettingsService(backend).setDisplaySettings(display)).resolves.toMatchObject({ ok: false, error: "invalid-display-settings" });
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it.each([
        { formatMode: "system" as const, timeZone: { mode: "utc" as const } },
        { formatMode: "system" as const, timeZone: { mode: "iana" as const, identifier: "America/New_York" } },
        { formatMode: "custom" as const, pattern: "yyyy-MM-dd", timeZone: { mode: "utc" as const } }
    ])("keeps an unchanged equivalent display %# write-free", async (display) => {
        const current = v5(6, false, { "github.com": false }, display, true);
        const previous = v5(5);
        const backend = storage(current, previous);

        await expect(new SettingsService(backend, SETTINGS_STORAGE_KEY, () => true).setDisplaySettings(structuredClone(display))).resolves.toEqual({
            ok: true,
            changed: false,
            snapshot: current
        });
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it.each([undefined, null, 0, 1, "true", {}])("rejects invalid debug value %# before reading or writing", async (enabled) => {
        const backend = storage(v5(3));

        await expect(new SettingsService(backend).setDebugEnabled(enabled as never)).resolves.toMatchObject({ ok: false, error: "invalid-debug" });
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it.each([true, false])("keeps an unchanged debug=%s preference and both existing documents", async (enabled) => {
        const current = v5(8, false, { "github.com": false }, undefined, enabled);
        const previous = v5(7);
        const backend = storage(current, previous);

        await expect(new SettingsService(backend).setDebugEnabled(enabled)).resolves.toEqual({ ok: true, changed: false, snapshot: current });
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it("atomically enables then disables debug without changing custom display or hostname policy", async () => {
        const custom: DisplaySettings = { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm", timeZone: { mode: "iana", identifier: "America/New_York" } };
        const initial = v5(2, false, { "github.com": false, "example.test": true }, custom);
        const backend = storage(initial);
        const service = new SettingsService(backend);

        await expect(service.setDebugEnabled(true)).resolves.toMatchObject({ ok: true, changed: true, snapshot: v5(3, false, initial.sitePreferences, custom, true) });
        await expect(service.setDebugEnabled(false)).resolves.toMatchObject({ ok: true, changed: true, snapshot: v5(4, false, initial.sitePreferences, custom, false) });
        expect(backend.set).toHaveBeenCalledTimes(2);
        expect(backend.pair()).toEqual({ current: v5(4, false, initial.sitePreferences, custom, false), previous: v5(3, false, initial.sitePreferences, custom, true) });
    });
});

const mutations = [
    ["global", (service: SettingsService) => service.setGlobalEnabled(false)],
    ["site", (service: SettingsService) => service.setSiteEnabled("github.com", false)],
    ["display", (service: SettingsService) => service.setDisplaySettings({ formatMode: "system", timeZone: { mode: "utc" } })],
    ["debug", (service: SettingsService) => service.setDebugEnabled(true)]
] as const;

describe("SettingsService atomic failure and concurrency boundaries", () => {
    it.each(mutations)("preserves both snapshots and memory after a rejected %s write", async (_label, mutate) => {
        const current = v5(4, true);
        const previous = v5(3, false, { "example.test": false });
        const backend = storage(current, previous);
        const service = new SettingsService(backend);
        await service.load();
        backend.set.mockRejectedValueOnce(new Error("disk full"));

        await expect(mutate(service)).resolves.toEqual({ ok: false, error: "persistence-failed", snapshot: current });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.pair()).toEqual({ current, previous });
        expect(service.loadedSnapshot).toEqual(current);
    });

    it.each(mutations)("fails a %s transaction closed when the pair becomes unreadable", async (_label, mutate) => {
        const current = v5(4, true);
        const previous = v5(3);
        const backend = storage(current, previous);
        const service = new SettingsService(backend);
        await service.load();
        backend.get.mockRejectedValueOnce(new Error("storage disconnected"));

        await expect(mutate(service)).resolves.toEqual({ ok: false, error: "persistence-failed", snapshot: current });
        expect(service.lastLoadError).toBe("load-failed");
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it.each(mutations)("rejects safe-integer revision overflow during a %s mutation without a write", async (_label, mutate) => {
        const current = v5(Number.MAX_SAFE_INTEGER, true);
        const previous = v5(Number.MAX_SAFE_INTEGER - 1);
        const backend = storage(current, previous);
        const service = new SettingsService(backend);

        await expect(mutate(service)).resolves.toEqual({ ok: false, error: "persistence-failed", snapshot: current });
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it("serializes overlapping global, site, custom-display, and debug intents without losing fields", async () => {
        const initial = v5(5, true);
        const backend = storage(initial, v5(4));
        const service = new SettingsService(backend, SETTINGS_STORAGE_KEY, () => true);
        const custom: DisplaySettings = { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm", timeZone: { mode: "iana", identifier: "America/New_York" } };

        const results = await Promise.all([
            service.setGlobalEnabled(false),
            service.setSiteEnabled("github.com", false),
            service.setDisplaySettings(custom),
            service.setDebugEnabled(true)
        ]);

        expect(results.map((result) => result.snapshot.revision)).toEqual([6, 7, 8, 9]);
        expect(results.every((result) => result.ok && result.changed)).toBe(true);
        expect(backend.set).toHaveBeenCalledTimes(4);
        expect(backend.pair()).toEqual({
            current: v5(9, false, { "github.com": false }, custom, true),
            previous: v5(8, false, { "github.com": false }, custom, false)
        });
        for (const [index, [items]] of backend.set.mock.calls.entries()) {
            expect(Object.keys(items).sort()).toEqual([SETTINGS_STORAGE_KEY, SETTINGS_PREVIOUS_STORAGE_KEY].sort());
            expect(items[SETTINGS_STORAGE_KEY]).toMatchObject({ revision: index + 6 });
            expect(items[SETTINGS_PREVIOUS_STORAGE_KEY]).toMatchObject({ revision: index + 5 });
        }
    });

    it("continues later queued transactions after an earlier atomic write rejects", async () => {
        const initial = v5(2, true);
        const backend = storage(initial, v5(1));
        backend.set.mockRejectedValueOnce(new Error("first write failed"));
        const service = new SettingsService(backend);

        const [failed, savedSite, savedDebug] = await Promise.all([
            service.setGlobalEnabled(false),
            service.setSiteEnabled("github.com", false),
            service.setDebugEnabled(true)
        ]);

        expect(failed).toEqual({ ok: false, error: "persistence-failed", snapshot: initial });
        expect(savedSite).toMatchObject({ ok: true, changed: true, snapshot: { revision: 3, globalEnabled: true, sitePreferences: { "github.com": false } } });
        expect(savedDebug).toMatchObject({ ok: true, changed: true, snapshot: { revision: 4, globalEnabled: true, debugEnabled: true } });
        expect(backend.pair()).toEqual({ current: v5(4, true, { "github.com": false }, undefined, true), previous: v5(3, true, { "github.com": false }) });
    });

    it("coalesces concurrent duplicate debug intents into one atomic write", async () => {
        const backend = storage(v5(2));
        const service = new SettingsService(backend);

        const [first, duplicate, last] = await Promise.all([
            service.setDebugEnabled(true),
            service.setDebugEnabled(true),
            service.setDebugEnabled(true)
        ]);

        expect(first).toMatchObject({ ok: true, changed: true, snapshot: { revision: 3, debugEnabled: true } });
        expect(duplicate).toMatchObject({ ok: true, changed: false, snapshot: { revision: 3, debugEnabled: true } });
        expect(last).toMatchObject({ ok: true, changed: false, snapshot: { revision: 3, debugEnabled: true } });
        expect(backend.set).toHaveBeenCalledOnce();
    });
});

describe("SettingsService explicit failed-closed reset", () => {
    it("replaces both corrupted documents with one complete default-off atomic pair", async () => {
        const backend = storage({ schemaVersion: 4, broken: true }, { schemaVersion: 2, broken: true });
        const service = new SettingsService(backend);
        await expect(service.load()).resolves.toMatchObject({ ok: false, error: "invalid-settings" });
        const reads = backend.get.mock.calls.length;

        await expect(service.resetAll()).resolves.toEqual({ ok: true, changed: true, snapshot: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.get.mock.calls.length).toBe(reads);
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.set).toHaveBeenCalledWith({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT, [SETTINGS_PREVIOUS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.pair()).toEqual({ current: DEFAULT_SETTINGS_SNAPSHOT, previous: DEFAULT_SETTINGS_SNAPSHOT });
        expect(service.loadedSnapshot).toBe(DEFAULT_SETTINGS_SNAPSHOT);
        expect(service.lastLoadError).toBeUndefined();
    });

    it("resets a valid custom/disabled/debug-on pair to exactly the system defaults", async () => {
        const custom: DisplaySettings = { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } };
        const backend = storage(v5(9, false, { "github.com": false }, custom, true), v5(8, false));
        const service = new SettingsService(backend);
        await service.load();

        await expect(service.resetAll()).resolves.toEqual({ ok: true, changed: true, snapshot: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.pair()).toEqual({ current: DEFAULT_SETTINGS_SNAPSHOT, previous: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.remove).not.toHaveBeenCalled();
    });

    it("atomically clears every retained hostname, custom IANA setting, and enabled diagnostics preference", async () => {
        const display: DisplaySettings = { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm XXX", timeZone: { mode: "iana", identifier: "America/New_York" } };
        const current = v5(17, false, { "github.com": false, "managed-enabled.test": true, "managed-disabled.test": false, "managed.test.": true }, display, true);
        const previous = v5(16, true, { "previous-only.test": false }, display, true);
        const backend = storage(current, previous);
        const service = new SettingsService(backend);
        await service.load();

        await expect(service.resetAll()).resolves.toEqual({ ok: true, changed: true, snapshot: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.set).toHaveBeenCalledWith({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT, [SETTINGS_PREVIOUS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.pair()).toEqual({ current: DEFAULT_SETTINGS_SNAPSHOT, previous: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.remove).not.toHaveBeenCalled();
    });

    it("preserves an unrecoverable pair and error when the reset write is rejected", async () => {
        const current = { schemaVersion: 4, broken: true };
        const previous = { schemaVersion: 3, broken: true };
        const backend = storage(current, previous);
        const service = new SettingsService(backend);
        await service.load();
        backend.set.mockRejectedValueOnce(new Error("disk full"));

        await expect(service.resetAll()).resolves.toEqual({ ok: false, error: "persistence-failed", snapshot: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.pair()).toEqual({ current, previous });
        expect(service.loadedSnapshot).toBeUndefined();
        expect(service.lastLoadError).toBe("invalid-settings");
    });

    it("preserves both healthy documents and the authoritative memory on a rejected reset", async () => {
        const current = v5(7, false, { "github.com": false }, undefined, true);
        const previous = v5(6);
        const backend = storage(current, previous);
        const service = new SettingsService(backend);
        await service.load();
        backend.set.mockRejectedValueOnce(new Error("disk full"));

        await expect(service.resetAll()).resolves.toEqual({ ok: false, error: "persistence-failed", snapshot: current });
        expect(backend.pair()).toEqual({ current, previous });
        expect(service.loadedSnapshot).toEqual(current);
    });

    it("queues a hostname edit behind an in-flight recovery reset", async () => {
        const backend = storage({ schemaVersion: 4 }, { schemaVersion: 2 });
        const originalSet = backend.set.getMockImplementation();
        if (!originalSet) {
            throw new Error("Expected genuine atomic fake storage");
        }
        let release: (() => void) | undefined;
        let entered: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        backend.set.mockImplementationOnce(async (items) => {
            entered?.();
            await gate;
            await originalSet(items);
        });
        const service = new SettingsService(backend);

        const reset = service.resetAll();
        await started;
        const edit = service.setSiteEnabled("github.com", false);
        await Promise.resolve();
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.pair()).toEqual({ current: { schemaVersion: 4 }, previous: { schemaVersion: 2 } });
        release?.();
        const [resetResult, editResult] = await Promise.all([reset, edit]);

        expect(resetResult).toEqual({ ok: true, changed: true, snapshot: DEFAULT_SETTINGS_SNAPSHOT });
        expect(editResult).toEqual({ ok: true, changed: true, snapshot: v5(1, true, { "github.com": false }) });
        expect(backend.pair()).toEqual({ current: v5(1, true, { "github.com": false }), previous: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.set).toHaveBeenCalledTimes(2);
    });

    it("queues a full reset behind accepted site/debug changes and clears both in order", async () => {
        const backend = storage(v5(3), v5(2));
        const service = new SettingsService(backend);

        const [site, enabled, reset] = await Promise.all([
            service.setSiteEnabled("github.com", false),
            service.setDebugEnabled(true),
            service.resetAll()
        ]);

        expect(site).toMatchObject({ ok: true, changed: true, snapshot: { revision: 4, sitePreferences: { "github.com": false } } });
        expect(enabled).toMatchObject({ ok: true, changed: true, snapshot: { revision: 5, debugEnabled: true } });
        expect(reset).toEqual({ ok: true, changed: true, snapshot: DEFAULT_SETTINGS_SNAPSHOT });
        expect(backend.set).toHaveBeenCalledTimes(3);
        expect(backend.pair()).toEqual({ current: DEFAULT_SETTINGS_SNAPSHOT, previous: DEFAULT_SETTINGS_SNAPSHOT });
    });
});
