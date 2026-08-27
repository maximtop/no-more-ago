/**
 * @file Verifies strict V5 settings snapshot validation and canonicalization.
 */

import { describe, expect, it } from "vitest";
import {
    DEFAULT_DISPLAY_SETTINGS,
    DEFAULT_SETTINGS_SNAPSHOT,
    SETTINGS_SCHEMA_VERSION,
    createSettingsSnapshot,
    isCanonicalHostname,
    isDisplaySettings,
    isSettingsSnapshotV5,
    isStructurallyValidTimeZoneIdentifier,
    isTimeZoneSelection,
    parseDisplaySettings,
    parseTimeZoneSelection,
    parseSettingsSnapshot,
} from "../../src/shared/settings/snapshot";

const display = (mode: "system" | "utc" | "iana", identifier?: string) => ({
    formatMode: "system" as const,
    timeZone: mode === "iana" ? { mode, identifier: identifier ?? "America/New_York" } : { mode },
});
const v5 = (revision = 0, debugEnabled = false) => ({
    schemaVersion: 5 as const,
    revision,
    globalEnabled: true,
    sitePreferences: {},
    display: display("system"),
    debugEnabled,
});

describe("Settings Snapshot V5", () => {
    it("uses one frozen default with debug logging off", () => {
        expect(DEFAULT_SETTINGS_SNAPSHOT).toEqual({
            schemaVersion: 5,
            revision: 0,
            globalEnabled: true,
            sitePreferences: {},
            display: DEFAULT_DISPLAY_SETTINGS,
            debugEnabled: false,
        });
        expect(Object.isFrozen(DEFAULT_SETTINGS_SNAPSHOT)).toBe(true);
        expect(Object.isFrozen(DEFAULT_SETTINGS_SNAPSHOT.sitePreferences)).toBe(true);
        expect(Object.isFrozen(DEFAULT_SETTINGS_SNAPSHOT.display)).toBe(true);
    });

    it("requires exactly six own fields and a boolean debug flag", () => {
        expect(isSettingsSnapshotV5(v5())).toBe(true);
        expect(parseSettingsSnapshot({ ...v5(), debugEnabled: "yes" })).toBeNull();
        expect(parseSettingsSnapshot({ ...v5(), extra: false })).toBeNull();
        expect(
            parseSettingsSnapshot({
                schemaVersion: 4,
                revision: 0,
                globalEnabled: true,
                sitePreferences: {},
                display: display("system"),
            }),
        ).toBeNull();
        expect(parseSettingsSnapshot({ ...v5(), schemaVersion: 6 })).toBeNull();
        expect(
            parseSettingsSnapshot(
                Object.assign(Object.create({ debugEnabled: true }), {
                    schemaVersion: 5,
                    revision: 0,
                    globalEnabled: true,
                    sitePreferences: {},
                    display: display("system"),
                }),
            ),
        ).toBeNull();
    });

    it("preserves strict display, hostname, and time-zone validation", () => {
        expect(
            parseSettingsSnapshot({
                ...v5(2, true),
                display: {
                    formatMode: "custom",
                    pattern: "do MMMM yyyy",
                    timeZone: { mode: "utc" },
                },
            }),
        ).not.toBeNull();
        expect(
            parseSettingsSnapshot({
                ...v5(),
                display: { formatMode: "custom", pattern: "YYYY-MM-dd", timeZone: { mode: "utc" } },
            }),
        ).toBeNull();
        expect(isCanonicalHostname("github.com")).toBe(true);
        expect(isCanonicalHostname("EXAMPLE.COM")).toBe(false);
    });

    it("constructs V5 while preserving every field", () => {
        expect(
            createSettingsSnapshot(3, false, { "github.com": false }, display("utc"), true),
        ).toEqual({
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            revision: 3,
            globalEnabled: false,
            sitePreferences: { "github.com": false },
            display: display("utc"),
            debugEnabled: true,
        });
        expect(() => createSettingsSnapshot(-1, true)).toThrow(TypeError);
        expect(() =>
            createSettingsSnapshot(0, true, {}, DEFAULT_DISPLAY_SETTINGS, "yes" as never),
        ).toThrow(TypeError);
    });
});

