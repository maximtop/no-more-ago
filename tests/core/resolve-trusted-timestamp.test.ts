/**
 * @file Verifies strict resolution of explicit-zone adapter timestamps.
 */

import { describe, expect, it } from "vitest";

import {
    EXPLICIT_ZONED_DATETIME_RULE,
    type TimestampCandidate,
} from "../../src/content-script/adapters/types";
import {
    resolveTrustedTimestamp,
} from "../../src/content-script/transformation/resolve-trusted-timestamp";

describe("resolveTrustedTimestamp", () => {
    it("normalizes an explicitly zoned timestamp to its instant", () => {
        const result = resolveTrustedTimestamp({
            adapterId: "github",
            source: document.createElement("relative-time"),
            sourceKind: "relative-time",
            rawDatetime: "2026-08-23T10:15:00+03:00",
            timestampRule: EXPLICIT_ZONED_DATETIME_RULE,
        });

        expect(result?.instant.toISOString()).toBe("2026-08-23T07:15:00.000Z");
        expect(result?.sourceDatetime).toBe("2026-08-23T10:15:00+03:00");
    });

    it("rejects a timestamp without an explicit time zone", () => {
        expect(
            resolveTrustedTimestamp({
                adapterId: "github",
                source: document.createElement("relative-time"),
                sourceKind: "relative-time",
                rawDatetime: "2026-08-23T10:15:00",
                timestampRule: EXPLICIT_ZONED_DATETIME_RULE,
            }),
        ).toBeNull();
    });

    const candidate = (rawDatetime: string, rule: unknown = EXPLICIT_ZONED_DATETIME_RULE) =>
        ({
            adapterId: "github",
            source: document.createElement("relative-time"),
            sourceKind: "relative-time" as const,
            rawDatetime,
            ...(rule === null ? {} : { timestampRule: rule }),
        }) as unknown as TimestampCandidate;

    it.each([
        ["2026-08-23T10:15Z", "2026-08-23T10:15:00.000Z"],
        ["2026-08-23T10:15:30Z", "2026-08-23T10:15:30.000Z"],
        ["2026-08-23T10:15:30.123456789Z", "2026-08-23T10:15:30.123Z"],
        ["2026-08-23T10:15:30,123456789Z", "2026-08-23T10:15:30.123Z"],
        ["20260823T101530.123456789Z", "2026-08-23T10:15:30.123Z"],
        ["20260823 101530Z", "2026-08-23T10:15:30.000Z"],
        ["2026-08-23 10:15:30Z", "2026-08-23T10:15:30.000Z"],
        ["2026-235T10:15Z", "2026-08-23T10:15:00.000Z"],
        ["2026235T1015Z", "2026-08-23T10:15:00.000Z"],
        ["2026-W34-7T10:15Z", "2026-08-23T10:15:00.000Z"],
        ["2026W347T1015Z", "2026-08-23T10:15:00.000Z"],
        ["+002026-08-23T10:15Z", "2026-08-23T10:15:00.000Z"],
        ["2026-08-23T10:15.5Z", "2026-08-23T10:15:30.000Z"],
        ["2026-08-23T24:00Z", "2026-08-24T00:00:00.000Z"],
        ["2026-08-23T10:15+00", "2026-08-23T10:15:00.000Z"],
        ["2026-08-23T10:15+0000", "2026-08-23T10:15:00.000Z"],
        ["2026-08-23T10:15+00:00", "2026-08-23T10:15:00.000Z"],
        ["2026-08-23T10:15+23", "2026-08-22T11:15:00.000Z"],
        ["2026-08-23T10:15+2359", "2026-08-22T10:16:00.000Z"],
        ["2026-08-23T10:15+23:59", "2026-08-22T10:16:00.000Z"],
        ["2026-08-23T10:15-23", "2026-08-24T09:15:00.000Z"],
        ["2026-08-23T10:15-2359", "2026-08-24T10:14:00.000Z"],
        ["2026-08-23T10:15-23:59", "2026-08-24T10:14:00.000Z"],
        ["2026-08-23T10:15-00:01", "2026-08-23T10:16:00.000Z"],
    ])("accepts complete supported instant %s", (rawDatetime, expected) => {
        const source = document.createElement("relative-time");
        const result = resolveTrustedTimestamp({ ...candidate(rawDatetime), source });
        expect(result?.source).toBe(source);
        expect(result?.sourceDatetime).toBe(rawDatetime);
        expect(result?.instant.toISOString()).toBe(expected);
    });

    it.each([
        "",
        " 2026-08-23T10:15Z",
        "2026-08-23T10:15Z ",
        "2026-08-23T10:15\nZ",
        "2026-08-23T10:15",
        "2026-08-23",
        "2026-08-23Z",
        "2026T10:15Z",
        "2026-08T10:15Z",
        "2026-W34T10:15Z",
        "2026-23T10:15Z",
        "2026-08-23T10Z",
        "2026-08-23T10.5Z",
        "2026-08-23T10:15.Z",
        "2026-08-23T10:15z",
        "2026-08-23t10:15Z",
        "2026-08-23T10:15+3",
        "2026-08-23T10:15+030",
        "2026-08-23T10:15+03:",
        "2026-08-23T10:15+03:30:00",
        "2026-08-23T10:15+24",
        "2026-08-23T10:15-24",
        "2026-08-23T10:15+2400",
        "2026-08-23T10:15-2400",
        "2026-08-23T10:15+24:00",
        "2026-08-23T10:15-24:00",
        "2026-08-23T10:15+99",
        "2026-08-23T10:15-99",
        "2026-08-23T10:15+9959",
        "2026-08-23T10:15-9959",
        "2026-08-23T10:15+99:59",
        "2026-08-23T10:15-99:59",
        "2026-08-23T10:15+23:60",
        "2026-08-23T10:15-23:60",
        "2026-08-23T10:15-00",
        "2026-08-23T10:15-0000",
        "2026-08-23T10:15-00:00",
        "2026-08-23T10:15+03:30junkZ",
        "2026-08-23T10:15Zjunk+03",
        "2026-08-23T10:15+03Z",
        "2026-08-23T10:15Zjunk",
        "2026-08-23T10:15+03:30junk",
        "2026-08-23T10:15\u0080Z",
        "2026-08-23T10:15\u009fZ",
        "2026W34T1015Z",
        "2026-02-30T10:15Z",
        "2026-13-01T10:15Z",
        "2026-W54-1T10:15Z",
        "2026-W00-1T10:15Z",
        "2026-08-23T25:15Z",
        "2026-08-23T10:60Z",
        "2026-08-23T10:15:60Z",
        "not a timestamp",
    ])("rejects unsafe or incomplete input %j", (rawDatetime) => {
        const source = document.createElement("relative-time");
        source.textContent = "3 months ago";
        const result = resolveTrustedTimestamp({ ...candidate(rawDatetime), source });
        expect(result).toBeNull();
        expect(source.textContent).toBe("3 months ago");
    });

    it.each([null, "other:rule"])("rejects rule %j", (rule) => {
        expect(resolveTrustedTimestamp(candidate("2026-08-23T10:15Z", rule))).toBeNull();
    });
});
