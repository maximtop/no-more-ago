/**
 * @file Exercises TikTok mutation, SPA, scale, display, and restoration behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatDateWithPresentation } from
    "../../../../src/shared/date/format-default-date";
import type { DisplaySettings } from
    "../../../../src/shared/settings/snapshot";
import { DocumentTransformationController } from
    "../../../../src/content-script/transformation/document-transformation-controller";
import { classifyYouTubeWatchRouteHandoff } from
    "../../../../src/content-script/adapters/youtube-watch-route-handoff";

const LOCALES = ["en-US"] as const;
const UTC_DISPLAY = {
    formatMode: "custom",
    pattern: "yyyy-MM-dd HH:mm",
    timeZone: { mode: "utc" },
} as const;

/**
 * Allows mutation delivery and document reconciliation to finish.
 *
 * @returns - Promise settled after queued mutation work.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Creates a deterministic TikTok-shaped 19-digit ID for one Unix second.
 *
 * @param unixSeconds - High 32-bit timestamp portion.
 * @param lowBits - Deterministic low bits distinguishing adjacent fixtures.
 * @returns - Decimal publication ID.
 */
function publicationId(unixSeconds: number, lowBits: number): string {
    return ((BigInt(unixSeconds) << 32n) | BigInt(lowBits)).toString();
}

/**
 * Appends one eligible synthetic profile card.
 *
 * @param id - Publication ID encoded in the card href.
 * @param index - Stable card label.
 * @param kind - Publication path kind.
 * @returns - Page-owned card link.
 */
function appendProfileCard(
    id: string,
    index: number,
    kind: "video" | "photo" = "video",
): HTMLAnchorElement {
    const item = document.createElement("div");
    item.setAttribute("data-e2e", "user-post-item");
    const link = document.createElement("a");
    const indexLabel = index.toString();
    link.id = `card-${indexLabel}`;
    link.setAttribute("href", `/@fictional/${kind}/${id}`);
    link.textContent = `card ${indexLabel}`;
    item.append(link);
    document.body.append(item);
    return link;
}

/**
 * Appends one synthetic direct feed article.
 *
 * @param id - Publication ID represented by the feed wrapper.
 * @param index - Current feed position encoded by the wrapper.
 * @param pageText - Page-authored date label retained for restoration.
 * @returns - Article, wrapper, and date elements used by lifecycle assertions.
 */
function appendDirectFeedArticle(
    id: string,
    index: number,
    pageText: string,
): {
    readonly article: HTMLElement;
    readonly wrapper: HTMLDivElement;
    readonly date: HTMLSpanElement;
} {
    const article = document.createElement("article");
    article.setAttribute("data-e2e", "recommend-list-item-container");
    const wrapper = document.createElement("div");
    wrapper.id = `xgwrapper-${index.toString()}-${id}`;
    const row = document.createElement("div");
    const author = document.createElement("a");
    author.setAttribute("href", "/@fictional");
    author.textContent = "Fictional";
    const date = document.createElement("span");
    date.textContent = pageText;
    row.append(author, date);
    article.append(wrapper, row);
    document.body.append(article);
    return { article, wrapper, date };
}

