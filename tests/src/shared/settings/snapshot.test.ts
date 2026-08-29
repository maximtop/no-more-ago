/**
 * @file Verifies V5 settings construction and user-authored domain validation.
 */

import { describe, expect, it } from "vitest";
import {
    DEFAULT_DISPLAY_SETTINGS,
    DEFAULT_SETTINGS_SNAPSHOT,
    SETTINGS_SCHEMA_VERSION,
    createSettingsSnapshot,
    isCanonicalHostname,
    isDisplaySettings,
    isStructurallyValidTimeZoneIdentifier,
    isTimeZoneSelection,
    parseDisplaySettings,
    parseTimeZoneSelection,
    type DisplaySettings,
    type TimeZoneSelection,
} from "../../../../src/shared/settings/snapshot";

const display = (mode: "system" | "utc" | "iana", identifier?: string): DisplaySettings => ({
    formatMode: "system" as const,
    timeZone: mode === "iana" ? { mode, identifier: identifier ?? "America/New_York" } : { mode },
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

    it("preserves strict display, hostname, and time-zone validation", () => {
        expect(
            parseDisplaySettings({
                formatMode: "custom",
                pattern: "do MMMM yyyy",
                timeZone: { mode: "utc" },
            }),
        ).not.toBeNull();
        expect(
            parseDisplaySettings({
                formatMode: "custom",
                pattern: "YYYY-MM-dd",
                timeZone: { mode: "utc" },
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
    });
});

describe("strict schema and policy boundaries", () => {
    it.each([
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
        1.5,
    ])("rejects unsafe revision %s", (revision) => {
        expect(() => createSettingsSnapshot(revision, true)).toThrow(TypeError);
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
        expect(createSettingsSnapshot(0, true, { [hostname]: false })).toMatchObject({
            sitePreferences: { [hostname]: false },
        });
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
        expect(() => createSettingsSnapshot(0, true, { [hostname]: false })).toThrow(TypeError);
    });

    it("copies own prototype-like map keys without invoking their prototypes", () => {
        const map = Object.fromEntries([
            ["__proto__", false],
            ["constructor", true],
            ["tostring", false],
        ]);
        const snapshot = createSettingsSnapshot(0, true, map);
        expect(Object.hasOwn(snapshot.sitePreferences, "__proto__")).toBe(true);
        expect(Object.hasOwn(snapshot.sitePreferences, "constructor")).toBe(true);
        expect(snapshot.sitePreferences.__proto__).toBe(false);
    });

    it.each([
        { "EXAMPLE.TEST": false },
        { "example.test:443": false },
    ])("rejects noncanonical site preference map %o", (sitePreferences) => {
        expect(() => createSettingsSnapshot(0, true, sitePreferences)).toThrow(TypeError);
    });

    it("preserves explicit true as an own preference instead of treating it as missing", () => {
        const snapshot = createSettingsSnapshot(0, true, { "example.test": true });
        expect(snapshot.sitePreferences).toEqual({ "example.test": true });
        expect(Object.hasOwn(snapshot.sitePreferences, "example.test")).toBe(true);
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
    ] satisfies readonly DisplaySettings[])("accepts valid display discriminant %o", (value) => {
        expect(isDisplaySettings(value)).toBe(true);
        expect(parseDisplaySettings(value)).not.toBeNull();
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
    ] satisfies readonly TimeZoneSelection[])(
        "accepts structurally safe timezone selection %o",
        (value) => {
            expect(isTimeZoneSelection(value)).toBe(true);
            expect(parseTimeZoneSelection(value)).not.toBeNull();
        },
    );

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
        const value: TimeZoneSelection = {
            mode: "iana",
            identifier: "Historical/Unavailable/Zone",
        };
        expect(parseDisplaySettings({ formatMode: "system", timeZone: value })).not.toBeNull();
    });

    it("freezes parsed nested display and timezone values", () => {
        const snapshot = createSettingsSnapshot(
            0,
            true,
            {},
            {
                formatMode: "custom",
                pattern: "yyyy-MM-dd",
                timeZone: { mode: "iana", identifier: "UTC" },
            },
        );
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.display)).toBe(true);
        expect(Object.isFrozen(snapshot.display.timeZone)).toBe(true);
    });
});
