/**
 * @file Verifies strict parsing of explicit-zone ISO date-times.
 */

import { describe, expect, it } from "vitest";

import {
    parseExplicitZoneDatetime,
} from "../../../../src/shared/date/parse-explicit-zone-datetime";

describe("parseExplicitZoneDatetime", () => {
    it("normalizes a complete explicit-zone date-time", () => {
        expect(parseExplicitZoneDatetime("2026-08-23T10:15:30+03:00")?.toISOString())
            .toBe("2026-08-23T07:15:30.000Z");
    });

    it("rejects a date-time without an explicit zone", () => {
        expect(parseExplicitZoneDatetime("2026-08-23T10:15:30")).toBeNull();
    });
});
