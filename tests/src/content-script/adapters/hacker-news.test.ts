/**
 * @file Verifies Hacker News URL scope and timestamp-source extraction.
 */

import { describe, expect, it } from "vitest";

import { GENERIC_TIME_RULE_ID } from "../../../../src/content-script/adapters/generic-time";
import {
    HACKER_NEWS_ADAPTER_ID,
    hackerNewsAdapter,
    matchesHackerNewsUrl,
} from "../../../../src/content-script/adapters/hacker-news";
import { defaultRegistry } from "../../../../src/content-script/adapters/registry";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
} from "../../../../src/content-script/adapters/types";

const HACKER_NEWS_URL = new URL("https://news.ycombinator.com/");

describe("Hacker News source contract", () => {
    it.each([
        ["https://news.ycombinator.com/", true],
        ["http://news.ycombinator.com/news?p=2#stories", true],
        ["https://news.ycombinator.com/item?id=49476604", true],
        ["https://www.news.ycombinator.com/", false],
        ["https://api.news.ycombinator.com/", false],
        ["https://news.ycombinator.com.example/", false],
        ["https://news.ycombinator.com.evil.test/", false],
        ["https://news.ycombinator.org/", false],
        ["ftp://news.ycombinator.com/", false],
    ])("matches %s as %s", (value, expected) => {
        expect(matchesHackerNewsUrl(new URL(value))).toBe(expected);
    });

    it("exports a stable source identifier", () => {
        expect(HACKER_NEWS_ADAPTER_ID).toBe("hacker-news");
    });

    it("discovers only bounded span.age[title] widgets", () => {
        document.body.innerHTML = `
            <span id="eligible" class="age" title="2026-08-28T10:09:07.000000Z">
                <a href="item?id=49476604">1 hour ago</a>
            </span>
            <span class="age">missing title</span>
            <div class="age" title="2026-08-28T10:09:07Z">wrong element</div>`;
        const eligible = document.getElementById("eligible");
        if (!eligible) {
            throw new Error("Expected eligible age widget");
        }

        expect(hackerNewsAdapter.discover(document)).toEqual([eligible]);
        expect(hackerNewsAdapter.discover(eligible)).toEqual([eligible]);
        expect(hackerNewsAdapter.discover(document.createElement("aside"))).toEqual([]);
    });

    it("extracts the existing linked text node without parsing the link", () => {
        document.body.innerHTML = `
            <span id="age" class="age extra" data-page="kept"
                  title="2026-08-28T10:09:07.000000Z">
                <a id="age-link" href="unusual:?opaque" data-link="kept">1 hour ago</a>
            </span>`;
        const source = document.getElementById("age");
        const link = document.getElementById("age-link");
        const target = link?.firstChild;
        if (!source || !link || !(target instanceof Text)) {
            throw new Error("Expected linked age text");
        }

        expect(hackerNewsAdapter.extract(source, HACKER_NEWS_URL)).toEqual({
            ruleId: HACKER_NEWS_ADAPTER_ID,
            source,
            sourceKind: TIMESTAMP_SOURCE_KIND.HACKER_NEWS_AGE,
            rawDatetime: "2026-08-28T10:09:07.000000Z",
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        });
    });

    it("accepts one simple no-link label and rejects ambiguous content", () => {
        document.body.innerHTML = `
            <span id="simple" class="age" title="2026-08-28T10:09:07Z">52 minutes ago</span>
            <span id="two-links" class="age" title="2026-08-28T10:09:07Z">
                <a href="item?id=1">one</a><a href="item?id=2">two</a>
            </span>
            <span id="icon" class="age" title="2026-08-28T10:09:07Z">
                <a href="item?id=1"><img alt="clock">one</a>
            </span>
            <span id="outside" class="age" title="2026-08-28T10:09:07Z">
                prefix <a href="item?id=1">one</a>
            </span>`;
        const simple = document.getElementById("simple");
        if (!simple) {
            throw new Error("Expected simple age widget");
        }
        expect(hackerNewsAdapter.extract(simple, HACKER_NEWS_URL)?.presentation).toMatchObject({
            kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
            target: simple.firstChild,
        });
        for (const id of ["two-links", "icon", "outside"]) {
            const source = document.getElementById(id);
            expect(source ? hackerNewsAdapter.extract(source, HACKER_NEWS_URL) : null)
                .toBeNull();
        }
    });

    it("registers Hacker News before the generic fallback on every site path", () => {
        for (const path of [
            "/",
            "/news",
            "/newest?p=2",
            "/item?id=49476604",
            "/user?id=eterevsky",
            "/submitted?id=eterevsky#history",
        ]) {
            expect(
                defaultRegistry.matching(new URL(`https://news.ycombinator.com${path}`))
                    .map((rule) => rule.id),
            ).toEqual([HACKER_NEWS_ADAPTER_ID, GENERIC_TIME_RULE_ID]);
        }
    });
});