describe("strict schema and policy boundaries", () => {
    it.each([1, 2, 3, 4, 6, 99])("rejects incompatible schema version %s", (schemaVersion) => {
        expect(parseSettingsSnapshot({ ...v5(), schemaVersion })).toBeNull();
        expect(isSettingsSnapshotV5({ ...v5(), schemaVersion })).toBe(false);
    });

    it.each([
        { revision: -1 },
        { revision: Number.NaN },
        { revision: Number.POSITIVE_INFINITY },
        { revision: Number.MAX_SAFE_INTEGER + 1 },
        { revision: 1.5 },
        { globalEnabled: "true" },
        { debugEnabled: 1 },
        { sitePreferences: [] },
        { display: null },
    ])("rejects unsafe top-level value %o", (change) => {
        expect(parseSettingsSnapshot({ ...v5(), ...change })).toBeNull();
    });

    it("requires exactly six own top-level fields and rejects inherited substitutions", () => {
        expect(parseSettingsSnapshot({ ...v5(), extra: true })).toBeNull();
        expect(
            parseSettingsSnapshot(
                Object.assign(Object.create({ debugEnabled: true }), {
                    schemaVersion: 5,
                    revision: 0,
                    globalEnabled: true,
                    sitePreferences: {},
                    display: display("system"),
                }),
            ),
        ).toBeNull();
        expect(
            parseSettingsSnapshot(
                Object.assign(Object.create({ globalEnabled: true }), {
                    schemaVersion: 5,
                    revision: 0,
                    sitePreferences: {},
                    display: display("system"),
                    debugEnabled: false,
                }),
            ),
        ).toBeNull();
    });

    it.each([
        "example.test",
        "sub.example.test",
        "127.0.0.1",
        "localhost",
        "[::1]",
        "xn--bcher-kva.example",
        "example.test.",
        "__proto__",
        "constructor",
        "tostring",
    ])("accepts canonical exact hostname %s", (hostname) => {
        expect(isCanonicalHostname(hostname)).toBe(true);
        expect(
            parseSettingsSnapshot({ ...v5(), sitePreferences: { [hostname]: false } }),
        ).toMatchObject({ sitePreferences: { [hostname]: false } });
    });

    it.each([
        "EXAMPLE.TEST",
        "BÜCHER.example",
        "bücher.example",
        "example.test..",
        "example.test:443",
        "::1",
        "https://example.test",
        "example.test/path",
        "example.test?query",
        "example.test#hash",
        "user:pass@example.test",
        "*.example.test",
        " example.test",
        "example.test ",
    ])("rejects noncanonical intent hostname %s", (hostname) => {
        expect(isCanonicalHostname(hostname)).toBe(false);
        expect(
            parseSettingsSnapshot({ ...v5(), sitePreferences: { [hostname]: false } }),
        ).toBeNull();
    });

    it("copies own prototype-like map keys without invoking their prototypes", () => {
        const map = Object.fromEntries([
            ["__proto__", false],
            ["constructor", true],
            ["tostring", false],
        ]);
        const parsed = parseSettingsSnapshot({ ...v5(), sitePreferences: map });
        expect(parsed).not.toBeNull();
        expect(Object.hasOwn(parsed?.sitePreferences ?? {}, "__proto__")).toBe(true);
        expect(Object.hasOwn(parsed?.sitePreferences ?? {}, "constructor")).toBe(true);
        expect(parsed?.sitePreferences.__proto__).toBe(false);
    });

    it.each([
        { "example.test": "false" },
        { "EXAMPLE.TEST": false },
        { "example.test:443": false },
    ])("rejects malformed or inherited site preference map %o", (sitePreferences) => {
        expect(parseSettingsSnapshot({ ...v5(), sitePreferences })).toBeNull();
    });

    it("preserves explicit true as an own preference instead of treating it as missing", () => {
        const parsed = parseSettingsSnapshot({
            ...v5(),
            sitePreferences: { "example.test": true },
        });
        expect(parsed?.sitePreferences).toEqual({ "example.test": true });
        expect(Object.hasOwn(parsed?.sitePreferences ?? {}, "example.test")).toBe(true);
    });

    it("ignores inherited preference entries and copies only own entries", () => {
        const source = Object.assign(
            Object.create({ "example.test": false }) as Record<string, unknown>,
            { "other.test": true },
        );
        const parsed = parseSettingsSnapshot({ ...v5(), sitePreferences: source });
        expect(parsed?.sitePreferences).toEqual({ "other.test": true });
        expect(Object.hasOwn(parsed?.sitePreferences ?? {}, "example.test")).toBe(false);
    });
});

