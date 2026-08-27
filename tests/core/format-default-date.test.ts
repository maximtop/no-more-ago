/**
 * @file Verifies exact-date formatting across locale and time-zone choices.
 */

import { describe, expect, it } from "vitest";

import {
    formatDateWithPresentation,
    formatDefaultDate,
} from "../../src/shared/date/format-default-date";

describe("formatDefaultDate", () => {
    it("matches browser defaults for explicit and runtime-default locales", () => {
        const instant = new Date("2026-08-23T07:15:00.000Z");
        const expectedEnGb = new Intl.DateTimeFormat(["en-GB"], {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(instant);
        const expectedRuntimeDefault = new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(instant);

        expect(formatDefaultDate(instant, ["en-GB"])).toBe(expectedEnGb);
        expect(formatDefaultDate(instant, [])).toBe(expectedRuntimeDefault);
    });

    it("uses the selected UTC and IANA zones without changing locale conventions", () => {
        const instant = new Date("2026-01-15T12:15:00.000Z");
        const utcExpected = new Intl.DateTimeFormat(["en-GB"], {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "UTC",
        }).format(instant);
        const nyExpected = new Intl.DateTimeFormat(["en-US"], {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "America/New_York",
        }).format(instant);
        expect(
            formatDateWithPresentation(instant, ["en-GB"], {
                formatMode: "system",
                timeZone: { mode: "utc" },
            }).text,
        ).toBe(utcExpected);
        expect(
            formatDateWithPresentation(instant, ["en-US"], {
                formatMode: "system",
                timeZone: { mode: "iana", identifier: "America/New_York" },
            }).text,
        ).toBe(nyExpected);
    });

    it("preserves Unicode hour-cycle preferences for both 24-hour and 12-hour clocks", () => {
        const instant = new Date("2026-08-23T17:15:00.000Z");
        const display = { formatMode: "system" as const, timeZone: { mode: "utc" as const } };

        for (const [locale, hour12] of [
            ["en-US-u-hc-h23", false],
            ["en-GB-u-hc-h12", true],
        ] as const) {
            const formatter = new Intl.DateTimeFormat([locale], {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
            });

            expect(formatter.resolvedOptions().hour12).toBe(hour12);
            expect(formatDateWithPresentation(instant, [locale], display).text).toBe(
                formatter.format(instant),
            );
        }
    });

    it("honors ordered browser locales and falls back past an unsupported valid locale", () => {
        const instant = new Date("2026-08-23T17:15:00.000Z");
        const display = { formatMode: "system" as const, timeZone: { mode: "utc" as const } };
        const localeLists = [
            ["en-GB", "en-US"],
            ["en-US", "en-GB"],
            ["zz-ZZ", "en-GB"],
        ] as const;
        const results: string[] = [];

        for (const locales of localeLists) {
            const formatter = new Intl.DateTimeFormat(locales, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
            });
            const actual = formatDateWithPresentation(instant, locales, display).text;

            expect(actual).toBe(formatter.format(instant));
            results.push(actual);
        }

        expect(results[0]).not.toBe(results[1]);
        expect(results[2]).toBe(results[0]);
    });

    it("skips the nonexistent New York hour across the spring-forward boundary", () => {
        const formatter = new Intl.DateTimeFormat(["en-GB"], {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "America/New_York",
        });
        const display = {
            formatMode: "system" as const,
            timeZone: { mode: "iana" as const, identifier: "America/New_York" },
        };
        const cases = [
            { instant: new Date("2026-03-08T06:59:00.000Z"), hour: "01", minute: "59" },
            { instant: new Date("2026-03-08T07:01:00.000Z"), hour: "03", minute: "01" },
        ] as const;

        for (const { instant, hour, minute } of cases) {
            const parts = formatter.formatToParts(instant);

            expect(formatDateWithPresentation(instant, ["en-GB"], display).text).toBe(
                formatter.format(instant),
            );
            expect(parts.find((part) => part.type === "year")?.value).toBe("2026");
            expect(parts.find((part) => part.type === "hour")?.value).toBe(hour);
            expect(parts.find((part) => part.type === "minute")?.value).toBe(minute);
            expect(parts.some((part) => part.type === "second")).toBe(false);
        }
    });

    it("falls back to System and reports an unavailable saved zone", () => {
        const instant = new Date("2026-01-15T12:15:00.000Z");
        const expected = formatDefaultDate(instant, ["en-GB"]);
        expect(
            formatDateWithPresentation(
                instant,
                ["en-GB"],
                { formatMode: "system", timeZone: { mode: "iana", identifier: "Gone/Zone" } },
                () => false,
            ),
        ).toEqual({ text: expected, error: "unavailable-time-zone" });
    });

    it("formats custom patterns with locale and one selected zone", () => {
        const before = formatDateWithPresentation(new Date("2026-03-08T06:59:00.000Z"), ["en-US"], {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm XXX",
            timeZone: { mode: "iana", identifier: "America/New_York" },
        });
        const after = formatDateWithPresentation(new Date("2026-03-08T07:01:00.000Z"), ["en-US"], {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm XXX",
            timeZone: { mode: "iana", identifier: "America/New_York" },
        });
        expect(before).toEqual({ text: "2026-03-08 01:59 -05:00" });
        expect(after).toEqual({ text: "2026-03-08 03:01 -04:00" });
    });

    it("retains the custom pattern when a saved zone is unavailable", () => {
        expect(
            formatDateWithPresentation(
                new Date("2026-01-15T12:15:00.000Z"),
                ["de-DE"],
                {
                    formatMode: "custom",
                    pattern: "d MMMM yyyy",
                    timeZone: { mode: "iana", identifier: "Gone/Zone" },
                },
                () => false,
            ),
        ).toEqual({ text: "15 Januar 2026", error: "unavailable-time-zone" });
    });

    it("contains formatter failures and produces no displayable text", () => {
        expect(
            formatDateWithPresentation(new Date("2026-01-15T12:15:00.000Z"), ["en-US"], {
                formatMode: "custom",
                pattern: "yyyy ff",
                timeZone: { mode: "system" },
            }),
        ).toEqual({ text: "", error: "invalid-format" });
    });
});
