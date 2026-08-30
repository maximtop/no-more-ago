/**
 * @file Exercises trusted YouTube watch sources through the public document boundary.
 */

import { readFile } from "node:fs/promises";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { youtubePlayerResponseAssignment } from "./youtube-test-data";

import { defaultRegistry } from "../../../../src/content-script/adapters/registry";
import { youtubeAdapter } from "../../../../src/content-script/adapters/youtube";
import { processDocument } from
    "../../../../src/content-script/transformation/process-document";
import { restoreExactTimes } from
    "../../../../src/content-script/transformation/render-exact-time";

const WATCH_URL = new URL("https://www.youtube.com/watch?v=testVID0001");
const OFFLINE_FETCH_ERROR = "Network access is forbidden in YouTube fixtures";
const forbiddenFetch = vi.fn<typeof fetch>(() => {
    throw new Error(OFFLINE_FETCH_ERROR);
});

describe("offline YouTube watch fixture", () => {
    let calendarFixture = "";
    let localSourcesFixture = "";

    beforeAll(async () => {
        [calendarFixture, localSourcesFixture] = await Promise.all([
            readFile(
                "tests/src/content-script/fixtures/youtube/watch-calendar-date.html",
                "utf8",
            ),
            readFile(
                "tests/src/content-script/fixtures/youtube/watch-local-sources.html",
                "utf8",
            ),
        ]);
    });

    beforeEach(() => {
        forbiddenFetch.mockClear();
        vi.stubGlobal("fetch", forbiddenFetch);
    });

    afterEach(() => {
        const fetchCallCount = forbiddenFetch.mock.calls.length;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        restoreExactTimes(document);
        document.documentElement.innerHTML = "<head></head><body></body>";
        expect(fetchCallCount).toBe(0);
    });

    /**
     * Loads a fresh copy of the deterministic metadata-only watch document.
     */
    function loadFixture(): void {
        document.documentElement.innerHTML = calendarFixture;
    }

    /**
     * Loads a fresh copy of the deterministic competing-source watch document.
     */
    function loadLocalSourcesFixture(): void {
        document.documentElement.innerHTML = localSourcesFixture;
    }

    /**
     * Requires the approved watch publication label from the loaded fixture.
     *
     * @returns - Approved page-owned publication label.
     */
    function requireWatchSource(): Element {
        const source = document.getElementById("watch-publication");
        if (!source) {
            throw new Error("Expected watch publication label");
        }
        return source;
    }

    /**
     * Requires the unique loaded player-response script from the fixture.
     *
     * @returns - Current loaded player-response script.
     */
    function requirePlayerScript(): HTMLScriptElement {
        const script = document.scripts[0];
        if (!script) {
            throw new Error("Expected local player-response assignment");
        }
        return script;
    }

    /**
     * Replaces the local fixture assignment with one exact synthetic response.
     *
     * @param publication - Publication value placed in the approved property.
     * @param videoId - Primary embedded video identity.
     * @param externalVideoId - Microformat embedded video identity.
     */
    function setPlayerAssignment(
        publication: unknown,
        videoId: unknown = "testVID0001",
        externalVideoId: unknown = "testVID0001",
    ): void {
        const script = requirePlayerScript();
        script.textContent = youtubePlayerResponseAssignment(
            publication,
            videoId,
            externalVideoId,
        );
    }

    it("uses valid loaded data without invoking metadata extraction", () => {
        loadLocalSourcesFixture();
        const metadataExtract = vi.spyOn(youtubeAdapter, "extract");
        const outputs = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm XXX",
                timeZone: { mode: "iana", identifier: "Pacific/Honolulu" },
            },
        });

        expect(metadataExtract).not.toHaveBeenCalled();
        expect(outputs[0]?.dateTime).toBe("2026-08-29T10:15:00+03:00");
        expect(outputs[0]?.textContent).toBe("2026-08-28 21:15 -10:00");
    });

    it("invokes metadata extraction once after loaded data is invalid", () => {
        loadLocalSourcesFixture();
        setPlayerAssignment("invalid");
        const metadataExtract = vi.spyOn(youtubeAdapter, "extract");

        const outputs = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-GB"],
        });

        expect(metadataExtract).toHaveBeenCalledOnce();
        expect(outputs[0]?.dateTime).toBe("2024-02-29");
    });

    it.each([
        { mode: "utc" as const },
        { mode: "iana" as const, identifier: "Pacific/Honolulu" },
        { mode: "iana" as const, identifier: "Pacific/Kiritimati" },
    ])("keeps a loaded calendar date invariant under $mode presentation", (timeZone) => {
        loadLocalSourcesFixture();
        setPlayerAssignment("2026-08-29");
        document.head.querySelector('meta[itemprop="datePublished"]')
            ?.setAttribute("content", "2024-02-29T23:45:00-10:00");
        const outputs = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-GB"],
            display: { formatMode: "system", timeZone },
        });
        const expected = new Intl.DateTimeFormat(["en-GB"], {
            dateStyle: "medium",
            timeZone: "UTC",
        }).format(new Date("2026-08-29T12:00:00.000Z"));

        expect(outputs[0]?.dateTime).toBe("2026-08-29");
        expect(outputs[0]?.textContent).toBe(expected);
    });

    it.each([
        {
            name: "mixed custom pattern",
            pattern: "yyyy/MM/dd 'at' HH:mm XXX",
            expected: "2024/02/29",
        },
        {
            name: "time-only custom pattern",
            pattern: "HH:mm XXX",
            expected: new Intl.DateTimeFormat(["en-GB"], {
                dateStyle: "medium",
                timeZone: "UTC",
            }).format(new Date("2024-02-29T12:00:00.000Z")),
        },
    ])("renders a loaded calendar date through a $name", ({ pattern, expected }) => {
        loadLocalSourcesFixture();
        setPlayerAssignment("2024-02-29");
        const source = requireWatchSource();
        source.textContent = "unparseable relative publication label";

        const outputs = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern,
                timeZone: { mode: "iana", identifier: "Pacific/Kiritimati" },
            },
        });

        expect(outputs).toHaveLength(1);
        expect(outputs[0]?.dateTime).toBe("2024-02-29");
        expect(outputs[0]?.textContent).toBe(expected);
        expect(source.textContent).toBe("unparseable relative publication label");
    });

    it("falls through from invalid loaded data to zoned metadata", () => {
        loadLocalSourcesFixture();
        setPlayerAssignment("not-a-timestamp");
        document.head.querySelector('meta[itemprop="datePublished"]')
            ?.setAttribute("content", "2026-08-29T10:15:00+03:00");
        const outputs = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm XXX",
                timeZone: { mode: "iana", identifier: "Pacific/Honolulu" },
            },
        });

        expect(outputs[0]?.dateTime).toBe("2026-08-29T10:15:00+03:00");
        expect(outputs[0]?.textContent).toBe("2026-08-28 21:15 -10:00");
    });

    it.each(["missing", "duplicate", "mismatched", "changed"] as const)(
        "falls through after a %s loaded assignment",
        (condition) => {
            loadLocalSourcesFixture();
            const script = requirePlayerScript();
            if (condition === "missing") {
                script.remove();
            } else if (condition === "duplicate") {
                const duplicate = document.createElement("script");
                document.head.append(duplicate);
                duplicate.textContent = script.textContent;
            } else if (condition === "mismatched") {
                setPlayerAssignment("2026-08-29", "testVID0002");
            } else {
                expect(processDocument({ url: WATCH_URL, root: document })[0]?.dateTime)
                    .toBe("2026-08-29T10:15:00+03:00");
                setPlayerAssignment("changed-to-invalid");
            }

            const outputs = processDocument({
                url: WATCH_URL,
                root: document,
                locales: ["en-GB"],
            });

            expect(outputs[0]?.dateTime).toBe("2024-02-29");
        },
    );

    it("reprocesses stable loaded data with updated presentation settings", () => {
        loadLocalSourcesFixture();
        const first = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm XXX",
                timeZone: { mode: "utc" },
            },
        });
        const second = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm XXX",
                timeZone: { mode: "iana", identifier: "Pacific/Honolulu" },
            },
        });

        expect(first[0]?.dateTime).toBe("2026-08-29T10:15:00+03:00");
        expect(second[0]).toBe(first[0]);
        expect(second[0]?.dateTime).toBe("2026-08-29T10:15:00+03:00");
        expect(second[0]?.textContent).toBe("2026-08-28 21:15 -10:00");
    });

    it("uses locale, date, time, and UTC for system instant presentation", () => {
        loadLocalSourcesFixture();
        const outputs = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-GB"],
            display: { formatMode: "system", timeZone: { mode: "utc" } },
        });
        const expected = new Intl.DateTimeFormat(["en-GB"], {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "UTC",
        }).format(new Date("2026-08-29T07:15:00.000Z"));

        expect(outputs[0]?.dateTime).toBe("2026-08-29T10:15:00+03:00");
        expect(outputs[0]?.textContent).toBe(expected);
    });

    it.each([
        { mode: "system" as const },
        { mode: "utc" as const },
        { mode: "iana" as const, identifier: "Pacific/Honolulu" },
        { mode: "iana" as const, identifier: "Pacific/Kiritimati" },
    ])("renders the same leap-day under $mode time-zone selection", (timeZone) => {
        loadFixture();
        const source = document.getElementById("watch-publication");
        const original = source?.outerHTML;
        const outputs = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-GB"],
            display: { formatMode: "system", timeZone },
        });
        const expected = new Intl.DateTimeFormat(["en-GB"], {
            dateStyle: "medium",
            timeZone: "UTC",
        }).format(new Date("2024-02-29T12:00:00.000Z"));

        expect(outputs).toHaveLength(1);
        expect(outputs[0]?.dateTime).toBe("2024-02-29");
        expect(outputs[0]?.textContent).toBe(expected);
        expect(source?.textContent).toBe("3 months ago");
        expect(source?.hasAttribute("hidden")).toBe(true);

        restoreExactTimes(document);
        expect(source?.outerHTML).toBe(original);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
    });

    it("renders and restores an ordinary calendar date", () => {
        loadFixture();
        const metadata = document.head.querySelector('meta[itemprop="datePublished"]');
        const source = document.getElementById("watch-publication");
        if (!metadata || !source) {
            throw new Error("Expected watch fixture sources");
        }
        metadata.setAttribute("content", "2026-08-29");
        const original = source.outerHTML;
        const outputs = processDocument({
            url: WATCH_URL,
            root: document,
            locales: ["en-US"],
            display: { formatMode: "system", timeZone: { mode: "utc" } },
        });
        const expected = new Intl.DateTimeFormat(["en-US"], {
            dateStyle: "medium",
            timeZone: "UTC",
        }).format(new Date("2026-08-29T12:00:00.000Z"));

        expect(outputs).toHaveLength(1);
        expect(outputs[0]?.dateTime).toBe("2026-08-29");
        expect(outputs[0]?.textContent).toBe(expected);

        restoreExactTimes(document);
        expect(source.outerHTML).toBe(original);
    });

    it.each([
        "2026-08-29",
        "2026-08-29T10:15:00+03:00",
    ])("restores a loaded semantic source exactly for %s", (rawDatetime) => {
        loadLocalSourcesFixture();
        setPlayerAssignment(rawDatetime);
        const source = requireWatchSource();
        const original = source.outerHTML;

        expect(processDocument({ url: WATCH_URL, root: document })).toHaveLength(1);
        restoreExactTimes(document);

        expect(source.outerHTML).toBe(original);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
    });

    it.each([
        ["invalid metadata", "not-a-timestamp"],
        ["missing metadata", null],
    ])("leaves the source exact with invalid loaded and %s", (_name, metadataValue) => {
        loadLocalSourcesFixture();
        setPlayerAssignment("invalid-loaded-value");
        const metadata = document.head.querySelector('meta[itemprop="datePublished"]');
        if (metadataValue === null) {
            metadata?.remove();
        } else {
            metadata?.setAttribute("content", metadataValue);
        }
        const source = requireWatchSource();
        const original = source.outerHTML;

        expect(processDocument({ url: WATCH_URL, root: document, locales: ["en-GB"] }))
            .toEqual([]);
        expect(source.outerHTML).toBe(original);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
    });

    it.each([
        "2023-02-29",
        "2024-02-30",
        "2024-2-29",
        " 2024-02-29",
        "2024-02-29 ",
        "2024-02-29\u0000",
        "2024-02-29\u009f",
        "2024-02-29T00:00:00",
        "2024-02-29T00:00:00+25:00",
    ])("leaves the exact label unchanged for invalid content %j", (rawDatetime) => {
        loadFixture();
        const metadata = document.head.querySelector('meta[itemprop="datePublished"]');
        const source = document.getElementById("watch-publication");
        if (!metadata || !source) {
            throw new Error("Expected watch fixture sources");
        }
        metadata.setAttribute("content", rawDatetime);
        const original = source.outerHTML;

        expect(processDocument({ url: WATCH_URL, root: document, locales: ["en-GB"] }))
            .toEqual([]);
        expect(source.outerHTML).toBe(original);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
    });

    it.each([
        {
            name: "relative visible text",
            apply: () => undefined,
        },
        {
            name: "date-looking visible text",
            apply: (source: Element) => {
                source.textContent = "2024-02-29";
            },
        },
        {
            name: "instant-looking visible text",
            apply: (source: Element) => {
                source.textContent = "2024-02-29T00:00:00Z";
            },
        },
        {
            name: "datetime attribute",
            apply: (source: Element) => {
                source.setAttribute("datetime", "2024-02-29");
            },
        },
        {
            name: "aria-label attribute",
            apply: (source: Element) => {
                source.setAttribute("aria-label", "2024-02-29T00:00:00Z");
            },
        },
        {
            name: "data attribute",
            apply: (source: Element) => {
                source.setAttribute("data-date", "2024-02-29");
            },
        },
        {
            name: "uploadDate metadata",
            apply: (source: Element) => {
                const metadata = source.ownerDocument.createElement("meta");
                metadata.setAttribute("itemprop", "uploadDate");
                metadata.setAttribute("content", "2024-02-29");
                source.ownerDocument.head.append(metadata);
            },
        },
    ])("does not infer a publication date from $name", ({ apply }) => {
        loadFixture();
        document.head.querySelector('meta[itemprop="datePublished"]')?.remove();
        const source = document.getElementById("watch-publication");
        if (!source) {
            throw new Error("Expected watch publication label");
        }
        apply(source);
        const original = source.outerHTML;

        expect(processDocument({ url: WATCH_URL, root: document, locales: ["en-GB"] }))
            .toEqual([]);
        expect(source.outerHTML).toBe(original);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
    });

    it("keeps specialized sources ahead of the generic fallback", () => {
        expect(defaultRegistry.matching(
            new URL("https://www.youtube.com/watch?v=testVID0001"),
        ).map((rule) => rule.id)).toEqual([
            "youtube-player-response",
            "youtube",
            "generic-time",
        ]);
        expect(defaultRegistry.matching(
            new URL("https://github.com/example/repo"),
        ).map((rule) => rule.id)).toEqual(["github", "generic-time"]);
        expect(defaultRegistry.matching(
            new URL("https://example.test/path"),
        ).map((rule) => rule.id)).toEqual(["generic-time"]);
    });
});
