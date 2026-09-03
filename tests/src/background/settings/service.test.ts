/**
 * @file Exercises versioned settings persistence, recovery, and serialized updates.
 */

/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";
import { SettingsService } from "../../../../src/background/settings/service";
import {
    APPEARANCE,
    DEFAULT_SETTINGS_SNAPSHOT,
    SETTINGS_PREVIOUS_STORAGE_KEY,
    SETTINGS_SCHEMA_VERSION,
    SETTINGS_STORAGE_KEY,
    createSettingsSnapshot,
    type DisplaySettings,
    type SettingsSnapshot,
} from "../../../../src/shared/settings/snapshot";
import {
    DEFAULT_SITE_SCOPE,
    MAX_SITE_LIST_ENTRIES,
    SITE_SCOPE_MODE,
    type SiteScopePolicy,
} from "../../../../src/shared/settings/site-scope";

const EXCLUDING = SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED;

const v6 = (
    revision = 0,
    globalEnabled = true,
    siteScope: SiteScopePolicy = DEFAULT_SITE_SCOPE,
    display: DisplaySettings = { formatMode: "system", timeZone: { mode: "system" } },
    debugEnabled = false,
): SettingsSnapshot =>
    createSettingsSnapshot({ revision, globalEnabled, siteScope, display, debugEnabled });

const excluding = (...hostnames: readonly string[]): SiteScopePolicy => ({
    mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
    excludedSites: hostnames,
    allowedSites: [],
});

/**
 * Creates observable in-memory storage for settings service tests.
 *
 * @param initial - Initial current snapshot value.
 * @param previous - Initial recovery snapshot value.
 * @returns - Storage double with inspection and replacement helpers.
 */
function storage(initial?: object, previous?: object) {
    let value: object | undefined = initial;
    let previousValue: object | undefined = previous;
    return {
        get: vi.fn(async () => ({
            ...(value === undefined ? {} : { [SETTINGS_STORAGE_KEY]: value }),
            ...(previousValue === undefined
                ? {}
                : { [SETTINGS_PREVIOUS_STORAGE_KEY]: previousValue }),
        })),
        set: vi.fn(async (items: Readonly<Record<string, SettingsSnapshot>>) => {
            value = items[SETTINGS_STORAGE_KEY];
            previousValue = items[SETTINGS_PREVIOUS_STORAGE_KEY];
        }),
        remove: vi.fn(async () => undefined),
        pair: () => ({ current: value, previous: previousValue }),
        replace: (current: SettingsSnapshot, backup: SettingsSnapshot) => {
            value = current;
            previousValue = backup;
        },
    };
}

