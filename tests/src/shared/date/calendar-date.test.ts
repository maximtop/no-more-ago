/**
 * @file Verifies strict Gregorian calendar-date parsing.
 */

import { describe, expect, it } from "vitest";

import { parseCalendarDate } from "../../../../src/shared/date/calendar-date";

describe("parseCalendarDate", () => {
    it.each([
        ["2026-08-29", { isoDate: "2026-08-29", year: 2026, month: 8, day: 29 }],
        ["2024-02-29", { isoDate: "2024-02-29", year: 2024, month: 2, day: 29 }],
        ["2000-02-29", { isoDate: "2000-02-29", year: 2000, month: 2, day: 29 }],
    ])("accepts Gregorian calendar date %s", (value, expected) => {
        expect(parseCalendarDate(value)).toEqual(expected);
    });

    it.each([
        "",
        "0000-01-01",
        "2023-02-29",
        "1900-02-29",
        "2026-00-01",
        "2026-13-01",
        "2026-04-31",
        "2026-01-00",
        "2026-1-01",
        "26-01-01",
        "2026-01-01T00:00:00Z",
        " 2026-01-01",
        "2026-01-01 ",
        "2026-01-01\u0000",
        "2026-01-01\u0080",
    ])("rejects invalid calendar value %j", (value) => {
        expect(parseCalendarDate(value)).toBeNull();
    });
});
