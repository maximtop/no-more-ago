/**
 * @file Verifies Stack Exchange behavior against representative offline fixtures.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
    DocumentTransformationController,
} from "../../../../src/content-script/transformation/document-transformation-controller";

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
        expect(document.querySelector("#first-question")?.textContent).toBe("1 min ago");
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
        expect(document.querySelector("#edited")?.textContent.trim()).toBe("2024-03-04 17:37");
        expect(document.querySelector("#comment")?.textContent).toBe("2021-03-31 09:07");
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
            ["valid-license", "2021"],
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
        activity.textContent = "last activity";
        feed.append(activity);
        await flushMutations();
        expect(activity.textContent).toBe("last activity");
        activity.setAttribute("href", "?lastactivity");
        await flushMutations();
        expect(activity.textContent).toBe("2028");

        controller.teardown();
        expect(activity.textContent).toBe("last activity");
    });
});