describe("SettingsService", () => {
    it("uses the default-on snapshot only when storage is missing", async () => {
        await expect(new SettingsService(storage()).load()).resolves.toEqual({
            ok: true,
            snapshot: DEFAULT_SETTINGS_SNAPSHOT,
            source: "default",
        });
    });

    it("discards a snapshot written by another schema version and persists defaults", async () => {
        const legacy = { ...DEFAULT_SETTINGS_SNAPSHOT, schemaVersion: 5, revision: 9 };
        const backend = storage(legacy);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        await expect(new SettingsService(backend).load()).resolves.toEqual({
            ok: true,
            snapshot: DEFAULT_SETTINGS_SNAPSHOT,
            source: "discarded",
        });
        expect(backend.set).toHaveBeenCalledWith({
            [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT,
            [SETTINGS_PREVIOUS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT,
        });
        expect(warn).toHaveBeenCalledOnce();
    });

    it("fails closed when the discarded snapshot cannot be replaced", async () => {
        const legacy = { ...DEFAULT_SETTINGS_SNAPSHOT, schemaVersion: 5, revision: 9 };
        const backend = storage(legacy);
        backend.set.mockRejectedValueOnce(new Error("quota"));
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const service = new SettingsService(backend);

        await expect(service.load()).resolves.toEqual({ ok: false, error: "invalid-settings" });
        expect(service.lastLoadError).toBe("invalid-settings");
    });

    it("writes one hostname into the list the active mode owns", async () => {
        const backend = storage(v6(1, true, {
            mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
            excludedSites: [],
            allowedSites: ["kept.test"],
        }));
        const service = new SettingsService(backend);
        await service.load();

        const write = await service.setSiteEnabled("github.com", false, EXCLUDING);

        expect(write.ok).toBe(true);
        expect(write.snapshot.siteScope.excludedSites).toEqual(["github.com"]);
        expect(write.snapshot.siteScope.allowedSites).toEqual(["kept.test"]);
        expect(write.snapshot.revision).toBe(2);
        await expect(service.setSiteEnabled(
            "github.com",
            false,
            SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
        )).resolves.toMatchObject({ ok: true, changed: false });
    });

    it("refuses to grow a full list and keeps the snapshot unchanged", async () => {
        const excludedSites = Array.from({ length: MAX_SITE_LIST_ENTRIES }, (_, index) =>
            `host-${String(index)}.test`);
        const backend = storage(v6(3, true, {
            mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
            excludedSites,
            allowedSites: [],
        }));
        const service = new SettingsService(backend);
        await service.load();

        await expect(service.setSiteEnabled(
            "one-more.test",
            false,
            SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
        )).resolves.toMatchObject({
            ok: false,
            error: "list-full",
            snapshot: { revision: 3 },
        });
        expect(backend.set).not.toHaveBeenCalled();
        await expect(service.setSiteEnabled(
            "host-0.test",
            true,
            SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
        )).resolves.toMatchObject({ ok: true, changed: true });
    });

    it("rejects a hostname decision made under a scope mode that has since changed", async () => {
        const backend = storage(v6(1, true, {
            mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
            excludedSites: [],
            allowedSites: [],
        }));
        const service = new SettingsService(backend);
        await service.load();
        await service.setSiteScopeMode(SITE_SCOPE_MODE.SELECTED_ONLY);

        await expect(service.setSiteEnabled(
            "github.com",
            false,
            SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
        )).resolves.toMatchObject({
            ok: false,
            error: "scope-changed",
            snapshot: { revision: 2, siteScope: { excludedSites: [], allowedSites: [] } },
        });
        expect(backend.set).toHaveBeenCalledOnce();
    });

    it("changes the scope mode while retaining both lists", async () => {
        const backend = storage(v6(1, true, {
            mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED,
            excludedSites: ["excluded.test"],
            allowedSites: ["allowed.test"],
        }));
        const service = new SettingsService(backend);
        await service.load();

        const write = await service.setSiteScopeMode(SITE_SCOPE_MODE.SELECTED_ONLY);

        expect(write.ok && write.snapshot.siteScope).toEqual({
            mode: SITE_SCOPE_MODE.SELECTED_ONLY,
            excludedSites: ["excluded.test"],
            allowedSites: ["allowed.test"],
        });
        await expect(service.setSiteScopeMode(SITE_SCOPE_MODE.SELECTED_ONLY))
            .resolves.toMatchObject({ ok: true, changed: false });
    });

    it("persists the appearance on its own without touching display settings", async () => {
        const utc: DisplaySettings = { formatMode: "system", timeZone: { mode: "utc" } };
        const backend = storage(v6(1, true, undefined, utc));
        const service = new SettingsService(backend);
        await service.load();

        const write = await service.setAppearance(APPEARANCE.DARK);

        expect(write.ok).toBe(true);
        expect(write.snapshot.appearance).toBe(APPEARANCE.DARK);
        expect(write.snapshot.display).toEqual(utc);
        expect(write.snapshot.revision).toBe(2);
        await expect(service.setAppearance(APPEARANCE.DARK))
            .resolves.toMatchObject({ ok: true, changed: false });
    });

    it("stores a complete current/previous pair and serializes debug updates", async () => {
        const utc: DisplaySettings = { formatMode: "system", timeZone: { mode: "utc" } };
        const backend = storage(v6(2, false, excluding("github.com"), utc));
        const service = new SettingsService(backend);
        await service.load();
        await expect(service.setDebugEnabled(true)).resolves.toMatchObject({
            ok: true,
            changed: true,
            snapshot: {
                schemaVersion: SETTINGS_SCHEMA_VERSION,
                revision: 3,
                debugEnabled: true,
                globalEnabled: false,
                siteScope: { excludedSites: ["github.com"] },
            },
        });
        expect(backend.set).toHaveBeenCalledWith({
            [SETTINGS_STORAGE_KEY]: v6(3, false, excluding("github.com"), utc, true),
            [SETTINGS_PREVIOUS_STORAGE_KEY]: v6(2, false, excluding("github.com"), utc),
        });
        await expect(service.setDebugEnabled(true)).resolves.toMatchObject({
            ok: true,
            changed: false,
        });
    });

    it("preserves debug state through every other mutation", async () => {
        const backend = storage(v6(1, true, undefined, undefined, true));
        const service = new SettingsService(backend, SETTINGS_STORAGE_KEY, () => true);
        await service.load();
        await service.setGlobalEnabled(false);
        await service.setSiteEnabled("github.com", false, EXCLUDING);
        await service.setSiteScopeMode(SITE_SCOPE_MODE.SELECTED_ONLY);
        await service.setDisplaySettings({
            formatMode: "custom",
            pattern: "yyyy-MM-dd",
            timeZone: { mode: "utc" },
        });
        await service.setAppearance(APPEARANCE.LIGHT);
        expect(backend.pair().current).toMatchObject({
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            debugEnabled: true,
            globalEnabled: false,
            siteScope: { mode: SITE_SCOPE_MODE.SELECTED_ONLY, excludedSites: ["github.com"] },
            display: { formatMode: "custom" },
            appearance: APPEARANCE.LIGHT,
        });
    });

    it("recovers a previous snapshot when the current snapshot is absent", async () => {
        const previous = v6(8, false, excluding("github.com"), undefined, true);
        const backend = storage(undefined, previous);
        const service = new SettingsService(backend);
        await expect(service.load()).resolves.toMatchObject({
            ok: true,
            source: "recovered",
            snapshot: { revision: 8, debugEnabled: true },
        });
        await expect(service.resetAll()).resolves.toMatchObject({
            ok: true,
            snapshot: v6(9),
        });
        expect(backend.pair()).toEqual({
            current: v6(9),
            previous: v6(9),
        });
    });

    it("preserves the current snapshot when a write fails", async () => {
        const validBackend = storage(v6(2));
        const service = new SettingsService(validBackend);
        await service.load();
        validBackend.set.mockRejectedValueOnce(new Error("disk full"));
        await expect(service.setDebugEnabled(true)).resolves.toMatchObject({
            ok: false,
            error: "persistence-failed",
            snapshot: { revision: 2, debugEnabled: false },
        });
    });
});

describe("SettingsService durable loading and backup recovery", () => {
    it("reads current and previous keys without persisting a fresh default", async () => {
        const backend = storage();
        const service = new SettingsService(backend);

        await expect(service.load()).resolves.toEqual({
            ok: true,
            snapshot: DEFAULT_SETTINGS_SNAPSHOT,
            source: "default",
        });
        expect(backend.get).toHaveBeenCalledOnce();
        expect(backend.get).toHaveBeenCalledWith([
            SETTINGS_STORAGE_KEY,
            SETTINGS_PREVIOUS_STORAGE_KEY,
        ]);
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.remove).not.toHaveBeenCalled();
        expect(service.loadedSnapshot).toBe(DEFAULT_SETTINGS_SNAPSHOT);
        expect(service.lastLoadError).toBeUndefined();
    });

    it("accepts a valid current snapshot without rewriting its backup", async () => {
        const current = v6(
            6,
            false,
            excluding("github.com"),
            {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "iana", identifier: "America/New_York" },
            },
            true,
        );
        const previous = v6(5);
        const backend = storage(current, previous);

        await expect(new SettingsService(backend).load()).resolves.toEqual({
            ok: true,
            snapshot: current,
            source: "stored",
        });
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it("preserves both documents when restoring a valid backup cannot be persisted", async () => {
        const previous = v6(8, false, excluding("github.com"), undefined, true);
        const backend = storage(undefined, previous);
        backend.set.mockRejectedValueOnce(new Error("disk full"));
        const service = new SettingsService(backend);

        await expect(service.load()).resolves.toEqual({ ok: false, error: "invalid-settings" });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.pair()).toEqual({ current: undefined, previous });
        expect(service.loadedSnapshot).toBeUndefined();
        expect(service.lastLoadError).toBe("invalid-settings");
    });

    it("reports an unreadable pair without adopting defaults or writing storage", async () => {
        const current = v6(4, false);
        const previous = v6(3, true);
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
        const backend = storage(v6(1));
        const service = new SettingsService(backend);
        backend.get.mockRejectedValueOnce(new Error("temporarily unavailable"));
        await expect(service.load()).resolves.toMatchObject({ ok: false, error: "load-failed" });
        const replacement = v6(9, false, excluding("github.com"), undefined, true);
        backend.replace(replacement, v6(8));

        await expect(service.readLatest()).resolves.toEqual({
            ok: true,
            snapshot: replacement,
            source: "stored",
        });
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
            snapshot: v6(1, false),
        });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.set).toHaveBeenCalledWith({
            [SETTINGS_STORAGE_KEY]: v6(1, false),
            [SETTINGS_PREVIOUS_STORAGE_KEY]: DEFAULT_SETTINGS_SNAPSHOT,
        });
        expect(backend.pair()).toEqual({
            current: v6(1, false),
            previous: DEFAULT_SETTINGS_SNAPSHOT,
        });
    });

    it("preserves site, display, and debug settings across global transitions", async () => {
        const custom: DisplaySettings = {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm",
            timeZone: { mode: "utc" },
        };
        const scope: SiteScopePolicy = {
            mode: SITE_SCOPE_MODE.SELECTED_ONLY,
            excludedSites: ["github.com"],
            allowedSites: ["example.test."],
        };
        const initial = v6(4, true, scope, custom, true);
        const backend = storage(initial, v6(3));
        const service = new SettingsService(backend);

        await expect(service.setGlobalEnabled(false)).resolves.toMatchObject({
            ok: true,
            changed: true,
            snapshot: v6(5, false, scope, custom, true),
        });
        await expect(service.setGlobalEnabled(true)).resolves.toMatchObject({
            ok: true,
            changed: true,
            snapshot: v6(6, true, scope, custom, true),
        });
        expect(backend.pair()).toEqual({
            current: v6(6, true, scope, custom, true),
            previous: v6(5, false, scope, custom, true),
        });
        expect(backend.set).toHaveBeenCalledTimes(2);
    });

    it.each([true, false])(
        "keeps an unchanged global=%s request entirely write-free",
        async (enabled) => {
            const current = v6(7, enabled, excluding("github.com"), undefined, true);
            const previous = v6(6, !enabled);
            const backend = storage(current, previous);

            await expect(new SettingsService(backend).setGlobalEnabled(enabled)).resolves.toEqual({
                ok: true,
                changed: false,
                snapshot: current,
            });
            expect(backend.set).not.toHaveBeenCalled();
            expect(backend.pair()).toEqual({ current, previous });
        },
    );

    it("keeps related hostname policies independent", async () => {
        const backend = storage(v6(3, true, undefined, undefined, true));
        const service = new SettingsService(backend);

        await service.setSiteEnabled("example.test", false, EXCLUDING);
        await service.setSiteEnabled("sub.example.test", true, EXCLUDING);
        await service.setSiteEnabled("sibling.example.test", false, EXCLUDING);
        await service.setSiteEnabled("example.test.", false, EXCLUDING);

        expect(backend.pair().current).toEqual(
            v6(
                6,
                true,
                excluding("example.test", "sibling.example.test", "example.test."),
                undefined,
                true,
            ),
        );
        expect(backend.set).toHaveBeenCalledTimes(3);
    });

    it("adds an allowed hostname only once in selected-only mode", async () => {
        const selected: SiteScopePolicy = {
            mode: SITE_SCOPE_MODE.SELECTED_ONLY,
            excludedSites: [],
            allowedSites: [],
        };
        const backend = storage(v6(2, true, selected));
        const service = new SettingsService(backend);

        await expect(service.setSiteEnabled("github.com", true, SITE_SCOPE_MODE.SELECTED_ONLY))
            .resolves.toEqual({
                ok: true,
                changed: true,
                snapshot: v6(3, true, { ...selected, allowedSites: ["github.com"] }),
            });
        await expect(service.setSiteEnabled("github.com", true, SITE_SCOPE_MODE.SELECTED_ONLY))
            .resolves.toEqual({
                ok: true,
                changed: false,
                snapshot: v6(3, true, { ...selected, allowedSites: ["github.com"] }),
            });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.pair()).toEqual({
            current: v6(3, true, { ...selected, allowedSites: ["github.com"] }),
            previous: v6(2, true, selected),
        });
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
        "example.test ",
    ])("rejects non-canonical exact hostname %j with zero storage operations", async (hostname) => {
        const backend = storage(v6(2));

        await expect(
            new SettingsService(backend).setSiteEnabled(hostname, false, EXCLUDING),
        ).resolves.toMatchObject({ ok: false, error: "invalid-hostname" });
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        "does not rewrite an already-effective site=%s decision",
        async (enabled) => {
            const current = v6(
                4,
                true,
                enabled ? DEFAULT_SITE_SCOPE : excluding("github.com"),
                undefined,
                true,
            );
            const previous = v6(3);
            const backend = storage(current, previous);

            await expect(
                new SettingsService(backend).setSiteEnabled("github.com", enabled, EXCLUDING),
            ).resolves.toEqual({ ok: true, changed: false, snapshot: current });
            expect(backend.set).not.toHaveBeenCalled();
            expect(backend.pair()).toEqual({ current, previous });
        },
    );
});