describe("TikTok document lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("reconciles 100 cards, one reused card, additions, and removals", async () => {
        const links = Array.from({ length: 100 }, (_, index) =>
            appendProfileCard(
                publicationId(1_700_000_000 + index * 60, index),
                index,
                index % 2 === 0 ? "video" : "photo",
            ));
        const url = new URL("https://www.tiktok.com/@fictional");
        const controller = new DocumentTransformationController({
            url,
            urlProvider: () => url,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });

        try {
            expect(controller.start()).toEqual([]);
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
            const changedIndex = 42;
            const changedLink = links[changedIndex];
            if (!changedLink) {
                throw new Error("Expected selected profile link");
            }

            changedLink.setAttribute(
                "href",
                `/@fictional/video/${publicationId(1_778_861_280, 99)}`,
            );
            await flushMutations();

            expect(changedLink.nextElementSibling).toBeNull();
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
            expect(links.every((link) => link.textContent.startsWith("card "))).toBe(true);

            changedLink.setAttribute("href", "/@fictional/video/not-a-post-id");
            await flushMutations();
            expect(changedLink.nextElementSibling).toBeNull();
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

            changedLink.setAttribute(
                "href",
                `/@fictional/photo/${publicationId(1_778_861_280, 100)}`,
            );
            await flushMutations();
            expect(changedLink.nextElementSibling).toBeNull();
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

            const added = appendProfileCard(
                publicationId(1_609_459_200, 7),
                100,
                "photo",
            );
            await flushMutations();
            expect(added.nextElementSibling).toBeNull();
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

            const addedOwner = added.parentElement;
            if (!addedOwner) {
                throw new Error("Expected added card owner");
            }
            addedOwner.remove();
            await flushMutations();
            expect(added.isConnected).toBe(false);
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        } finally {
            controller.teardown();
        }

        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(links.every((link) => link.isConnected)).toBe(true);
    });

    it("invalidates every publication link when profile-card membership changes", async () => {
        const firstId = publicationId(1_778_774_880, 1);
        const secondId = publicationId(1_778_861_280, 2);
        const first = appendProfileCard(firstId, 1);
        const owner = first.parentElement;
        if (!owner) {
            throw new Error("Expected profile card owner");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://www.tiktok.com/@fictional"),
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });
        const second = document.createElement("a");
        second.href = `/@fictional/photo/${secondId}`;
        second.textContent = "second";

        try {
            controller.start();
            expect(first.nextElementSibling).toBeNull();

            owner.append(second);
            await flushMutations();
            expect(first.nextElementSibling).toBe(second);
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

            second.remove();
            await flushMutations();
            expect(first.nextElementSibling).toBeNull();
        } finally {
            controller.teardown();
        }
    });

    it("selects current rules after navigating from an unsupported route", async () => {
        const id = publicationId(1_778_774_880, 3);
        document.body.innerHTML = '<div id="metadata" data-e2e="placeholder">'
            + '<span>Fictional</span><span> · </span>'
            + '<span id="route-date">3d</span></div>';
        const source = document.getElementById("metadata");
        const date = document.getElementById("route-date");
        if (!source || !date) {
            throw new Error("Expected route-change fixture");
        }
        let currentUrl = new URL("https://www.tiktok.com/foryou");
        const controller = new DocumentTransformationController({
            url: currentUrl,
            urlProvider: () => currentUrl,
            routeHandoffClassifier: classifyYouTubeWatchRouteHandoff,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });

        try {
            controller.start();
            expect(date.textContent).toBe("3d");

            currentUrl = new URL(`https://www.tiktok.com/@fictional/video/${id}`);
            source.setAttribute("data-e2e", "browser-nickname");
            await flushMutations();
            expect(date.textContent).toBe("2026-05-14 16:08");

            currentUrl = new URL("https://www.tiktok.com/foryou");
            source.setAttribute("data-e2e", "placeholder");
            await flushMutations();
            expect(date.textContent).toBe("3d");
        } finally {
            controller.teardown();
        }
    });

    it("reconciles existing sources when hydration is inserted or replaced", async () => {
        const id = publicationId(1_778_774_870, 4);
        const link = appendProfileCard(id, 1);
        const controller = new DocumentTransformationController({
            url: new URL("https://www.tiktok.com/@fictional"),
            root: document,
            locales: LOCALES,
            display: {
                ...UTC_DISPLAY,
                pattern: "yyyy-MM-dd HH:mm:ss",
            },
        });
        const script = document.createElement("script");
        script.id = "__UNIVERSAL_DATA_FOR_REHYDRATION__";
        script.type = "application/json";
        script.textContent = JSON.stringify({
            itemInfo: { itemStruct: { id, createTime: "1778774880" } },
        });

        try {
            controller.start();
            expect(link.nextElementSibling).toBeNull();

            document.head.append(script);
            await flushMutations();
            expect(link.nextElementSibling).toBeNull();

            script.textContent = JSON.stringify({
                itemInfo: { itemStruct: { id, createTime: "1778774940" } },
            });
            await flushMutations();
            expect(link.nextElementSibling).toBeNull();
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        } finally {
            controller.teardown();
        }
    });

    it("uses the current URL and ignores stale hydration during SPA changes", async () => {
        const firstId = publicationId(1_778_774_870, 1);
        const secondId = publicationId(1_778_861_280, 2);
        document.head.innerHTML = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" '
            + 'type="application/json"></script>';
        const script = document.querySelector("script");
        if (!(script instanceof HTMLScriptElement)) {
            throw new Error("Expected hydration script");
        }
        script.textContent = JSON.stringify({
            itemInfo: { itemStruct: { id: firstId, createTime: "1778774880" } },
        });
        document.body.innerHTML = '<div id="metadata" data-e2e="browser-nickname">'
            + '<span>Fictional</span><span> · </span>'
            + '<span id="date">3d</span></div>';
        const source = document.getElementById("metadata");
        const date = document.getElementById("date");
        const dateText = date?.firstChild;
        if (!source || !date || !(dateText instanceof Text)) {
            throw new Error("Expected direct publication source");
        }
        let currentUrl = new URL(
            `https://www.tiktok.com/@fictional/video/${firstId}`,
        );
        const controller = new DocumentTransformationController({
            url: currentUrl,
            urlProvider: () => currentUrl,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });

        try {
            controller.start();
            expect(date.textContent).toBe("2026-05-14 16:08");

            currentUrl = new URL(
                `https://www.tiktok.com/@fictional/photo/${secondId}`,
            );
            dateText.data = "4d";
            await flushMutations();
            expect(date.textContent).toBe("2026-05-15 16:08");
            expect(date.textContent).not.toBe("2026-05-14 16:08");

            currentUrl = new URL("https://www.tiktok.com/foryou");
            dateText.data = "5d";
            await flushMutations();
            expect(date.textContent).toBe("5d");
            expect(source.hasAttribute("data-no-more-ago-source")).toBe(false);
        } finally {
            controller.teardown();
        }

        expect(date.textContent).toBe("5d");
        expect(document.getElementById("metadata")).toBe(source);
    });

    it("moves direct feed ownership between current SPA articles", async () => {
        const firstId = publicationId(1_778_774_880, 10);
        const secondId = publicationId(1_778_861_280, 11);
        const first = appendDirectFeedArticle(firstId, 0, " · 3d");
        const second = appendDirectFeedArticle(secondId, 1, " · 4d");
        let currentUrl = new URL(
            `https://www.tiktok.com/@fictional/video/${firstId}`,
        );
        const controller = new DocumentTransformationController({
            url: currentUrl,
            urlProvider: () => currentUrl,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });

        try {
            controller.start();
            expect(first.date.textContent).toBe(" · 2026-05-14 16:08");
            expect(second.date.textContent).toBe(" · 4d");

            currentUrl = new URL(
                `https://www.tiktok.com/@fictional/video/${secondId}`,
            );
            first.wrapper.id = `xgwrapper-2-${firstId}`;
            second.wrapper.id = `xgwrapper-0-${secondId}`;
            await flushMutations();

            expect(first.date.textContent).toBe(" · 3d");
            expect(second.date.textContent).toBe(" · 2026-05-15 16:08");
            expect(first.article.isConnected).toBe(true);
            expect(second.article.isConnected).toBe(true);
        } finally {
            controller.teardown();
        }

        expect(first.date.textContent).toBe(" · 3d");
        expect(second.date.textContent).toBe(" · 4d");
    });

    it("retargets a replacement direct-page label without replacing its owner", async () => {
        const id = publicationId(1_778_774_880, 4);
        document.body.innerHTML = '<div id="replacement-source" '
            + 'data-e2e="browser-nickname" data-kept="yes">'
            + '<span>Fictional</span><span> · </span>'
            + '<span id="first-target">3d</span></div>';
        const source = document.getElementById("replacement-source");
        const firstTarget = document.getElementById("first-target");
        if (!source || !firstTarget) {
            throw new Error("Expected replacement source fixture");
        }
        const url = new URL(`https://www.tiktok.com/@fictional/video/${id}`);
        const controller = new DocumentTransformationController({
            url,
            urlProvider: () => url,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });
        const replacement = document.createElement("span");
        replacement.id = "replacement-target";
        replacement.textContent = "4d";

        try {
            controller.start();
            expect(firstTarget.textContent).toBe("2026-05-14 16:08");
            firstTarget.replaceWith(replacement);
            await flushMutations();
            expect(firstTarget.textContent).toBe("3d");
            expect(replacement.textContent).toBe("2026-05-14 16:08");
            expect(document.getElementById("replacement-source")).toBe(source);
            expect(source.getAttribute("data-kept")).toBe("yes");
        } finally {
            controller.teardown();
        }

        expect(replacement.textContent).toBe("4d");
        expect(document.getElementById("replacement-source")).toBe(source);
    });

    it("reformats a direct label without changing its source association", () => {
        const id = publicationId(1_778_774_880, 3);
        document.body.innerHTML = '<div id="reformat-source" '
            + 'data-e2e="browser-nickname">'
            + '<span>Fictional</span><span> · </span>'
            + '<span id="reformat-date">3d</span></div>';
        const source = document.getElementById("reformat-source");
        const date = document.getElementById("reformat-date");
        if (!source || !date) {
            throw new Error("Expected direct reformat fixture");
        }
        const displays: readonly DisplaySettings[] = [
            { formatMode: "system", timeZone: { mode: "system" } },
            UTC_DISPLAY,
            {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm:ss",
                timeZone: { mode: "iana", identifier: "Europe/Nicosia" },
            },
        ];
        let display = displays[0] ?? UTC_DISPLAY;
        const diagnostics = vi.fn();
        const url = new URL(`https://www.tiktok.com/@fictional/video/${id}`);
        const controller = new DocumentTransformationController({
            url,
            urlProvider: () => url,
            root: document,
            localesProvider: () => LOCALES,
            displayProvider: () => display,
            diagnosticSink: diagnostics,
        });
        const instant = new Date(1_778_774_880_000);

        try {
            controller.start();
            for (const nextDisplay of displays) {
                display = nextDisplay;
                controller.reformatOwned();
                expect(document.getElementById("reformat-source")).toBe(source);
                expect(document.getElementById("reformat-date")).toBe(date);
                expect(date.textContent)
                    .toBe(formatDateWithPresentation(instant, LOCALES, display).text);
            }
            const diagnosticText = JSON.stringify(diagnostics.mock.calls);
            expect(diagnosticText).not.toContain(id);
            expect(diagnosticText).not.toContain("1778774880");
            expect(diagnosticText).not.toContain("/@fictional");
        } finally {
            controller.teardown();
        }

        expect(date.textContent).toBe("3d");
    });

    it("fails closed without retaining invalid TikTok numeric evidence", () => {
        const implausibleId = publicationId(2_000_000_000, 1);
        document.body.innerHTML = '<div data-e2e="browser-nickname">'
            + '<span>Fictional</span><span> · </span>'
            + '<span id="invalid-date">3d</span></div>';
        const date = document.getElementById("invalid-date");
        if (!date) {
            throw new Error("Expected invalid direct date fixture");
        }
        const diagnostics = vi.fn();
        const url = new URL(
            `https://www.tiktok.com/@fictional/video/${implausibleId}`,
        );
        const controller = new DocumentTransformationController({
            url,
            urlProvider: () => url,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
            diagnosticSink: diagnostics,
        });

        try {
            expect(controller.start()).toEqual([]);
            expect(date.textContent).toBe("3d");
            expect(diagnostics).toHaveBeenCalled();
            const diagnosticText = JSON.stringify(diagnostics.mock.calls);
            expect(diagnosticText).not.toContain(implausibleId);
            expect(diagnosticText).not.toContain("2000000000");
            expect(diagnosticText).not.toContain("/@fictional");
        } finally {
            controller.teardown();
        }

        expect(date.textContent).toBe("3d");
    });
});
