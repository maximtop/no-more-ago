/**
 * @file Exercises TikTok behavior through deterministic offline fixtures.
 */

import { readFile } from "node:fs/promises";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentTransformationController } from
    "../../../../src/content-script/transformation/document-transformation-controller";

const FIXTURE_NAMES = [
    "direct-video.html",
    "direct-photo.html",
    "direct-feed-video.html",
    "profile.html",
    "eligibility-matrix.html",
] as const;
const fixtures = new Map<string, string>();
const UTC_DISPLAY = {
    formatMode: "custom",
    pattern: "yyyy-MM-dd HH:mm",
    timeZone: { mode: "utc" },
} as const;

describe("TikTok fixtures", () => {
    beforeAll(async () => {
        for (const name of FIXTURE_NAMES) {
            fixtures.set(
                name,
                await readFile(`tests/src/content-script/fixtures/tiktok/${name}`, "utf8"),
            );
        }
    });

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        {
            fixture: "direct-video.html",
            url: "https://www.tiktok.com/@fictional/video/7639779880711749733",
            metadataId: "video-metadata",
            dateId: "video-date",
            controlId: "video-control",
            original: "5-14",
            expected: "2026-05-14 16:08",
        },
        {
            fixture: "direct-photo.html",
            url: "https://www.tiktok.com/@fictional/photo/7590176113704304842",
            metadataId: "photo-metadata",
            dateId: "photo-date",
            controlId: "photo-control",
            original: "12-31",
            expected: "2026-01-01 00:00",
        },
        {
            fixture: "direct-feed-video.html",
            url: "https://www.tiktok.com/@fictional/video/7639779880711749733",
            metadataId: "feed-current",
            dateId: "feed-date",
            controlId: "feed-control",
            original: " · 5-14",
            expected: "2026-05-14 16:08",
        },
    ])("updates and restores $fixture in place", (fixtureCase) => {
        document.body.innerHTML = fixtures.get(fixtureCase.fixture) ?? "";
        const metadata = document.getElementById(fixtureCase.metadataId);
        const date = document.getElementById(fixtureCase.dateId);
        const control = document.getElementById(fixtureCase.controlId);
        const recommendationDate = document.getElementById("feed-recommendation-date");
        if (!metadata || !date || !(control instanceof HTMLButtonElement)) {
            throw new Error("Expected direct TikTok fixture");
        }
        const listener = vi.fn();
        control.addEventListener("click", listener);
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
            throw new Error("TikTok timestamp support must not use the network");
        });
        const xhrOpen = Object.getOwnPropertyDescriptor(
            globalThis.XMLHttpRequest.prototype,
            "open",
        );
        const xhrSend = Object.getOwnPropertyDescriptor(
            globalThis.XMLHttpRequest.prototype,
            "send",
        );
        const url = new URL(fixtureCase.url);
        const controller = new DocumentTransformationController({
            url,
            urlProvider: () => url,
            root: document,
            locales: ["en-US"],
            display: UTC_DISPLAY,
        });

        try {
            expect(controller.start()).toEqual([]);
            expect(document.getElementById(fixtureCase.metadataId)).toBe(metadata);
            expect(document.getElementById(fixtureCase.dateId)).toBe(date);
            expect(date.textContent).toBe(fixtureCase.expected);
            expect(metadata.getAttribute("data-style-hook")).toBe("kept");
            expect(metadata.hasAttribute("hidden")).toBe(false);
            if (recommendationDate) {
                expect(recommendationDate.textContent).toBe(" · 12-31");
            }
            control.click();
            expect(listener).toHaveBeenCalledOnce();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(Object.getOwnPropertyDescriptor(
                globalThis.XMLHttpRequest.prototype,
                "open",
            )).toEqual(xhrOpen);
            expect(Object.getOwnPropertyDescriptor(
                globalThis.XMLHttpRequest.prototype,
                "send",
            )).toEqual(xhrSend);
        } finally {
            controller.teardown();
            fetchMock.mockRestore();
        }

        expect(date.textContent).toBe(fixtureCase.original);
        if (recommendationDate) {
            expect(recommendationDate.textContent).toBe(" · 12-31");
        }
        expect(document.getElementById(fixtureCase.metadataId)).toBe(metadata);
        expect(document.getElementById(fixtureCase.controlId)).toBe(control);
    });

    it("adds one reversible exact date after each eligible profile card", () => {
        document.body.innerHTML = fixtures.get("profile.html") ?? "";
        const video = document.getElementById("profile-video");
        const photo = document.getElementById("profile-photo");
        const fallback = document.getElementById("profile-fallback");
        if (
            !(video instanceof HTMLAnchorElement)
            || !(photo instanceof HTMLAnchorElement)
            || !(fallback instanceof HTMLAnchorElement)
        ) {
            throw new Error("Expected TikTok profile links");
        }
        const listener = vi.fn((event: Event) => {
            event.preventDefault();
        });
        video.addEventListener("click", listener);
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
            throw new Error("TikTok timestamp support must not use the network");
        });
        const url = new URL("https://www.tiktok.com/@fictional");
        const controller = new DocumentTransformationController({
            url,
            urlProvider: () => url,
            root: document,
            locales: ["en-US"],
            display: UTC_DISPLAY,
        });

        try {
            expect(controller.start()).toHaveLength(3);
            expect(video.nextElementSibling?.textContent).toBe("2026-05-14 16:08");
            expect(photo.nextElementSibling?.textContent).toBe("2026-01-01 00:00");
            expect(fallback.nextElementSibling?.textContent).toBe("2025-07-01 00:00");
            const videoOutput = video.nextElementSibling;
            if (!(videoOutput instanceof HTMLTimeElement)) {
                throw new Error("Expected generated video date");
            }
            expect(videoOutput.dateTime).toBe("2026-05-14T16:08:00.000Z");
            expect(videoOutput.style.display).toBe("block");
            expect(video.hasAttribute("hidden")).toBe(false);
            expect(photo.hasAttribute("hidden")).toBe(false);
            expect(document.getElementById("profile-invalid")?.nextElementSibling)
                .toBeNull();
            video.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            expect(listener).toHaveBeenCalledOnce();
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            controller.teardown();
            fetchMock.mockRestore();
        }

        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(document.getElementById("profile-video")).toBe(video);
        expect(document.getElementById("profile-photo")).toBe(photo);
        expect(document.getElementById("profile-fallback")).toBe(fallback);
    });

    it("fails closed for ambiguous TikTok markup and retains generic fallback", () => {
        document.body.innerHTML = fixtures.get("eligibility-matrix.html") ?? "";
        const url = new URL("https://www.tiktok.com/@fictional");
        const controller = new DocumentTransformationController({
            url,
            urlProvider: () => url,
            root: document,
            locales: ["en-US"],
            display: UTC_DISPLAY,
        });

        try {
            expect(controller.start()).toHaveLength(1);
            expect(document.getElementById("ambiguous-video")?.nextElementSibling)
                .toBe(document.getElementById("ambiguous-photo"));
            expect(document.getElementById("ambiguous-photo")?.nextElementSibling)
                .toBeNull();
            expect(document.getElementById("complex-date")?.textContent)
                .toBe("5-14 edited");
            expect(document.getElementById("relative-only")?.textContent)
                .toBe("3 days ago");
            expect(
                document.getElementById("generic-tiktok-time")
                    ?.nextElementSibling?.textContent,
            ).toBe("2026-05-14 16:08");
        } finally {
            controller.teardown();
        }
    });
});
