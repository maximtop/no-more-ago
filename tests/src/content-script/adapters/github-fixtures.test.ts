/**
 * @file Exercises GitHub adapter behavior against representative HTML fixtures.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { defaultRegistry } from "../../../../src/content-script/adapters/registry";
import { DocumentTransformationController } from
    "../../../../src/content-script/transformation/document-transformation-controller";
import { processDocument } from "../../../../src/content-script/transformation/process-document";
import {
    OWNED_SOURCE_ATTRIBUTE,
} from "../../../../src/content-script/transformation/render-exact-time";

const githubPages = [
    "/github/docs/commit/4f8c3170cea7f72cf41fc976f5dbf4e8a0b8567f",
    "/github/docs/pulls",
    "/github/docs/issues/45593",
    "/github/docs/releases",
    "/github",
    "/search?q=repo%3Agithub%2Fdocs+is%3Aissue+45593&type=issues",
    "/github/docs/actions/runs/32653376977",
];

/**
 * GitHub fixture case describing either one trusted timestamp or expected no-op selectors.
 */
type SourceFixture =
    | {
        /**
         * Fixture filename beneath the GitHub fixture directory.
         */
        readonly name: string;

        /**
         * GitHub URL represented by the fixture markup.
         */
        readonly url: string;

        /**
         * Selector locating the trusted timestamp source.
         */
        readonly sourceSelector: string;

        /**
         * Exact datetime attribute expected on the source.
         */
        readonly rawDatetime: string;

        /**
         * Normalized timestamp expected after trusted resolution.
         */
        readonly instant: string;
    }
    | {
        /**
         * Fixture filename beneath the GitHub fixture directory.
         */
        readonly name: string;

        /**
         * GitHub URL represented by the fixture markup.
         */
        readonly url: string;

        /**
         * Selectors whose elements must remain unchanged.
         */
        readonly noOpSelectors: readonly string[];
    };

const sourceFixtures: readonly SourceFixture[] = [
    {
        name: "commits.html",
        url: "https://github.com/github/docs/commit/4f8c3170cea7f72cf41fc976f5dbf4e8a0b8567f",
        noOpSelectors: ['a[href="/github/docs/commit/4f8c3170cea7f72cf41fc976f5dbf4e8a0b8567f"]'],
    },
    {
        name: "issues-pull-requests.html",
        url: "https://github.com/github/docs/pulls",
        sourceSelector: "relative-time",
        rawDatetime: "2026-08-22T09:19:17Z",
        instant: "2026-08-22T09:19:17.000Z",
    },
    {
        name: "timelines.html",
        url: "https://github.com/github/docs/issues/45593",
        noOpSelectors: ["relative-time:not([datetime])"],
    },
    {
        name: "releases-tags.html",
        url: "https://github.com/github/docs/releases",
        sourceSelector: "relative-time",
        rawDatetime: "2023-02-14T14:53:40Z",
        instant: "2023-02-14T14:53:40.000Z",
    },
    {
        name: "profiles-activity.html",
        url: "https://github.com/github",
        sourceSelector: "relative-time",
        rawDatetime: "2026-08-24T08:04:47Z",
        instant: "2026-08-24T08:04:47.000Z",
    },
    {
        name: "search.html",
        url: "https://github.com/search?q=repo%3Agithub%2Fdocs+is%3Aissue+45593&type=issues",
        noOpSelectors: ['a[href="/github/docs/issues/45593"]'],
    },
    {
        name: "actions.html",
        url: "https://github.com/github/docs/actions/runs/32653376977",
        sourceSelector: "relative-time",
        rawDatetime: "2026-08-23T16:59:13Z",
        instant: "2026-08-23T16:59:13.000Z",
    },
];

