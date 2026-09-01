/**
 * @file Exercises LinkedIn support against deterministic offline DOM fixtures.
 */

import { readFile } from "node:fs/promises";

import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    processDocument,
} from "../../../../src/content-script/transformation/process-document";
import {
    restoreTimestampPresentations,
} from "../../../../src/content-script/transformation/render-timestamp-presentation";

const FIXTURE_ROOT = "tests/src/content-script/fixtures/linkedin";
const files = [
    "feed.html",
    "permalink.html",
    "profile-activity.html",
    "search.html",
    "comments.html",
    "eligibility-matrix.html",
] as const;
const fixtures = new Map<string, string>();

beforeAll(async () => {
    await Promise.all(files.map(async (file) => {
        fixtures.set(file, await readFile(`${FIXTURE_ROOT}/${file}`, "utf8"));
    }));
});

beforeEach(() => {
    restoreTimestampPresentations(document);
    document.body.replaceChildren();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T00:00:00.000Z"));
});

afterEach(() => {
    restoreTimestampPresentations(document);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

/**
 * Loads one sanitized LinkedIn fixture into the JSDOM document.
 *
 * @param file - Fixture filename from the fixed matrix.
 */
function load(file: typeof files[number]): void {
    const fixture = fixtures.get(file);
    if (!fixture) {
        throw new Error(`Missing fixture ${file}`);
    }
    document.body.innerHTML = fixture;
}

/**
 * Processes the current fixture with one deterministic UTC presentation.
 *
 * @param url - LinkedIn surface URL supplied to registry matching.
 */
function process(url: string): void {
    processDocument({
        url: new URL(url),
        root: document,
        locales: ["en-GB"],
        display: {
            formatMode: "custom",
            pattern: "yyyy-MM-dd HH:mm:ss.SSS",
            timeZone: { mode: "utc" },
        },
    });
}

describe("LinkedIn offline fixtures", () => {
    it.each([
        ["feed.html", "https://www.linkedin.com/feed/", [
            ["feed-timestamp", "2024-01-02 03:04:05.678 • Edited •"],
        ]],
        ["permalink.html", "https://www.linkedin.com/feed/update/post/", [
            ["permalink-timestamp", "2024-02-03 04:05:06.789 •"],
        ]],
        ["profile-activity.html", "https://www.linkedin.com/in/example/recent-activity/", [
            ["reshare-timestamp", "4mo •"],
        ]],
        ["search.html", "https://www.linkedin.com/search/results/content/", [
            ["search-timestamp", "8mo •"],
        ]],
        ["comments.html", "https://www.linkedin.com/feed/update/post/", [
            ["comment-timestamp", "2024-04-05 06:07:08.912 • Edited"],
            ["reply-timestamp", "2024-05-06 07:08:09.123"],
        ]],
    ] as const)("processes %s", (file, url, expectations) => {
        load(file);
        process(url);

        for (const [testId, expected] of expectations) {
            expect(document.querySelector(`[data-testid='${testId}']`)?.textContent)
                .toBe(expected);
        }
    });

    it("preserves compound metadata nodes, attributes, links, and controls", () => {
        load("feed.html");
        const label = document.querySelector("[data-testid='feed-timestamp']");
        const visibility = document.querySelector("[data-testid='feed-visibility']");
        const reaction = document.querySelector("[data-testid='feed-reaction']");
        const labelAttributes = label?.getAttributeNames();
        const visibilityAttributes = visibility?.getAttributeNames();
        const onReaction = vi.fn();
        reaction?.addEventListener("click", onReaction);

        process("https://www.linkedin.com/feed/");

        expect(document.querySelector("[data-testid='feed-timestamp']")).toBe(label);
        expect(document.querySelector("[data-testid='feed-visibility']")).toBe(visibility);
        expect(document.querySelector("[data-testid='feed-reaction']")).toBe(reaction);
        expect(label?.getAttributeNames()).toEqual(labelAttributes);
        expect(visibility?.getAttributeNames()).toEqual(visibilityAttributes);
        expect(visibility?.getAttribute("href")).toBe("/visibility/connections");
        expect(label?.getAttribute("aria-label")).toBe("relative timestamp");
        expect(reaction?.textContent).toBe("React");
        reaction?.dispatchEvent(new MouseEvent("click"));
        expect(onReaction).toHaveBeenCalledTimes(1);
    });

    it("uses existing time-zone formatting without rounding milliseconds", () => {
        load("feed.html");

        processDocument({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm:ss.SSS",
                timeZone: { mode: "iana", identifier: "America/New_York" },
            },
        });

        expect(document.querySelector("[data-testid='feed-timestamp']")?.textContent)
            .toBe("2024-01-01 22:04:05.678 • Edited •");
    });

    it("keeps every rejected eligibility case byte-for-byte unchanged", () => {
        load("eligibility-matrix.html");
        const before = document.body.innerHTML;

        process("https://www.linkedin.com/feed/");

        expect(document.body.innerHTML).toBe(before);
    });

    it("uses no fetch or XMLHttpRequest timestamp fallback", () => {
        load("feed.html");
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        const open = vi.spyOn(XMLHttpRequest.prototype, "open");

        process("https://www.linkedin.com/feed/");

        expect(fetch).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
    });

    it("keeps generic datetime and unrelated permalink markup working", () => {
        load("permalink.html");
        const unrelated = document.querySelector("[data-testid='unrelated']");

        process("https://www.linkedin.com/feed/update/post/");

        expect(document.querySelector("[data-testid='unrelated']")).toBe(unrelated);
        expect(unrelated?.textContent).toBe("Unrelated content");
        expect(document.querySelectorAll("time[data-no-more-ago-output]"))
            .toHaveLength(1);
    });
});
