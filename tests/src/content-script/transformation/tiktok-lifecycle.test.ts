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

/**
 * Reads the verified generated output following one profile link.
 *
 * @param link - Page-owned profile link.
 * @returns - Owned generated time element.
 */
function outputAfter(link: HTMLAnchorElement): HTMLTimeElement {
    const output = link.nextElementSibling;
    if (!(output instanceof HTMLTimeElement)) {
        throw new Error(`Expected generated output after ${link.id}`);
    }
    return output;
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
            expect(controller.start()).toHaveLength(100);
            expect(document.querySelectorAll("[data-no-more-ago-output]")).toHaveLength(100);
            const initialOutputs = links.map(outputAfter);
            const initialTexts = initialOutputs.map((output) => output.textContent);
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

            expect(document.querySelectorAll("[data-no-more-ago-output]")).toHaveLength(100);
            expect(outputAfter(changedLink)).toBe(initialOutputs[changedIndex]);
            expect(outputAfter(changedLink).textContent).toBe("2026-05-15 16:08");
            for (const [index, link] of links.entries()) {
                if (index !== changedIndex) {
                    expect(outputAfter(link)).toBe(initialOutputs[index]);
                    expect(outputAfter(link).textContent).toBe(initialTexts[index]);
                }
            }

            changedLink.setAttribute("href", "/@fictional/video/not-a-post-id");
            await flushMutations();
            expect(changedLink.nextElementSibling).toBeNull();
            expect(document.querySelectorAll("[data-no-more-ago-output]")).toHaveLength(99);

            changedLink.setAttribute(
                "href",
                `/@fictional/photo/${publicationId(1_778_861_280, 100)}`,
            );
            await flushMutations();
            expect(outputAfter(changedLink).textContent).toBe("2026-05-15 16:08");
            expect(document.querySelectorAll("[data-no-more-ago-output]")).toHaveLength(100);

            const added = appendProfileCard(
                publicationId(1_609_459_200, 7),
                100,
                "photo",
            );
            await flushMutations();
            expect(outputAfter(added).textContent).toBe("2021-01-01 00:00");
            expect(document.querySelectorAll("[data-no-more-ago-output]")).toHaveLength(101);

            const addedOwner = added.parentElement;
            if (!addedOwner) {
                throw new Error("Expected added card owner");
            }
            addedOwner.remove();
            await flushMutations();
            expect(added.isConnected).toBe(false);
            expect(document.querySelectorAll("[data-no-more-ago-output]")).toHaveLength(100);
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
            expect(outputAfter(first).textContent).toBe("2026-05-14 16:08");

            owner.append(second);
            await flushMutations();
            expect(first.nextElementSibling).toBe(second);
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

            second.remove();
            await flushMutations();
            expect(outputAfter(first).textContent).toBe("2026-05-14 16:08");
        } finally {
            controller.teardown();
        }
    });

    it("selects current rules after navigating from an unsupported route", async () => {
        const id = publicationId(1_778_774_880, 3);
        document.body.innerHTML = '<div id="metadata" data-e2e="placeholder">'
            + '<span>Fictional</span><span> · </span>'
            + '<span id="route-date">page date</span></div>';
        const source = document.getElementById("metadata");
        const date = document.getElementById("route-date");
        if (!source || !date) {
            throw new Error("Expected route-change fixture");
        }
        let currentUrl = new URL("https://www.tiktok.com/foryou");
        const controller = new DocumentTransformationController({
            url: currentUrl,
            urlProvider: () => currentUrl,
            root: document,
            locales: LOCALES,
            display: UTC_DISPLAY,
        });

        try {
            controller.start();
            expect(date.textContent).toBe("page date");

            currentUrl = new URL(`https://www.tiktok.com/@fictional/video/${id}`);
            source.setAttribute("data-e2e", "browser-nickname");
            await flushMutations();
            expect(date.textContent).toBe("2026-05-14 16:08");

            currentUrl = new URL("https://www.tiktok.com/foryou");
            source.setAttribute("data-e2e", "placeholder");
            await flushMutations();
            expect(date.textContent).toBe("page date");
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
            expect(outputAfter(link).textContent).toBe("2026-05-14 16:07:50");

            document.head.append(script);
            await flushMutations();
            expect(outputAfter(link).textContent).toBe("2026-05-14 16:08:00");

            script.textContent = JSON.stringify({
                itemInfo: { itemStruct: { id, createTime: "1778774940" } },
            });
            await flushMutations();
            expect(outputAfter(link).textContent).toBe("2026-05-14 16:09:00");
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
            + '<span id="date">page first</span></div>';
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
            dateText.data = "page second";
            await flushMutations();
            expect(date.textContent).toBe("2026-05-15 16:08");
            expect(date.textContent).not.toBe("2026-05-14 16:08");

            currentUrl = new URL("https://www.tiktok.com/foryou");
            dateText.data = "page feed";
            await flushMutations();
            expect(date.textContent).toBe("page feed");
            expect(source.hasAttribute("data-no-more-ago-source")).toBe(false);
        } finally {
            controller.teardown();
        }

        expect(date.textContent).toBe("page feed");
        expect(document.getElementById("metadata")).toBe(source);
    });

    it("moves direct feed ownership between current SPA articles", async () => {
        const firstId = publicationId(1_778_774_880, 10);
        const secondId = publicationId(1_778_861_280, 11);
        const first = appendDirectFeedArticle(firstId, 0, "page first");
        const second = appendDirectFeedArticle(secondId, 1, "page second");
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
            expect(first.date.textContent).toBe("2026-05-14 16:08");
            expect(second.date.textContent).toBe("page second");

            currentUrl = new URL(
                `https://www.tiktok.com/@fictional/video/${secondId}`,
            );
            first.wrapper.id = `xgwrapper-2-${firstId}`;
            second.wrapper.id = `xgwrapper-0-${secondId}`;
            await flushMutations();

            expect(first.date.textContent).toBe("page first");
            expect(second.date.textContent).toBe("2026-05-15 16:08");
            expect(first.article.isConnected).toBe(true);
            expect(second.article.isConnected).toBe(true);
        } finally {
            controller.teardown();
        }

        expect(first.date.textContent).toBe("page first");
        expect(second.date.textContent).toBe("page second");
    });

    it("retargets a replacement direct-page label without replacing its owner", async () => {
        const id = publicationId(1_778_774_880, 4);
        document.body.innerHTML = '<div id="replacement-source" '
            + 'data-e2e="browser-nickname" data-kept="yes">'
            + '<span>Fictional</span><span> · </span>'
            + '<span id="first-target">page first</span></div>';
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
        replacement.textContent = "page replacement";

        try {
            controller.start();
            expect(firstTarget.textContent).toBe("2026-05-14 16:08");
            firstTarget.replaceWith(replacement);
            await flushMutations();
            expect(firstTarget.textContent).toBe("page first");
            expect(replacement.textContent).toBe("2026-05-14 16:08");
            expect(document.getElementById("replacement-source")).toBe(source);
            expect(source.getAttribute("data-kept")).toBe("yes");
        } finally {
            controller.teardown();
        }

        expect(replacement.textContent).toBe("page replacement");
        expect(document.getElementById("replacement-source")).toBe(source);
    });

    it("reformats fallback output without changing its source association", () => {
        const id = publicationId(1_778_774_880, 3);
        const link = appendProfileCard(id, 1);
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
        const url = new URL("https://www.tiktok.com/@fictional");
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
            const output = outputAfter(link);
            for (const nextDisplay of displays) {
                display = nextDisplay;
                controller.reformatOwned();
                expect(outputAfter(link)).toBe(output);
                expect(output.textContent)
                    .toBe(formatDateWithPresentation(instant, LOCALES, display).text);
            }
            const diagnosticText = JSON.stringify(diagnostics.mock.calls);
            expect(diagnosticText).not.toContain(id);
            expect(diagnosticText).not.toContain("1778774880");
            expect(diagnosticText).not.toContain("/@fictional");
        } finally {
            controller.teardown();
        }

        expect(link.nextElementSibling).toBeNull();
    });

    it("fails closed without retaining invalid TikTok numeric evidence", () => {
        const implausibleId = publicationId(2_000_000_000, 1);
        document.body.innerHTML = '<div data-e2e="browser-nickname">'
            + '<span>Fictional</span><span> · </span>'
            + '<span id="invalid-date">page date</span></div>';
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
            expect(date.textContent).toBe("page date");
            expect(diagnostics).toHaveBeenCalled();
            const diagnosticText = JSON.stringify(diagnostics.mock.calls);
            expect(diagnosticText).not.toContain(implausibleId);
            expect(diagnosticText).not.toContain("2000000000");
            expect(diagnosticText).not.toContain("/@fictional");
        } finally {
            controller.teardown();
        }

        expect(date.textContent).toBe("page date");
    });
});
