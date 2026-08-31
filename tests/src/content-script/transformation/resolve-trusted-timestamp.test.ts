/**
 * @file Verifies strict resolution of explicit-zone adapter timestamps.
 */

import { describe, expect, it } from "vitest";

import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    TIMESTAMP_PRESENTATION_KIND,
    type TimestampCandidate,
} from "../../../../src/content-script/adapters/types";
import {
    parseExplicitZoneDatetime,
    resolveTrustedTimestamp,
} from "../../../../src/content-script/transformation/resolve-trusted-timestamp";
import {
    TELEGRAM_WEB_K_ADAPTER_ID,
} from "../../../../src/content-script/adapters/telegram-web-k";

const IN_PLACE_TEST_RULE_ID = "in-place-test" as const;

const unixSecondsCandidate = (rawDatetime: string): TimestampCandidate => ({
    ruleId: TELEGRAM_WEB_K_ADAPTER_ID,
    source: document.createElement("div"),
    sourceKind: TIMESTAMP_SOURCE_KIND.TELEGRAM_WEB_K_MESSAGE,
    rawDatetime,
    presentation: ADJACENT_TIME_PRESENTATION,
    validationRule: TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS,
    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
});

describe("resolveTrustedTimestamp", () => {
    it("exposes the same strict explicit-zone parser for external boundaries", () => {
        expect(parseExplicitZoneDatetime("2026-08-23T10:15:30+03:00")?.toISOString())
            .toBe("2026-08-23T07:15:30.000Z");
        expect(parseExplicitZoneDatetime("2026-08-23T10:15:30")).toBeNull();
    });

    it("resolves an exact ten-digit Unix-seconds source", () => {
        const result = resolveTrustedTimestamp(unixSecondsCandidate("1778774880"));

        expect(result?.instant.toISOString()).toBe("2026-05-14T16:08:00.000Z");
        expect(result?.sourceDatetime).toBe("1778774880");
        expect(result?.validationRule).toBe(TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS);
    });

    it.each([
        "",
        "177877488",
        "01778774880",
        "17787748800",
        "1778774880000",
        " 1778774880",
        "1778774880 ",
        "+1778774880",
        "-1778774880",
        "177877488.0",
        "1.77877488e9",
        "17787748\n80",
        "not-a-timestamp",
    ])("rejects non-contract Unix-seconds input %j", (rawDatetime) => {
        expect(resolveTrustedTimestamp(unixSecondsCandidate(rawDatetime))).toBeNull();
    });

    it("normalizes an explicitly zoned timestamp to its instant", () => {
        const result = resolveTrustedTimestamp({
            ruleId: "github",
            source: document.createElement("relative-time"),
            sourceKind: "relative-time",
            rawDatetime: "2026-08-23T10:15:00+03:00",
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        });

        expect(result?.instant.toISOString()).toBe("2026-08-23T07:15:00.000Z");
        expect(result?.sourceDatetime).toBe("2026-08-23T10:15:00+03:00");
    });

    it("rejects a timestamp without an explicit time zone", () => {
        expect(
            resolveTrustedTimestamp({
                ruleId: "github",
                source: document.createElement("relative-time"),
                sourceKind: "relative-time",
                rawDatetime: "2026-08-23T10:15:00",
                presentation: ADJACENT_TIME_PRESENTATION,
                validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
            }),
        ).toBeNull();
    });

    const candidate = (
        rawDatetime: string,
        rule: unknown = TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
    ) =>
        ({
            ruleId: "github",
            source: document.createElement("relative-time"),
            sourceKind: "relative-time" as const,
            rawDatetime,
            presentation: ADJACENT_TIME_PRESENTATION,
            ...(rule === null ? {} : { validationRule: rule }),
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        }) as unknown as TimestampCandidate;

    it("carries only a presentation target that belongs to the source", () => {
        const source = document.createElement("span");
        const target = document.createTextNode("1 hour ago");
        source.append(target);
        const base = {
            ruleId: IN_PLACE_TEST_RULE_ID,
            source,
            sourceKind: TIMESTAMP_SOURCE_KIND.HACKER_NEWS_AGE,
            rawDatetime: "2026-08-28T10:09:07.000000Z",
            validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        } as const;
        const presentation = {
            kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
            target,
        } as const;
        expect(resolveTrustedTimestamp({ ...base, presentation })?.presentation).toBe(
            presentation,
        );
        target.remove();
        expect(resolveTrustedTimestamp({ ...base, presentation })).toBeNull();
    });

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

    const htmlCandidate = (rawDatetime: string) =>
        ({
            ruleId: "generic-time",
            source: document.createElement("time"),
            sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
            rawDatetime,
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        }) as unknown as TimestampCandidate;

    it.each([
        ["2026-08-23T10:15Z", "2026-08-23T10:15:00.000Z"],
        ["2026-08-23 10:15+03:00", "2026-08-23T07:15:00.000Z"],
        ["2026-08-23T10:15+0300", "2026-08-23T07:15:00.000Z"],
        ["2026-08-23T10:15:30Z", "2026-08-23T10:15:30.000Z"],
        ["2026-08-23T10:15:30.1Z", "2026-08-23T10:15:30.100Z"],
        ["2026-08-23T10:15:30.123Z", "2026-08-23T10:15:30.123Z"],
        ["10000-01-01T00:00Z", "+010000-01-01T00:00:00.000Z"],
    ])("accepts HTML global date-time %s", (rawDatetime, expected) => {
        const result = resolveTrustedTimestamp(htmlCandidate(rawDatetime));

        expect(result?.instant.toISOString()).toBe(expected);
        expect(result?.validationRule).toBe(TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL);
    });

    it.each([
        "2026-08-23",
        "2026-08-23T10:15",
        " 2026-08-23T10:15Z",
        "2026-08-23T10:15Z ",
        "2026-08-23T10:15\nZ",
        "2026-02-30T10:15Z",
        "0000-08-23T10:15Z",
        "2026-08-23T25:15Z",
        "2026-08-23T10:15z",
        "2026-08-23T10:15+03",
        "2026-08-23T10:15-00:00",
        "2026-08-23T10:15:60Z",
        "2026-08-23T10:15Zjunk",
        "2026-08-23T10:15+24:00",
        "P1D",
        "100000000000000000000000-08-23T10:15Z",
    ])("rejects ineligible HTML global date-time %j", (rawDatetime) => {
        expect(resolveTrustedTimestamp(htmlCandidate(rawDatetime))).toBeNull();
    });

    it.each([null, "other:rule"])("rejects rule %j", (rule) => {
        expect(resolveTrustedTimestamp(candidate("2026-08-23T10:15Z", rule))).toBeNull();
    });
});
