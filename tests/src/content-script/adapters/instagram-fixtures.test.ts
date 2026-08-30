/**
 * @file Verifies Instagram styling preservation and dynamic timestamp behavior offline.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
    DocumentTransformationController,
} from "../../../../src/content-script/transformation/document-transformation-controller";

let fixture = "";

/**
 * Flushes queued mutation reconciliation work.
 *
 * @returns - Promise settled after observer and reconciliation microtasks.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("Instagram fixture", () => {
    beforeAll(async () => {
        fixture = await readFile(
            "tests/src/content-script/fixtures/instagram/post.html",
            "utf8",
        );
    });

    beforeEach(() => {
        document.body.innerHTML = fixture;
    });

    it("keeps timestamp elements and styling hooks while restoring their labels", () => {
        const caption = document.getElementById("caption-age");
        const publication = document.getElementById("publication-age");
        if (!(caption instanceof HTMLTimeElement) || !(publication instanceof HTMLTimeElement)) {
            throw new Error("Expected Instagram timestamp elements");
        }
        const captionParent = caption.parentElement;
        const captionClass = caption.className;
        const captionStyle = caption.getAttribute("style");
        const controller = new DocumentTransformationController({
            url: new URL("https://www.instagram.com/p/example/"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "utc" },
            },
        });

        expect(controller.start()).toEqual([]);
        expect(document.getElementById("caption-age")).toBe(caption);
        expect(document.getElementById("publication-age")).toBe(publication);
        expect(caption.textContent).toBe("2026-01-08 18:45");
        expect(publication.textContent).toBe("2026-01-07 22:26");
        expect(caption.parentElement).toBe(captionParent);
        expect(caption.className).toBe(captionClass);
        expect(caption.getAttribute("style")).toBe(captionStyle);
        expect(caption.hasAttribute("hidden")).toBe(false);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

        controller.teardown();
        expect(caption.textContent).toBe("33w");
        expect(publication.textContent).toBe("January 8");
        expect(caption.className).toBe(captionClass);
        expect(caption.getAttribute("style")).toBe(captionStyle);
    });

    it("processes and restores a dynamically added comment label", async () => {
        const controller = new DocumentTransformationController({
            url: new URL("https://www.instagram.com/p/example/"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "utc" },
            },
        });
        controller.start();
        const commentTime = document.createElement("time");
        commentTime.className = "comment-age";
        commentTime.dateTime = "2026-01-08T19:44:00.000Z";
        commentTime.textContent = "5m";
        document.getElementById("comments")?.append(commentTime);

        await flushMutations();
        expect(commentTime.textContent).toBe("2026-01-08 19:44");
        expect(commentTime.className).toBe("comment-age");
        expect(commentTime.hasAttribute("hidden")).toBe(false);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();

        controller.teardown();
        expect(commentTime.textContent).toBe("5m");
    });
});
