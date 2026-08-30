/**
 * @file Verifies trusted TikTok hydration and post-ID timestamp evidence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveTikTokPublicationDatetime } from
    "../../../../src/content-script/adapters/tiktok-timestamp";

const VIDEO_ID = "7639779880711749733";
const VIDEO_ID_DATETIME = "2026-05-14T16:07:47.000Z";
const VIDEO_CREATE_TIME = "1778774880";
const NOW = new Date("2026-08-30T12:00:00Z");

/**
 * Creates a deterministic 19-digit TikTok-style ID for Unix seconds.
 *
 * @param seconds - High 32-bit Unix-seconds component.
 * @param low - Non-time low bits.
 * @returns - Decimal synthetic post ID.
 */
function postIdFor(seconds: number, low = 1n): string {
    return ((BigInt(seconds) << 32n) + low).toString();
}

/**
 * Installs the observed universal hydration script.
 *
 * @param value - JSON-compatible hydration value.
 */
function installHydration(value: unknown): void {
    const script = document.createElement("script");
    script.id = "__UNIVERSAL_DATA_FOR_REHYDRATION__";
    script.type = "application/json";
    script.textContent = JSON.stringify(value);
    document.head.replaceChildren(script);
}

describe("TikTok timestamp evidence", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("prefers matching createTime and otherwise decodes the post ID", () => {
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID))
            .toBe(VIDEO_ID_DATETIME);

        installHydration({
            __DEFAULT_SCOPE__: {
                "webapp.video-detail": {
                    itemInfo: {
                        itemStruct: {
                            id: VIDEO_ID,
                            createTime: VIDEO_CREATE_TIME,
                        },
                    },
                },
            },
        });

        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID))
            .toBe("2026-05-14T16:08:00.000Z");
    });

    it("ignores stale, malformed, conflicting, and legacy hydration", () => {
        const fallback = VIDEO_ID_DATETIME;
        installHydration({
            itemStruct: { id: "7590176113704304842", createTime: "1767225602" },
        });
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID)).toBe(fallback);

        const malformed = document.querySelector("script");
        if (!malformed) {
            throw new Error("Expected hydration script");
        }
        malformed.textContent = "{invalid";
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID)).toBe(fallback);

        installHydration([
            { id: VIDEO_ID, createTime: "1778774880" },
            { id: VIDEO_ID, createTime: "1778774940" },
        ]);
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID)).toBe(fallback);

        document.head.innerHTML = '<script id="SIGI_STATE" type="application/json">'
            + JSON.stringify({ itemStruct: { id: VIDEO_ID, createTime: "1778774880" } })
            + "</script>";
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID)).toBe(fallback);
    });

    it("accepts the confirmed inclusive bounds and rejects values outside", () => {
        const minimumSeconds = Date.parse("2016-01-01T00:00:00Z") / 1_000;
        const maximumSeconds = NOW.getTime() / 1_000 + 86_400;

        expect(resolveTikTokPublicationDatetime(
            document,
            postIdFor(minimumSeconds),
        )).toBe("2016-01-01T00:00:00.000Z");
        expect(resolveTikTokPublicationDatetime(
            document,
            postIdFor(minimumSeconds - 1),
        )).toBeNull();
        expect(resolveTikTokPublicationDatetime(
            document,
            postIdFor(maximumSeconds),
        )).toBe(new Date(maximumSeconds * 1_000).toISOString());
        expect(resolveTikTokPublicationDatetime(
            document,
            postIdFor(maximumSeconds + 1),
        )).toBeNull();

        installHydration({ id: VIDEO_ID, createTime: String(minimumSeconds) });
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID))
            .toBe("2016-01-01T00:00:00.000Z");
        installHydration({ id: VIDEO_ID, createTime: String(minimumSeconds - 1) });
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID))
            .toBe(VIDEO_ID_DATETIME);
        installHydration({ id: VIDEO_ID, createTime: String(maximumSeconds) });
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID))
            .toBe(new Date(maximumSeconds * 1_000).toISOString());
        installHydration({ id: VIDEO_ID, createTime: String(maximumSeconds + 1) });
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID))
            .toBe(VIDEO_ID_DATETIME);
    });

    it.each([
        "",
        "763977988071174973",
        "07639779880711749733",
        "76397798807117497330",
        "+7639779880711749733",
        "763977988071174973x",
        "7639779880711749733 ",
    ])("rejects unsupported post ID %j", (postId) => {
        expect(resolveTikTokPublicationDatetime(document, postId)).toBeNull();
    });

    it("falls back when matching createTime is not a plausible string", () => {
        installHydration({
            validShapeWrongValue: { id: VIDEO_ID, createTime: "9999999999" },
            numericScalars: { id: Number(VIDEO_ID), createTime: 1_778_774_880 },
        });

        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID))
            .toBe(VIDEO_ID_DATETIME);
    });

    it("caches a malformed hydration snapshot until its text changes", () => {
        document.head.innerHTML = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" '
            + 'type="application/json">{invalid</script>';
        const script = document.querySelector("script");
        if (!(script instanceof HTMLScriptElement)) {
            throw new Error("Expected malformed hydration script");
        }
        const parse = vi.spyOn(JSON, "parse");

        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID)).toBe(VIDEO_ID_DATETIME);
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID)).toBe(VIDEO_ID_DATETIME);
        expect(parse).toHaveBeenCalledTimes(1);

        script.textContent = JSON.stringify({
            itemInfo: { itemStruct: { id: VIDEO_ID, createTime: VIDEO_CREATE_TIME } },
        });
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID))
            .toBe("2026-05-14T16:08:00.000Z");
        expect(parse).toHaveBeenCalledTimes(2);
    });

    it("falls back without throwing when hydration exceeds the traversal budget", () => {
        installHydration(Array.from({ length: 100_001 }, () => ({})));

        expect(() => resolveTikTokPublicationDatetime(document, VIDEO_ID)).not.toThrow();
        expect(resolveTikTokPublicationDatetime(document, VIDEO_ID)).toBe(VIDEO_ID_DATETIME);
    });
});
