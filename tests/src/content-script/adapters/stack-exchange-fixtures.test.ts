/**
 * @file Verifies Stack Exchange behavior against representative offline fixtures.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
    DocumentTransformationController,
} from "../../../../src/content-script/transformation/document-transformation-controller";
import { AdapterRegistry } from "../../../../src/content-script/adapters/registry";
import {
    stackExchangeAdapter,
} from "../../../../src/content-script/adapters/stack-exchange";

const FIXTURE_NAMES = [
    "questions.html",
    "question.html",
    "eligibility-matrix.html",
] as const;
const fixtures = new Map<string, string>();

/**
 * Allows native mutation delivery and the controller's queued reconciliation to complete.
 *
 * @returns - Promise resolved after pending mutation microtasks.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("Stack Exchange fixtures", () => {
    beforeAll(async () => {
        for (const name of FIXTURE_NAMES) {
            const path = `tests/src/content-script/fixtures/stack-exchange/${name}`;
            fixtures.set(name, await readFile(path, "utf8"));
        }
    });

    it("replaces question-list labels in place and restores them", () => {
        document.body.innerHTML = fixtures.get("questions.html") ?? "";
        const controller = new DocumentTransformationController({
            url: new URL("https://stackoverflow.com/questions"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        expect(document.querySelector("#first-question")?.textContent)
            .toBe("2026-08-29 13:39");
        expect(document.querySelector("#second-question")?.textContent)
            .toBe("2026-08-29 11:19");
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
        expect(document.querySelector("#first-question")?.textContent).toBe("1 minute ago");
        expect(document.querySelector("#second-question")?.textContent).toBe("2 hours ago");
    });

    it("preserves question-page elements while specialized and generic sources coexist", () => {
        document.body.innerHTML = fixtures.get("question.html") ?? "";
        const activity = document.querySelector("#last-activity");
        if (!(activity instanceof HTMLAnchorElement)) {
            throw new Error("Expected last-activity link");
        }
        const originalActivityAttributes = Array.from(activity.attributes)
            .map(({ name, value }) => [name, value]);
        const listener = vi.fn((event: Event) => {
            event.preventDefault();
        });
        activity.addEventListener("click", listener);
        const controller = new DocumentTransformationController({
            url: new URL("https://stackoverflow.com/questions/11227809/example"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        expect(document.querySelector("#last-activity")?.textContent).toBe("2026-04-08 05:35");
        expect(document.querySelector("#edited")?.textContent.trim())
            .toBe("Mar 4, 2024 at 17:37");
        expect(document.querySelector("#comment")?.textContent)
            .toBe("Mar 31, 2021 at 9:07");
        expect(document.querySelector("#user-card")?.textContent).toBe("2020-07-12 23:52");
        expect(document.querySelector("#asked")?.nextElementSibling?.textContent)
            .toBe("2026-08-29 13:39");
        expect(document.querySelectorAll("[data-no-more-ago-output]")).toHaveLength(1);
        expect(Array.from(activity.attributes).map(({ name, value }) => [name, value]))
            .toEqual(originalActivityAttributes);
        activity.dispatchEvent(new MouseEvent("click", { cancelable: true }));
        expect(listener).toHaveBeenCalledOnce();

        controller.teardown();
        expect(activity.textContent).toBe("4 months ago");
        expect(document.querySelector("#edited")?.textContent.trim())
            .toBe("Mar 4, 2024 at 17:37");
        expect(document.querySelector("#comment")?.textContent).toBe("Mar 31, 2021 at 9:07");
        expect(document.querySelector("#user-card")?.textContent).toBe("Over a year ago");
        expect(document.querySelector("#asked")?.textContent).toBe("today");
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
    });

    it("keeps rejected title shapes unchanged", () => {
        document.body.innerHTML = fixtures.get("eligibility-matrix.html") ?? "";
        const unchangedIds = [
            "valid-license",
            "arbitrary",
            "local",
            "padded",
            "unknown-license",
            "missing-license",
            "complex",
            "wrong-activity",
        ];
        const originalText = new Map(unchangedIds.map((id) => [
            id,
            document.getElementById(id)?.textContent,
        ]));
        const controller = new DocumentTransformationController({
            url: new URL("https://superuser.com/questions"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        const expectedYears = new Map([
            ["valid-relative", "2026"],
            ["valid-card", "2020"],
            ["valid-activity", "2026"],
        ]);
        for (const [id, expected] of expectedYears) {
            expect(document.getElementById(id)?.textContent).toBe(expected);
        }
        expect(document.querySelector("#generic")?.nextElementSibling?.textContent).toBe("2026");
        for (const [id, text] of originalText) {
            expect(document.getElementById(id)?.textContent).toBe(text);
        }
        controller.teardown();
    });

    it("processes dynamic title and href eligibility changes", async () => {
        document.body.innerHTML = '<main id="feed"></main>';
        const controller = new DocumentTransformationController({
            url: new URL("https://serverfault.com/questions"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy",
                timeZone: { mode: "utc" },
            },
        });
        controller.start();
        const feed = document.getElementById("feed");
        if (!feed) {
            throw new Error("Expected dynamic fixture root");
        }
        feed.insertAdjacentHTML(
            "beforeend",
            '<span id="dynamic" class="relativetime" '
                + 'title="2026-08-29 13:39:19Z">2 hours ago</span>',
        );
        await flushMutations();
        const dynamic = document.getElementById("dynamic");
        expect(dynamic?.textContent).toBe("2026");

        dynamic?.setAttribute("title", "2027-08-29 13:39:19Z");
        await flushMutations();
        expect(dynamic?.textContent).toBe("2027");

        dynamic?.classList.remove("relativetime");
        await flushMutations();
        await flushMutations();
        expect(dynamic?.textContent).toBe("2 hours ago");

        const activity = document.createElement("a");
        activity.id = "dynamic-activity";
        activity.href = "?other";
        activity.title = "2028-08-29 13:39:19Z";
        activity.textContent = "4 months ago";
        feed.append(activity);
        await flushMutations();
        expect(activity.textContent).toBe("4 months ago");
        activity.setAttribute("href", "?lastactivity");
        await flushMutations();
        expect(activity.textContent).toBe("2028");

        controller.teardown();
        expect(activity.textContent).toBe("4 months ago");
    });

    it("reconciles user-card datetime eligibility with only the specialized adapter", async () => {
        document.body.innerHTML = '<time class="s-user-card--time" '
            + 'title="2020-07-12T23:52:48.26Z" datetime="2020-07-12T23:52:48.26Z">'
            + "Over a year ago</time>";
        const source = document.querySelector("time");
        if (!(source instanceof HTMLTimeElement)) {
            throw new Error("Expected user-card time source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://stackoverflow.com/questions"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy",
                timeZone: { mode: "utc" },
            },
            registry: new AdapterRegistry([], stackExchangeAdapter),
        });

        controller.start();
        expect(source.textContent).toBe("Over a year ago");
        source.removeAttribute("datetime");
        await flushMutations();
        expect(source.textContent).toBe("2020");
        source.setAttribute("datetime", "2020-07-12T23:52:48.26Z");
        await flushMutations();
        expect(source.textContent).toBe("Over a year ago");
        controller.teardown();
    });

    it("updates a batch of page-owned labels and restores their latest values", async () => {
        document.body.innerHTML = Array.from(
            { length: 20 },
            (_, index) => `<span class="relativetime" title="2026-08-29 13:39:19Z">`
                + `${String(index + 1)} minutes ago</span>`,
        ).join("");
        const sources = Array.from(document.querySelectorAll("span"));
        const controller = new DocumentTransformationController({
            url: new URL("https://stackoverflow.com/questions"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy",
                timeZone: { mode: "utc" },
            },
        });

        controller.start();
        expect(sources.every((source) => source.textContent === "2026")).toBe(true);
        for (const [index, source] of sources.entries()) {
            const target = source.firstChild;
            if (!(target instanceof Text)) {
                throw new Error("Expected owned Stack Exchange label");
            }
            target.data = `${String(index + 21)} minutes ago`;
        }
        await flushMutations();
        expect(sources.every((source) => source.textContent === "2026")).toBe(true);
        controller.teardown();
        for (const [index, source] of sources.entries()) {
            expect(source.textContent).toBe(`${String(index + 21)} minutes ago`);
        }
    });
});