describe("display and timezone snapshot validation", () => {
    it.each([
        { formatMode: "system", timeZone: { mode: "system" } },
        { formatMode: "system", timeZone: { mode: "utc" } },
        { formatMode: "system", timeZone: { mode: "iana", identifier: "America/New_York" } },
        { formatMode: "system", timeZone: { mode: "iana", identifier: "CET" } },
        { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm", timeZone: { mode: "utc" } },
        {
            formatMode: "custom",
            pattern: "EEEE, do MMMM yyyy 'at' HH:mm",
            timeZone: { mode: "iana", identifier: "Europe/Nicosia" },
        },
    ])("accepts valid display discriminant %o", (value) => {
        expect(isDisplaySettings(value)).toBe(true);
        expect(parseDisplaySettings(value)).not.toBeNull();
        expect(parseSettingsSnapshot({ ...v5(), display: value })).not.toBeNull();
    });

    it.each([
        { formatMode: "system", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } },
        { formatMode: "custom", timeZone: { mode: "utc" } },
        { formatMode: "custom", pattern: "YYYY-MM-dd", timeZone: { mode: "utc" } },
        { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" }, extra: true },
        { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "local" } },
        { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "iana" } },
        { formatMode: "system", timeZone: { mode: "system" }, extra: false },
    ])("rejects malformed display shape %o", (value) => {
        expect(isDisplaySettings(value)).toBe(false);
        expect(parseDisplaySettings(value)).toBeNull();
        expect(parseSettingsSnapshot({ ...v5(), display: value })).toBeNull();
    });

    it("rejects inherited custom patterns and inherited display discriminants", () => {
        const inheritedPattern = Object.assign(
            Object.create({ pattern: "yyyy-MM-dd" }) as Record<string, unknown>,
            { formatMode: "custom", timeZone: { mode: "utc" } },
        );
        expect(parseDisplaySettings(inheritedPattern)).toBeNull();
        const inheritedMode = Object.assign(
            Object.create({ formatMode: "system" }) as Record<string, unknown>,
            { timeZone: { mode: "utc" } },
        );
        expect(parseDisplaySettings(inheritedMode)).toBeNull();
    });

    it.each([
        "yyyy-MM-dd",
        "dd/MM/yyyy HH:mm",
        "EEEE, d MMMM yyyy",
        "do MMMM yyyy 'at' HH:mm",
        "yyyy '' MM",
        "t",
        "yyyy-MM-dd XXX",
    ])("accepts bounded Unicode custom pattern %s", (pattern) => {
        expect(
            parseDisplaySettings({ formatMode: "custom", pattern, timeZone: { mode: "utc" } }),
        ).toMatchObject({ formatMode: "custom", pattern });
    });

    it.each([
        "",
        "   ",
        "x".repeat(257),
        "yyyy-MM-dd\u0000",
        "yyyy-MM-dd '",
        "yyyy-MM-dd J",
        "YYYY-MM-dd",
        "yyyy-DD-dd",
        "yyyy D",
        "'literal'",
        "'-'",
    ])("rejects bounded/legacy/invalid custom pattern %s", (pattern) => {
        expect(
            parseDisplaySettings({ formatMode: "custom", pattern, timeZone: { mode: "utc" } }),
        ).toBeNull();
    });

    it.each([
        { mode: "system" },
        { mode: "utc" },
        { mode: "iana", identifier: "UTC" },
        { mode: "iana", identifier: "America/New_York" },
        { mode: "iana", identifier: "Etc/GMT+5" },
        { mode: "iana", identifier: "US/Eastern" },
        { mode: "iana", identifier: "Historical/Unavailable/Zone" },
    ])("accepts structurally safe timezone selection %o", (value) => {
        expect(isTimeZoneSelection(value)).toBe(true);
        expect(parseTimeZoneSelection(value)).not.toBeNull();
    });

    it.each([
        "",
        " UTC",
        "UTC ",
        "A//B",
        "/UTC",
        "UTC/",
        "A/../B",
        "A/./B",
        "A\\B",
        "A B",
        "1Europe",
        "Europe/\u0000City",
    ])("rejects unsafe timezone identifier %s", (identifier) => {
        expect(isStructurallyValidTimeZoneIdentifier(identifier)).toBe(false);
        expect(parseTimeZoneSelection({ mode: "iana", identifier })).toBeNull();
    });

    it("accepts structurally valid historical zones without checking ICU availability", () => {
        const value = { mode: "iana", identifier: "Historical/Unavailable/Zone" };
        expect(
            parseSettingsSnapshot({ ...v5(), display: { formatMode: "system", timeZone: value } }),
        ).not.toBeNull();
    });

    it("freezes parsed nested display and timezone values", () => {
        const parsed = parseSettingsSnapshot({
            ...v5(),
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "iana", identifier: "UTC" },
            },
        });
        expect(parsed).not.toBeNull();
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed?.display)).toBe(true);
        expect(Object.isFrozen(parsed?.display.timeZone)).toBe(true);
    });
});