describe("SettingsService system/custom presentation and diagnostics settings", () => {
    it.each([
        ["system", { mode: "system" as const }],
        ["UTC", { mode: "utc" as const }],
        ["one-component CET", { mode: "iana" as const, identifier: "CET" }],
        ["one-component Japan", { mode: "iana" as const, identifier: "Japan" }],
        ["one-component Iceland", { mode: "iana" as const, identifier: "Iceland" }],
        [
            "slash-separated America/New_York",
            { mode: "iana" as const, identifier: "America/New_York" },
        ],
    ])(
        "persists the valid %s time-zone selection without losing policy/debug state",
        async (_label, timeZone) => {
            const initialDisplay: DisplaySettings = {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "utc" },
            };
            const initial = v6(4, false, excluding("github.com"), initialDisplay, true);
            const backend = storage(initial);
            const available = vi.fn(() => true);
            const service = new SettingsService(backend, SETTINGS_STORAGE_KEY, available);
            const display: DisplaySettings = { formatMode: "system", timeZone };

            await expect(service.setDisplaySettings(display)).resolves.toEqual({
                ok: true,
                changed: true,
                snapshot: v6(5, false, excluding("github.com"), display, true),
            });
            expect(backend.set).toHaveBeenCalledOnce();
            expect(backend.pair()).toEqual({
                current: v6(5, false, excluding("github.com"), display, true),
                previous: initial,
            });
            if (timeZone.mode === "iana") {
                expect(available).toHaveBeenCalledWith(timeZone.identifier);
            } else {
                expect(available).not.toHaveBeenCalled();
            }
        },
    );

    it("preserves a custom pattern and IANA zone in the atomic pair", async () => {
        const scope: SiteScopePolicy = {
            mode: SITE_SCOPE_MODE.SELECTED_ONLY,
            excludedSites: ["github.com"],
            allowedSites: ["example.test"],
        };
        const initial = v6(8, false, scope, undefined, true);
        const custom: DisplaySettings = {
            formatMode: "custom",
            pattern: "EEEE, d MMMM yyyy HH:mm XXX",
            timeZone: { mode: "iana", identifier: "America/New_York" },
        };
        const backend = storage(initial, v6(7));

        await expect(
            new SettingsService(backend, SETTINGS_STORAGE_KEY, () => true)
                .setDisplaySettings(custom),
        ).resolves.toEqual({
            ok: true,
            changed: true,
            snapshot: v6(9, false, scope, custom, true),
        });
        expect(backend.pair()).toEqual({
            current: v6(9, false, scope, custom, true),
            previous: initial,
        });
    });

    it.each([
        "",
        "YYYY-MM-dd",
        "yyyy-DD",
        "yyyy ff",
        "'literal only'",
        "yyyy 'unfinished",
        "yyyy\nMM",
        "y".repeat(257),
    ])(
        "rejects unsafe custom format %# as invalid-format before touching either snapshot",
        async (pattern) => {
            const current = v6(4, false, excluding("github.com"), undefined, true);
            const previous = v6(3);
            const backend = storage(current, previous);

            await expect(
                new SettingsService(backend).setDisplaySettings({
                    formatMode: "custom",
                    pattern,
                    timeZone: { mode: "utc" },
                }),
            ).resolves.toMatchObject({ ok: false, error: "invalid-format" });
            expect(backend.get).not.toHaveBeenCalled();
            expect(backend.set).not.toHaveBeenCalled();
            expect(backend.pair()).toEqual({ current, previous });
        },
    );

    it.each([
        "",
        "../UTC",
        "America/../New_York",
        "America//New_York",
        "America\\New_York",
        " America/New_York",
        "America/New_York ",
        "America/New\nYork",
    ])(
        "rejects structurally unsafe time zone %j without checking availability or storage",
        async (identifier) => {
            const backend = storage(v6(4));
            const available = vi.fn(() => true);

            await expect(
                new SettingsService(backend, SETTINGS_STORAGE_KEY, available).setDisplaySettings({
                    formatMode: "system",
                    timeZone: { mode: "iana", identifier },
                }),
            ).resolves.toMatchObject({ ok: false, error: "invalid-display-settings" });
            expect(available).not.toHaveBeenCalled();
            expect(backend.get).not.toHaveBeenCalled();
            expect(backend.set).not.toHaveBeenCalled();
        },
    );

    it("rejects a structurally valid but unavailable IANA identifier", async () => {
        const backend = storage(v6(5, false, excluding("github.com"), undefined, true));
        const available = vi.fn(() => false);

        await expect(
            new SettingsService(backend, SETTINGS_STORAGE_KEY, available).setDisplaySettings({
                formatMode: "system",
                timeZone: { mode: "iana", identifier: "Mars/Olympus" },
            }),
        ).resolves.toMatchObject({ ok: false, error: "invalid-time-zone" });
        expect(available).toHaveBeenCalledOnce();
        expect(backend.get).not.toHaveBeenCalled();
        expect(backend.set).not.toHaveBeenCalled();
    });

    it.each([
        { formatMode: "system" as const, timeZone: { mode: "utc" as const } },
        {
            formatMode: "system" as const,
            timeZone: { mode: "iana" as const, identifier: "America/New_York" },
        },
        {
            formatMode: "custom" as const,
            pattern: "yyyy-MM-dd",
            timeZone: { mode: "utc" as const },
        },
    ])("keeps an unchanged equivalent display %# write-free", async (display) => {
        const current = v6(6, false, excluding("github.com"), display, true);
        const previous = v6(5);
        const backend = storage(current, previous);

        await expect(
            new SettingsService(backend, SETTINGS_STORAGE_KEY, () => true)
                .setDisplaySettings(structuredClone(display)),
        ).resolves.toEqual({
            ok: true,
            changed: false,
            snapshot: current,
        });
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it.each([true, false])(
        "keeps an unchanged debug=%s preference and both existing documents",
        async (enabled) => {
            const current = v6(8, false, excluding("github.com"), undefined, enabled);
            const previous = v6(7);
            const backend = storage(current, previous);

            await expect(new SettingsService(backend).setDebugEnabled(enabled)).resolves.toEqual({
                ok: true,
                changed: false,
                snapshot: current,
            });
            expect(backend.set).not.toHaveBeenCalled();
            expect(backend.pair()).toEqual({ current, previous });
        },
    );

    it("toggles debug without changing display or hostname policy", async () => {
        const custom: DisplaySettings = {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm",
            timeZone: { mode: "iana", identifier: "America/New_York" },
        };
        const scope: SiteScopePolicy = {
            mode: SITE_SCOPE_MODE.SELECTED_ONLY,
            excludedSites: ["github.com"],
            allowedSites: ["example.test"],
        };
        const initial = v6(2, false, scope, custom);
        const backend = storage(initial);
        const service = new SettingsService(backend);

        await expect(service.setDebugEnabled(true)).resolves.toMatchObject({
            ok: true,
            changed: true,
            snapshot: v6(3, false, scope, custom, true),
        });
        await expect(service.setDebugEnabled(false)).resolves.toMatchObject({
            ok: true,
            changed: true,
            snapshot: v6(4, false, scope, custom, false),
        });
        expect(backend.set).toHaveBeenCalledTimes(2);
        expect(backend.pair()).toEqual({
            current: v6(4, false, scope, custom, false),
            previous: v6(3, false, scope, custom, true),
        });
    });
});

const mutations = [
    ["global", (service: SettingsService) => service.setGlobalEnabled(false)],
    [
        "site",
        (service: SettingsService) => service.setSiteEnabled("github.com", false, EXCLUDING),
    ],
    [
        "scope-mode",
        (service: SettingsService) => service.setSiteScopeMode(SITE_SCOPE_MODE.SELECTED_ONLY),
    ],
    [
        "display",
        (service: SettingsService) =>
            service.setDisplaySettings({ formatMode: "system", timeZone: { mode: "utc" } }),
    ],
    ["debug", (service: SettingsService) => service.setDebugEnabled(true)],
] as const;

describe("SettingsService atomic failure and concurrency boundaries", () => {
    it.each(mutations)(
        "preserves both snapshots and memory after a rejected %s write",
        async (_label, mutate) => {
            const current = v6(4, true);
            const previous = v6(3, false, excluding("example.test"));
            const backend = storage(current, previous);
            const service = new SettingsService(backend);
            await service.load();
            backend.set.mockRejectedValueOnce(new Error("disk full"));

            await expect(mutate(service)).resolves.toEqual({
                ok: false,
                error: "persistence-failed",
                snapshot: current,
            });
            expect(backend.set).toHaveBeenCalledOnce();
            expect(backend.pair()).toEqual({ current, previous });
            expect(service.loadedSnapshot).toEqual(current);
        },
    );

    it.each(mutations)(
        "fails a %s transaction closed when the pair becomes unreadable",
        async (_label, mutate) => {
            const current = v6(4, true);
            const previous = v6(3);
            const backend = storage(current, previous);
            const service = new SettingsService(backend);
            await service.load();
            backend.get.mockRejectedValueOnce(new Error("storage disconnected"));

            await expect(mutate(service)).resolves.toEqual({
                ok: false,
                error: "persistence-failed",
                snapshot: current,
            });
            expect(service.lastLoadError).toBe("load-failed");
            expect(backend.set).not.toHaveBeenCalled();
            expect(backend.pair()).toEqual({ current, previous });
        },
    );

    it.each(mutations)(
        "rejects safe-integer revision overflow during a %s mutation without a write",
        async (_label, mutate) => {
            const current = v6(Number.MAX_SAFE_INTEGER, true);
            const previous = v6(Number.MAX_SAFE_INTEGER - 1);
            const backend = storage(current, previous);
            const service = new SettingsService(backend);

            await expect(mutate(service)).resolves.toEqual({
                ok: false,
                error: "persistence-failed",
                snapshot: current,
            });
            expect(backend.set).not.toHaveBeenCalled();
            expect(backend.pair()).toEqual({ current, previous });
        },
    );

    it("serializes overlapping settings intents without losing fields", async () => {
        const initial = v6(5, true);
        const backend = storage(initial, v6(4));
        const service = new SettingsService(backend, SETTINGS_STORAGE_KEY, () => true);
        const custom: DisplaySettings = {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm",
            timeZone: { mode: "iana", identifier: "America/New_York" },
        };

        const results = await Promise.all([
            service.setGlobalEnabled(false),
            service.setSiteEnabled("github.com", false, EXCLUDING),
            service.setDisplaySettings(custom),
            service.setDebugEnabled(true),
        ]);

        expect(results.map((result) => result.snapshot.revision)).toEqual([6, 7, 8, 9]);
        expect(results.every((result) => result.ok && result.changed)).toBe(true);
        expect(backend.set).toHaveBeenCalledTimes(4);
        expect(backend.pair()).toEqual({
            current: v6(9, false, excluding("github.com"), custom, true),
            previous: v6(8, false, excluding("github.com"), custom, false),
        });
        for (const [index, [items]] of backend.set.mock.calls.entries()) {
            expect(Object.keys(items).sort()).toEqual(
                [SETTINGS_STORAGE_KEY, SETTINGS_PREVIOUS_STORAGE_KEY].sort(),
            );
            expect(items[SETTINGS_STORAGE_KEY]).toMatchObject({ revision: index + 6 });
            expect(items[SETTINGS_PREVIOUS_STORAGE_KEY]).toMatchObject({ revision: index + 5 });
        }
    });

    it("continues later queued transactions after an earlier atomic write rejects", async () => {
        const initial = v6(2, true);
        const backend = storage(initial, v6(1));
        backend.set.mockRejectedValueOnce(new Error("first write failed"));
        const service = new SettingsService(backend);

        const [failed, savedSite, savedDebug] = await Promise.all([
            service.setGlobalEnabled(false),
            service.setSiteEnabled("github.com", false, EXCLUDING),
            service.setDebugEnabled(true),
        ]);

        expect(failed).toEqual({ ok: false, error: "persistence-failed", snapshot: initial });
        expect(savedSite).toMatchObject({
            ok: true,
            changed: true,
            snapshot: {
                revision: 3,
                globalEnabled: true,
                siteScope: { excludedSites: ["github.com"] },
            },
        });
        expect(savedDebug).toMatchObject({
            ok: true,
            changed: true,
            snapshot: { revision: 4, globalEnabled: true, debugEnabled: true },
        });
        expect(backend.pair()).toEqual({
            current: v6(4, true, excluding("github.com"), undefined, true),
            previous: v6(3, true, excluding("github.com")),
        });
    });

    it("coalesces concurrent duplicate debug intents into one atomic write", async () => {
        const backend = storage(v6(2));
        const service = new SettingsService(backend);

        const [first, duplicate, last] = await Promise.all([
            service.setDebugEnabled(true),
            service.setDebugEnabled(true),
            service.setDebugEnabled(true),
        ]);

        expect(first).toMatchObject({
            ok: true,
            changed: true,
            snapshot: { revision: 3, debugEnabled: true },
        });
        expect(duplicate).toMatchObject({
            ok: true,
            changed: false,
            snapshot: { revision: 3, debugEnabled: true },
        });
        expect(last).toMatchObject({
            ok: true,
            changed: false,
            snapshot: { revision: 3, debugEnabled: true },
        });
        expect(backend.set).toHaveBeenCalledOnce();
    });
});

describe("SettingsService reset", () => {
    it("rejects reset when the monotonic revision cannot advance safely", async () => {
        const current = v6(Number.MAX_SAFE_INTEGER, false, excluding("github.com"));
        const previous = v6(Number.MAX_SAFE_INTEGER - 1);
        const backend = storage(current, previous);
        const service = new SettingsService(backend);

        await expect(service.resetAll()).resolves.toEqual({
            ok: false,
            error: "persistence-failed",
            snapshot: current,
        });
        expect(backend.set).not.toHaveBeenCalled();
        expect(backend.pair()).toEqual({ current, previous });
    });

    it("resets custom values while preserving monotonic settings revisions", async () => {
        const custom: DisplaySettings = {
            formatMode: "custom",
            pattern: "yyyy-MM-dd",
            timeZone: { mode: "utc" },
        };
        const backend = storage(
            v6(9, false, excluding("github.com"), custom, true),
            v6(8, false),
        );
        const service = new SettingsService(backend);
        await service.load();

        await expect(service.resetAll()).resolves.toEqual({
            ok: true,
            changed: true,
            snapshot: v6(10),
        });
        expect(backend.pair()).toEqual({
            current: v6(10),
            previous: v6(10),
        });
        expect(backend.remove).not.toHaveBeenCalled();
    });

    it("atomically clears both lists, the mode, appearance, zone, and diagnostics", async () => {
        const display: DisplaySettings = {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm XXX",
            timeZone: { mode: "iana", identifier: "America/New_York" },
        };
        const current = {
            ...v6(
                17,
                false,
                {
                    mode: SITE_SCOPE_MODE.SELECTED_ONLY,
                    excludedSites: ["github.com", "managed-disabled.test"],
                    allowedSites: ["managed-enabled.test", "managed.test."],
                },
                display,
                true,
            ),
            appearance: APPEARANCE.DARK,
        };
        const previous = v6(16, true, excluding("previous-only.test"), display, true);
        const backend = storage(current, previous);
        const service = new SettingsService(backend);
        await service.load();

        await expect(service.resetAll()).resolves.toEqual({
            ok: true,
            changed: true,
            snapshot: v6(18),
        });
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.set).toHaveBeenCalledWith({
            [SETTINGS_STORAGE_KEY]: v6(18),
            [SETTINGS_PREVIOUS_STORAGE_KEY]: v6(18),
        });
        expect(backend.pair()).toEqual({
            current: v6(18),
            previous: v6(18),
        });
        expect(backend.remove).not.toHaveBeenCalled();
    });

    it("preserves healthy documents and memory on a rejected reset", async () => {
        const current = v6(7, false, excluding("github.com"), undefined, true);
        const previous = v6(6);
        const backend = storage(current, previous);
        const service = new SettingsService(backend);
        await service.load();
        backend.set.mockRejectedValueOnce(new Error("disk full"));

        await expect(service.resetAll()).resolves.toEqual({
            ok: false,
            error: "persistence-failed",
            snapshot: current,
        });
        expect(backend.pair()).toEqual({ current, previous });
        expect(service.loadedSnapshot).toEqual(current);
    });

    it("queues a hostname edit behind an in-flight reset", async () => {
        const current = v6(3, false, excluding("example.test"), undefined, true);
        const previous = v6(2);
        const backend = storage(current, previous);
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
        const edit = service.setSiteEnabled("github.com", false, EXCLUDING);
        await Promise.resolve();
        expect(backend.set).toHaveBeenCalledOnce();
        expect(backend.pair()).toEqual({ current, previous });
        release?.();
        const [resetResult, editResult] = await Promise.all([reset, edit]);

        expect(resetResult).toEqual({
            ok: true,
            changed: true,
            snapshot: v6(4),
        });
        expect(editResult).toEqual({
            ok: true,
            changed: true,
            snapshot: v6(5, true, excluding("github.com")),
        });
        expect(backend.pair()).toEqual({
            current: v6(5, true, excluding("github.com")),
            previous: v6(4),
        });
        expect(backend.set).toHaveBeenCalledTimes(2);
    });

    it("queues a reset behind site and debug changes and clears in order", async () => {
        const backend = storage(v6(3), v6(2));
        const service = new SettingsService(backend);

        const [site, enabled, reset] = await Promise.all([
            service.setSiteEnabled("github.com", false, EXCLUDING),
            service.setDebugEnabled(true),
            service.resetAll(),
        ]);

        expect(site).toMatchObject({
            ok: true,
            changed: true,
            snapshot: { revision: 4, siteScope: { excludedSites: ["github.com"] } },
        });
        expect(enabled).toMatchObject({
            ok: true,
            changed: true,
            snapshot: { revision: 5, debugEnabled: true },
        });
        expect(reset).toEqual({ ok: true, changed: true, snapshot: v6(6) });
        expect(backend.set).toHaveBeenCalledTimes(3);
        expect(backend.pair()).toEqual({
            current: v6(6),
            previous: v6(6),
        });
    });
});
