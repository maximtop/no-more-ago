/**
 * @file Verifies locale-aware relative-presentation classification.
 */

import { describe, expect, it } from "vitest";

import {
    CANONICAL_RELATIVE_TIME_LOCALES,
    RELATIVE_PRESENTATION_PROFILE,
    isRelativeLabelText,
} from "../../../../src/content-script/adapters/relative-presentation";

const CANONICAL = [
    "ar", "bg", "ca", "cs", "da", "de", "el", "en", "es", "es-419",
    "fa", "fi", "fil", "fr", "he", "hi", "hr", "hu", "id", "it",
    "ja", "ko", "lt", "nb", "nl", "pl", "pt-BR", "pt-PT", "ro", "ru",
    "sk", "sl", "sr", "sv", "th", "tr", "uk", "vi", "zh-CN", "zh-TW",
] as const;

/**
 * Creates one page label with an explicit inherited-language boundary.
 *
 * @param lang - BCP 47 language value placed on the label.
 * @returns - Connected label element used by the classifier.
 */
function source(lang: string): HTMLElement {
    const element = document.createElement("time");
    element.lang = lang;
    document.body.append(element);
    return element;
}

describe("relative presentation classification", () => {
    it("keeps the confirmed canonical locale set", () => {
        expect(CANONICAL_RELATIVE_TIME_LOCALES).toEqual(CANONICAL);
    });

    it.each(CANONICAL)("accepts generated relative text for %s", (locale) => {
        const label = new Intl.RelativeTimeFormat(locale, {
            numeric: "always",
            style: "long",
        }).format(-2, "hour");
        expect(isRelativeLabelText(label, source(locale), [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(true);
    });

    it.each(CANONICAL)("rejects an absolute date for %s", (locale) => {
        const label = new Intl.DateTimeFormat(locale, { dateStyle: "medium" })
            .format(new Date("2026-08-22T12:00:00Z"));
        expect(isRelativeLabelText(label, source(locale), [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
            RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
        ])).toBe(false);
    });

    it.each(CANONICAL)("accepts an unambiguous compact localized age for %s", (locale) => {
        const element = source(locale);
        const units = [
            "second", "minute", "hour", "day", "week", "month", "year",
        ] as const;
        const labels = units.flatMap((unit) => ["short", "narrow"].map((unitDisplay) =>
            new Intl.NumberFormat(locale, {
                style: "unit",
                unit,
                unitDisplay: unitDisplay as "short" | "narrow",
            }).format(2)));
        expect(labels.some((label) => isRelativeLabelText(label, element, [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
            RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
        ]))).toBe(true);
    });

    it.each(CANONICAL)("rejects unknown wording for %s", (locale) => {
        expect(isRelativeLabelText(`unsupported-${locale}`, source(locale), [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
            RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
        ])).toBe(false);
    });

    it.each([
        ["bg", { year: "numeric" }],
        ["ko", { day: "numeric" }],
        ["zh-CN", { year: "numeric" }],
    ] as const)("rejects an ambiguous compact/absolute shape for %s", (
        locale,
        options,
    ) => {
        const label = new Intl.DateTimeFormat(locale, {
            ...options,
            timeZone: "UTC",
        }).format(new Date("2026-08-22T12:00:00Z"));
        expect(isRelativeLabelText(label, source(locale), [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
            RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
        ])).toBe(false);
    });

    it.each([
        ["ro", "long"],
        ["sv", "short"],
    ] as const)("rejects a compact age that is also a calendar fragment for %s", (
        locale,
        weekday,
    ) => {
        const date = new Date("2026-02-02T12:00:00Z");
        const label = new Intl.DateTimeFormat(locale, {
            month: "numeric",
            weekday,
            timeZone: "UTC",
        }).format(date);
        expect(label).toBe(new Intl.NumberFormat(locale, {
            style: "unit",
            unit: "month",
            unitDisplay: "short",
        }).format(2));
        expect(isRelativeLabelText(label, source(locale), [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
            RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
        ])).toBe(false);
    });

    it("recognizes concrete Polish and Ukrainian examples", () => {
        expect(isRelativeLabelText("2 godz. temu", source("pl"), [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(true);
        expect(isRelativeLabelText("2 години тому", source("uk"), [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(true);
    });

    it.each([
        ["cs", -1.5, "hour"],
        ["pl", -1.5, "hour"],
        ["fr", -1_000_000, "year"],
    ] as const)("covers non-integer plural forms for %s", (locale, value, unit) => {
        const label = new Intl.RelativeTimeFormat(locale, {
            numeric: "always",
            style: "long",
        }).format(value, unit);
        expect(isRelativeLabelText(label, source(locale), [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(true);
    });

    it("allows bare units only for a compact age profile", () => {
        const element = source("en");
        expect(isRelativeLabelText("33w", element, [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(false);
        expect(isRelativeLabelText("33w", element, [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
            RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
        ])).toBe(true);
    });

    it.each([
        "Aug 22, 2026",
        "16:08",
        "2 hrs",
        "2 3 hours ago",
        "unknown label",
    ])(
        "fails closed for %s",
        (label) => {
            expect(isRelativeLabelText(label, source("en"), [], [
                RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
                RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
            ])).toBe(false);
        },
    );

    it("does not override an empty or unsupported explicit language", () => {
        expect(isRelativeLabelText("2 hours ago", source(""), ["en-US"], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(false);
        expect(isRelativeLabelText("2 hours ago", source("zz"), ["en-US"], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(false);
    });

    it.each([
        ["en-US", "en"],
        ["es-MX", "es-419"],
        ["pt", "pt-PT"],
        ["zh-HK", "zh-TW"],
    ] as const)("normalizes %s into %s", (requested, canonical) => {
        const label = new Intl.RelativeTimeFormat(canonical, {
            numeric: "always",
            style: "long",
        }).format(-2, "hour");
        expect(isRelativeLabelText(label, source(requested), [], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(true);
    });

    it("uses browser preferences only when the page declares no language", () => {
        const element = document.createElement("time");
        document.body.append(element);
        expect(isRelativeLabelText("2 hours ago", element, ["zz", "en-US"], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(true);
    });

    it("fails closed for a nested language boundary inside one label", () => {
        const element = source("en");
        const nested = document.createElement("span");
        nested.lang = "pl";
        nested.textContent = "2 hours ago";
        element.append(nested);
        expect(isRelativeLabelText("2 hours ago", element, ["en-US"], [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ])).toBe(false);
    });
});