describe("offline GitHub source fixtures", () => {
    const fixtures = new Map<string, string>();

    beforeAll(async () => {
        await Promise.all(
            sourceFixtures.map(async ({ name }) => {
                fixtures.set(
                    name,
                    await readFile(`tests/src/content-script/fixtures/github/${name}`, "utf8"),
                );
            }),
        );
    });

    it.each(sourceFixtures)(
        "processes $name according to its documented source contract",
        (sourceCase) => {
            const { name, url } = sourceCase;
            const fixture = fixtures.get(name);
            if (!fixture) {
                throw new Error(`Missing fixture ${name}`);
            }
            document.body.innerHTML = fixture;
            const originalMarkup = document.body.innerHTML;
            const originalLink = document.querySelector("a")?.getAttribute("href");
            const noOpMarkup =
                "noOpSelectors" in sourceCase
                    ? sourceCase.noOpSelectors.map(
                        (selector) =>
                            [selector, document.querySelector(selector)?.outerHTML] as const,
                    )
                    : [];
            const source =
                "sourceSelector" in sourceCase
                    ? document.querySelector(sourceCase.sourceSelector)
                    : null;
            if ("sourceSelector" in sourceCase) {
                expect(source).not.toBeNull();
                if (!source) {
                    throw new Error(`Missing source in ${name}`);
                }
                const adapter = defaultRegistry.matching(new URL(url))[0];
                expect(adapter).not.toBeNull();
                expect(adapter?.extract(source)).toMatchObject({
                    source,
                    rawDatetime: sourceCase.rawDatetime,
                });
            }
            const outputs = processDocument({
                url: new URL(url),
                root: document,
                locales: ["en-US"],
            });
            if ("noOpSelectors" in sourceCase) {
                expect(outputs).toHaveLength(0);
                expect(document.body.innerHTML).toBe(originalMarkup);
            } else {
                expect(outputs).toHaveLength(1);
                expect(outputs[0]?.dateTime).toBe(sourceCase.rawDatetime);
                expect(outputs[0]?.getAttribute("data-no-more-ago-output")).toBeTruthy();
                expect(source?.getAttribute(OWNED_SOURCE_ATTRIBUTE)).toMatch(/^visible:/);
                expect(outputs[0]?.previousElementSibling).toBe(source);
                expect(new Date(outputs[0]?.dateTime ?? "").toISOString()).toBe(sourceCase.instant);
                expect(document.querySelector("a")?.getAttribute("href")).toBe(originalLink);
            }
            for (const [selector, markup] of noOpMarkup) {
                expect(document.querySelector(selector)?.outerHTML).toBe(markup);
            }
        },
    );

    it("replays the independent matrix identically on every GitHub path", async () => {
        const matrix = await readFile(
            "tests/src/content-script/fixtures/github/eligibility-matrix.html",
            "utf8",
        );
        for (const path of githubPages) {
            document.body.innerHTML = matrix;
            const outputs = processDocument({
                url: new URL(`https://github.com${path}`),
                root: document,
                locales: ["en-US"],
            });
            expect(outputs).toHaveLength(3);
            expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(3);
            expect(document.querySelectorAll("relative-time:not([hidden])")).toHaveLength(9);
        }
    });

    it.each(["https://gist.github.com/example/1", "https://github.example/path"])(
        "leaves the matrix unchanged on %s",
        async (url) => {
            const matrix = await readFile(
                "tests/src/content-script/fixtures/github/eligibility-matrix.html",
                "utf8",
            );
            document.body.innerHTML = matrix;
            const original = document.body.innerHTML;
            expect(
                processDocument({ url: new URL(url), root: document, locales: ["en-US"] }),
            ).toEqual([]);
            expect(document.body.innerHTML).toBe(original);
        },
    );

    it("replays the matrix through dynamic add, update, repair, and removal", async () => {
        const matrix = await readFile(
            "tests/src/content-script/fixtures/github/eligibility-matrix.html",
            "utf8",
        );
        document.body.innerHTML = "";
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/github/docs/issues/45593"),
            root: document,
            locales: ["en-US"],
            registry: defaultRegistry,
        });
        controller.start();
        const added = document.createElement("section");
        added.innerHTML = matrix;
        document.body.append(added);
        await Promise.resolve();
        await Promise.resolve();
        expect(added.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(3);

        const source = added.querySelector("relative-time[datetime]");
        const output = source?.nextElementSibling;
        if (!(source instanceof Element) || !(output instanceof HTMLTimeElement)) {
            throw new Error("Expected dynamically owned pair");
        }
        const token = output.getAttribute("data-no-more-ago-output");
        source.setAttribute("datetime", "2026-08-24T10:15:00Z");
        output.remove();
        await Promise.resolve();
        await Promise.resolve();
        expect(source.nextElementSibling).toBe(output);
        expect(output.getAttribute("data-no-more-ago-output")).toBe(token);
        expect(output.dateTime).toBe("2026-08-24T10:15:00Z");

        document.body.removeChild(added);
        await Promise.resolve();
        await Promise.resolve();
        expect(
            added.querySelectorAll("[data-no-more-ago-source], [data-no-more-ago-output]"),
        ).toHaveLength(0);
        expect(
            document.querySelectorAll("[data-no-more-ago-source], [data-no-more-ago-output]"),
        ).toHaveLength(0);
        controller.teardown();
    });
});
