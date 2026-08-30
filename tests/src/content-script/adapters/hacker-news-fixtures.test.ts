/**
 * @file Verifies offline Hacker News fixture parsing.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { hackerNewsAdapter } from "../../../../src/content-script/adapters/hacker-news";
import { AdapterRegistry } from "../../../../src/content-script/adapters/registry";
import { genericTimeRule } from "../../../../src/content-script/adapters/generic-time";
import {
    DocumentTransformationController,
} from "../../../../src/content-script/transformation/document-transformation-controller";

const FIXTURE_NAMES = [
    "list.html",
    "discussion.html",
    "absolute.html",
    "profile.html",
    "eligibility-matrix.html",
] as const;
const fixtures = new Map<string, string>();

describe("Hacker News fixtures", () => {
    beforeAll(async () => {
        for (const name of FIXTURE_NAMES) {
            const path = `tests/src/content-script/fixtures/hacker-news/${name}`;
            fixtures.set(name, await readFile(path, "utf8"));
        }
    });

    it("parse as non-empty offline documents", () => {
        for (const html of fixtures.values()) {
            document.body.innerHTML = html;
            expect(document.body.children.length).toBeGreaterThan(0);
        }
    });

    const positiveFixtures = [
        {
            name: "list.html", url: "https://news.ycombinator.com/news",
            sourceSelector: "span.age", linkSelector: 'a[href="item?id=49476604"]',
            original: "1 hour ago", expected: "2026-08-28 10:09",
        },
        {
            name: "discussion.html", url: "https://news.ycombinator.com/item?id=49476604",
            sourceSelector: "span.age", linkSelector: 'a[href="item?id=49476605"]',
            original: "52 minutes ago", expected: "2026-08-28 10:17",
        },
        {
            name: "absolute.html", url: "https://news.ycombinator.com/newest",
            sourceSelector: "#absolute", linkSelector: "#absolute-link",
            original: "Aug 27, 2026", expected: "2026-08-27 08:04",
        },
    ] as const;

    it.each(positiveFixtures)("normalizes $name without replacing its link", (fixtureCase) => {
        document.body.innerHTML = fixtures.get(fixtureCase.name) ?? "";
        const source = document.querySelector(fixtureCase.sourceSelector);
        const link = document.querySelector(fixtureCase.linkSelector);
        if (!source || !(link instanceof HTMLAnchorElement)) {
            throw new Error("Expected fixture source and link");
        }
        const sourceAttributes = Array.from(source.attributes)
            .map(({ name, value }) => [name, value]);
        const linkAttributes = Array.from(link.attributes)
            .map(({ name, value }) => [name, value]);
        const listener = vi.fn((event: Event) => {
            event.preventDefault();
        });
        link.addEventListener("click", listener);
        const controller = new DocumentTransformationController({
            url: new URL(fixtureCase.url), root: document, locales: ["en-US"],
            display: {
                formatMode: "custom", pattern: "yyyy-MM-dd HH:mm", timeZone: { mode: "utc" },
            },
        });
        controller.start();
        expect(link.textContent).toBe(fixtureCase.expected);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(document.querySelector(fixtureCase.linkSelector)).toBe(link);
        expect(Array.from(source.attributes).map(({ name, value }) => [name, value]))
            .toEqual(sourceAttributes);
        expect(Array.from(link.attributes).map(({ name, value }) => [name, value]))
            .toEqual(linkAttributes);
        link.dispatchEvent(new MouseEvent("click", { cancelable: true }));
        expect(listener).toHaveBeenCalledOnce();
        controller.teardown();
        expect(link.textContent).toBe(fixtureCase.original);
        expect(document.querySelector(fixtureCase.linkSelector)).toBe(link);
    });

    it("keeps profile prose and eligibility boundaries unchanged", () => {
        document.body.innerHTML = fixtures.get("profile.html") ?? "";
        const original = document.body.innerHTML;
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/user?id=eterevsky"),
            root: document, locales: ["en-US"],
        });
        controller.start();
        expect(document.body.innerHTML).toBe(original);
        controller.teardown();
        document.body.innerHTML = fixtures.get("eligibility-matrix.html") ?? "";
        const controller2 = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/news"), root: document,
            locales: ["en-US"],
            display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
        });
        const unchangedIds = [
            "missing-title", "blank", "padded", "local", "impossible", "malformed",
            "multiple", "complex", "wrong-element",
        ];
        const unchanged = new Map(unchangedIds.map((id) => [
            id, document.getElementById(id)?.textContent,
        ]));
        controller2.start();
        const linked = document.querySelector("#linked");
        const absolute = document.querySelector("#absolute-label");
        if (!linked || !absolute) {
            throw new Error("Expected eligible labels");
        }
        expect(linked.textContent.trim()).toBe("2026");
        expect(absolute.textContent.trim()).toBe("2026");
        expect(document.querySelector("#no-link")?.textContent).toBe("2026");
        expect(document.querySelector("time")?.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
        expect(document.querySelector("#missing-title")?.textContent).toContain("missing");
        for (const [id, text] of unchanged) {
            expect(document.getElementById(id)?.textContent).toBe(text);
        }
        expect(document.querySelectorAll("span.age")).toHaveLength(11);
        controller2.teardown();
    });

    it.each([
        { mode: "system" as const },
        { mode: "utc" as const },
        { mode: "iana" as const, identifier: "Europe/Nicosia" },
    ])("keeps Hacker News and generic presentation in parity (%s)", (timeZone) => {
        document.body.innerHTML = '<span class="age" title="2026-08-28T10:09:07.000000Z">'
            + '<a href="item?id=1">relative</a></span>'
            + '<time datetime="2026-08-28T10:09:07Z">generic</time>';
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/news"), root: document, locales: ["en-US"],
            display: { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm", timeZone },
        });
        const outputs = controller.start();
        const link = document.querySelector("span.age a");
        const output = outputs[0];
        expect(link?.textContent).toBe(output?.textContent);
        controller.teardown();
        expect(link?.textContent).toBe("relative");
        expect(output?.isConnected).toBe(false);
    });

    it(
        "processes 100 widgets incrementally and emits sanitized diagnostics without fetch",
        async () => {
            const rows = Array.from({ length: 100 }, (_, index) =>
                `<span class="age" title="2026-08-28T10:09:07.000000Z">`
            + `<a href="item?id=${String(index)}">${String(index)} minutes ago</a></span>`,
            ).join("");
            document.body.innerHTML = `<main id="matrix">${rows}</main><p id="unrelated">other</p>`;
            let visits = 0;
            const instrumented = {
                ...hackerNewsAdapter,
                extract: (element: Element, url: URL) => {
                    visits += 1;
                    return hackerNewsAdapter.extract(element, url);
                },
            };
            const sink = vi.fn();
            const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
                throw new Error("network access");
            });
            let controller: DocumentTransformationController | undefined;
            try {
                controller = new DocumentTransformationController({
                    url: new URL("https://news.ycombinator.com/news?p=2#matrix"), root: document,
                    locales: ["en-US"], diagnosticSink: sink,
                    display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
                    registry: new AdapterRegistry([instrumented], genericTimeRule),
                });
                controller.start();
                expect(visits).toBe(100);
                expect(document.querySelectorAll(
                    "[data-no-more-ago-output]",
                )).toHaveLength(0);
                expect(Array.from(document.querySelectorAll("span.age a"))
                    .every((link) => link.textContent === "2026"))
                    .toBe(true);
                const unrelated = document.getElementById("unrelated")?.firstChild;
                if (!(unrelated instanceof Text)) {
                    throw new Error("Expected unrelated text");
                }
                unrelated.data = "other changed";
                await Promise.resolve(); await Promise.resolve();
                expect(visits).toBe(100);
                document.querySelector("span.age")?.setAttribute(
                    "title", "2027-08-28T10:09:07Z",
                );
                await Promise.resolve(); await Promise.resolve();
                expect(visits).toBe(101);
                await Promise.resolve(); await Promise.resolve();
                expect(visits).toBe(101);
                const payload = JSON.stringify(sink.mock.calls);
                const allowed = new Set(["category", "reason", "count", "durationMs"]);
                for (const [event] of sink.mock.calls) {
                    expect(Object.keys(event as object)
                        .every((key) => allowed.has(key)))
                        .toBe(true);
                }
                expect(fetchMock).not.toHaveBeenCalled();
                for (const secret of [
                    "item?id=", "minutes ago", "2026-08-28T10:09:07.000000Z",
                    "news?p=2", "#matrix",
                ]) {
                    expect(payload).not.toContain(secret);
                }
            } finally {
                controller?.teardown();
                fetchMock.mockRestore();
            }
        },
    );
});
